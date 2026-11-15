"use strict";

const { createHash } = require('node:crypto');
const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const { pipeline } = require('node:stream/promises');
const { Writable } = require('node:stream');

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_HISTORY_PAGE_SIZE = 25;
const MAX_QUEUE_SCAN = 250;
const RECENT_AUTH_SECONDS = 5 * 60;
const ALLOWED_CONTENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const FIELDS = Object.freeze({
  locum: ['fullName', 'email', 'nric', 'phoneNumber', 'gender', 'dateOfBirth', 'highestEducation', 'course'],
  practice_owner: ['practiceType', 'clinicName', 'registrationNumber', 'address', 'state', 'contactNumber', 'companyEmail'],
});
const PROFILE_COLLECTIONS = Object.freeze({
  locum: 'locum_profiles',
  practice_owner: 'practice_owner_profiles',
});
const SAFE_PROFILE_STATUSES = new Set(['unverified', 'pending', 'approved', 'rejected', 'verified']);

class VerificationManagementError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new VerificationManagementError(code, message); };

function validUid(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !uid.includes('/') && uid.trim() === uid;
}
function validSubmissionId(id) { return typeof id === 'string' && /^[a-f0-9]{40}$/.test(id); }
function validAccountType(value) { return value === 'locum' || value === 'practice_owner'; }
function timestampMillis(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (value && typeof value.toMillis === 'function') {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : null;
  }
  return null;
}
function toIso(value) {
  const millis = timestampMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}
function submissionRef(db, uid, submissionId) {
  return db.collection('verification_submissions').doc(uid).collection('revisions').doc(submissionId);
}
function reviewRef(db, uid, submissionId) {
  return db.collection('verification_reviews').doc(uid).collection('revisions').doc(submissionId);
}
function profileRef(db, accountType, uid) {
  return db.collection(PROFILE_COLLECTIONS[accountType]).doc(uid);
}
function safeFields(accountType, raw) {
  const expected = FIELDS[accountType];
  if (!expected || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).length !== expected.length || !expected.every(key => Object.hasOwn(raw, key))) return null;
  const result = {};
  for (const key of expected) {
    if (typeof raw[key] !== 'string' || raw[key].length > 2000) return null;
    result[key] = raw[key];
  }
  return result;
}
function safeDocument(uid, submissionId, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const expectedPath = `verification_documents/${uid}/${submissionId}/document`;
  if (raw.path !== expectedPath || typeof raw.name !== 'string' || !raw.name || raw.name.length > 255 ||
      raw.name.includes('/') || raw.name.includes('\\') || !ALLOWED_CONTENT_TYPES.has(raw.contentType) ||
      !Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > MAX_DOCUMENT_BYTES ||
      typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) return null;
  return { path: expectedPath, name: raw.name, contentType: raw.contentType, size: raw.size, sha256: raw.sha256 };
}
function revisionIdentity(snapshot) {
  const path = snapshot?.ref?.path;
  if (typeof path !== 'string') return null;
  const match = /^verification_submissions\/([^/]+)\/revisions\/([a-f0-9]{40})$/.exec(path);
  return match ? { uid: match[1], submissionId: match[2] } : null;
}
function publicReview(raw) {
  if (!raw || !['approved', 'rejected'].includes(raw.decision) || typeof raw.reviewedBy !== 'string') return null;
  return {
    decision: raw.decision,
    reviewedBy: raw.reviewedBy,
    reviewedAt: toIso(raw.reviewedAt),
    ...(raw.decision === 'rejected' && typeof raw.rejectionReason === 'string'
      ? { rejectionReason: raw.rejectionReason }
      : {}),
  };
}
function publicSubmission(snapshot, { includeState = false } = {}) {
  const identity = revisionIdentity(snapshot);
  if (!identity) return null;
  const data = snapshot.data();
  if (!data || data.uid !== identity.uid || !validAccountType(data.accountType) ||
      !validSubmissionId(identity.submissionId) || !/^[a-f0-9]{64}$/.test(data.fingerprint || '') ||
      !Number.isSafeInteger(data.schemaVersion) || data.schemaVersion !== 1) return null;
  const fields = safeFields(data.accountType, data.submittedFields);
  const document = safeDocument(identity.uid, identity.submissionId, data.document);
  const submittedAt = toIso(data.submittedAt);
  if (!fields || !document || !submittedAt) return null;
  return {
    uid: identity.uid,
    submissionId: identity.submissionId,
    accountType: data.accountType,
    submittedFields: fields,
    submittedAt,
    document,
    ...(includeState ? { state: data.state, verificationStatus: data.verificationStatus } : {}),
  };
}
async function assertCurrentAdmin({ auth, actor, now = Date.now(), requireRecentAuth = false }) {
  if (!actor || typeof actor.uid !== 'string' || actor.admin !== true) {
    fail('permission-denied', 'Administrator access required.');
  }
  let current;
  try { current = await auth.getUser(actor.uid); }
  catch (error) {
    if (error?.code === 'auth/user-not-found') fail('permission-denied', 'Administrator authorization is no longer valid.');
    throw error;
  }
  if (current.disabled || current.customClaims?.admin !== true) {
    fail('permission-denied', 'Administrator authorization is no longer valid.');
  }
  if (requireRecentAuth && (!Number.isFinite(actor.auth_time) || actor.auth_time > now / 1000 || now / 1000 - actor.auth_time > RECENT_AUTH_SECONDS)) {
    fail('unauthenticated', 'Please sign in again before reviewing a submission.');
  }
}

function encodePageToken(snapshot, accountType) {
  return Buffer.from(JSON.stringify({ path: snapshot.ref.path, accountType }), 'utf8').toString('base64url');
}
function decodePageToken(db, token, accountType, uid, submissionsOnly = false) {
  if (token === undefined || token === null || token === '') return null;
  if (typeof token !== 'string' || token.length > 1024) fail('invalid-argument', 'Invalid page token.');
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!parsed || parsed.accountType !== (accountType ?? null) || typeof parsed.path !== 'string') throw new Error();
    const match = /^([^/]+)\/([^/]+)\/revisions\/([^/]+)$/.exec(parsed.path);
    if (!match || (submissionsOnly && match[1] !== 'verification_submissions') || (uid && match[2] !== uid)) throw new Error();
    return db.doc(parsed.path);
  } catch (_) { fail('invalid-argument', 'Invalid page token.'); }
}

async function listPendingVerificationSubmissions({ auth, db, actor, accountType, pageSize = DEFAULT_PAGE_SIZE, pageToken }) {
  await assertCurrentAdmin({ auth, actor });
  if (accountType !== undefined && accountType !== null && !validAccountType(accountType)) fail('invalid-argument', 'Invalid account type.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) fail('invalid-argument', `Page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  let query = db.collectionGroup('revisions')
    .where('state', '==', 'submitted')
    .where('verificationStatus', '==', 'pending');
  if (accountType) query = query.where('accountType', '==', accountType);
  query = query.orderBy('submittedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  const cursorRef = decodePageToken(db, pageToken, accountType ?? null);
  if (cursorRef) {
    const cursor = await cursorRef.get();
    if (!cursor.exists) fail('invalid-argument', 'Page token no longer refers to an available submission.');
    query = query.startAfter(cursor);
  }
  const entries = [];
  let lastScanned = null;
  let hasMore = false;
  let scannedCount = 0;
  let scanMayContinue = false;
  // Scan bounded chunks until a full page of valid submissions is collected.
  // The cursor may point at an unrelated/malformed collection-group match.
  while (entries.length <= pageSize && scannedCount < MAX_QUEUE_SCAN) {
    const chunkSize = Math.min(pageSize + 1, MAX_PAGE_SIZE + 1);
    let chunkQuery = query.limit(chunkSize);
    if (lastScanned) chunkQuery = chunkQuery.startAfter(lastScanned);
    const snapshot = await chunkQuery.get();
    scanMayContinue = snapshot.docs.length === chunkSize;
    if (snapshot.docs.length === 0) break;
    for (const doc of snapshot.docs) {
      lastScanned = doc;
      scannedCount++;
      const item = publicSubmission(doc);
      if (item && doc.data().state === 'submitted' && doc.data().verificationStatus === 'pending' &&
          (!accountType || item.accountType === accountType)) entries.push({ item, snapshot: doc });
      if (entries.length > pageSize) { hasMore = true; break; }
    }
    if (hasMore || snapshot.docs.length < Math.min(pageSize + 1, MAX_PAGE_SIZE + 1)) break;
  }
  if (!hasMore && scannedCount >= MAX_QUEUE_SCAN && scanMayContinue) hasMore = true;
  const page = entries.slice(0, pageSize);
  // Prefer a cursor after the last returned item; if the page is empty, advance
  // past scanned invalid records so they cannot stall pagination.
  const cursorSnapshot = entries.length > pageSize && page.length
    ? page[page.length - 1].snapshot
    : lastScanned;
  return {
    items: page.map(entry => entry.item),
    nextPageToken: hasMore && cursorSnapshot ? encodePageToken(cursorSnapshot, accountType ?? null) : null,
  };
}

async function getVerificationSubmission({ auth, db, actor, uid, submissionId, historyPageSize = DEFAULT_HISTORY_PAGE_SIZE, historyPageToken }) {
  await assertCurrentAdmin({ auth, actor });
  if (!validUid(uid) || !validSubmissionId(submissionId)) fail('invalid-argument', 'Invalid submission identity.');
  if (!Number.isInteger(historyPageSize) || historyPageSize < 1 || historyPageSize > MAX_PAGE_SIZE) fail('invalid-argument', `History page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  const targetRef = submissionRef(db, uid, submissionId);
  const targetSnapshot = await targetRef.get();
  if (!targetSnapshot.exists) fail('not-found', 'Verification submission not found.');
  const selected = publicSubmission(targetSnapshot, { includeState: true });
  if (!selected) fail('failed-precondition', 'Verification submission has malformed or unsupported fields.');
  let historyQuery = db.collection('verification_submissions').doc(uid)
    .collection('revisions').orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  const historyCursor = decodePageToken(db, historyPageToken, 'history', uid, true);
  if (historyCursor) {
    const cursor = await historyCursor.get();
    if (!cursor.exists) fail('invalid-argument', 'History page token no longer refers to an available revision.');
    historyQuery = historyQuery.startAfter(cursor);
  }
  const historySnapshot = await historyQuery.limit(historyPageSize + 1).get();
  const hasMore = historySnapshot.docs.length > historyPageSize;
  const rawPage = historySnapshot.docs.slice(0, historyPageSize);
  const validItems = rawPage.map(snapshot => ({ snapshot, item: publicSubmission(snapshot, { includeState: true }) }))
    .filter(entry => entry.item);
  const reviewRefs = [...new Set([...validItems.map(entry => entry.item.submissionId), submissionId])]
    .map(id => reviewRef(db, uid, id));
  const reviewSnapshots = reviewRefs.length ? await db.getAll(...reviewRefs) : [];
  const reviewsById = new Map(reviewSnapshots.map(snapshot => [snapshot.id, publicReview(snapshot.exists ? snapshot.data() : null)]));
  const selectedReview = reviewsById.get(submissionId);
  return {
    submission: { ...selected, ...(selectedReview ? { review: selectedReview } : {}) },
    history: validItems.map(({ item }) => {
      const review = reviewsById.get(item.submissionId);
      return { ...item, ...(review ? { review } : {}) };
    }),
    historyHasMore: hasMore,
    historyNextPageToken: hasMore ? encodePageToken(rawPage[rawPage.length - 1], 'history') : null,
    historyOmittedCount: rawPage.length - validItems.length,
    historyHasOmittedRecords: rawPage.length !== validItems.length,
  };
}

async function verifyStorageDocument({ bucket, document }) {
  let file = bucket.file(document.path);
  let exists;
  try { [exists] = await file.exists(); }
  catch (_) { fail('failed-precondition', 'The verification document could not be confirmed in private storage.'); }
  if (!exists) fail('failed-precondition', 'The verification document is missing from private storage.');
  let metadata;
  try { [metadata] = await file.getMetadata(); }
  catch (_) { fail('failed-precondition', 'The verification document metadata could not be read.'); }
  const size = Number(metadata.size);
  const custom = metadata.metadata || {};
  if (!Number.isSafeInteger(size) || size !== document.size || size <= 0 || size > MAX_DOCUMENT_BYTES ||
      metadata.contentType !== document.contentType || !ALLOWED_CONTENT_TYPES.has(metadata.contentType) ||
      custom.sha256 !== document.sha256 || typeof metadata.generation !== 'string' || !/^\d+$/.test(metadata.generation)) {
    fail('failed-precondition', 'The verification document does not match its submitted metadata.');
  }
  // Pin subsequent reads to the generation whose metadata was checked. If that
  // generation is no longer available, fail closed instead of reading a replacement.
  file = bucket.file(document.path, { generation: metadata.generation });
  const hash = createHash('sha256');
  const signature = [];
  let bytes = 0;
  try {
    await pipeline(file.createReadStream(), new Writable({
      write(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_DOCUMENT_BYTES) return callback(new Error('Document exceeds the maximum size.'));
        if (signature.reduce((sum, part) => sum + part.length, 0) < 8) {
          const remaining = 8 - signature.reduce((sum, part) => sum + part.length, 0);
          signature.push(Buffer.from(chunk.subarray(0, remaining)));
        }
        hash.update(chunk);
        callback();
      },
    }));
  } catch (_) { fail('failed-precondition', 'The verification document could not be read or validated.'); }
  const prefix = Buffer.concat(signature);
  const detectedType = prefix.subarray(0, 5).toString('ascii') === '%PDF-' ? 'application/pdf'
    : prefix.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
      : prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff ? 'image/jpeg' : null;
  if (bytes !== document.size || !detectedType || detectedType !== document.contentType || hash.digest('hex') !== document.sha256) {
    fail('failed-precondition', 'The verification document size, format, or SHA-256 does not match the submitted metadata.');
  }
  return file;
}

async function reviewVerificationSubmission({ auth, db, bucket, actor, uid, submissionId, decision, rejectionReason, now = Date.now() }) {
  await assertCurrentAdmin({ auth, actor, now, requireRecentAuth: true });
  if (!validUid(uid) || !validSubmissionId(submissionId)) fail('invalid-argument', 'Invalid submission identity.');
  if (!['approved', 'rejected'].includes(decision)) fail('invalid-argument', 'Decision must be approved or rejected.');
  if (decision === 'rejected') {
    if (typeof rejectionReason !== 'string' || !rejectionReason.trim() || rejectionReason.trim().length > 1000) {
      fail('invalid-argument', 'A rejection reason of 1 to 1000 characters is required.');
    }
    rejectionReason = rejectionReason.trim();
  } else if (rejectionReason !== undefined) {
    fail('invalid-argument', 'A rejection reason is only valid for a rejected submission.');
  }

  const targetRef = submissionRef(db, uid, submissionId);
  const initialSnapshot = await targetRef.get();
  if (!initialSnapshot.exists) fail('not-found', 'Verification submission not found.');
  const item = publicSubmission(initialSnapshot, { includeState: true });
  if (!item) fail('failed-precondition', 'Verification submission has malformed or unsupported fields.');
  if (item.state !== 'submitted' || item.verificationStatus !== 'pending') fail('failed-precondition', 'Only submitted pending revisions can be reviewed.');
  if (decision === 'approved') await verifyStorageDocument({ bucket, document: item.document });

  // Re-read live Auth state after potentially long document validation and just
  // before entering the Firestore transaction.
  await assertCurrentAdmin({ auth, actor, now, requireRecentAuth: true });

  const targetReviewRef = reviewRef(db, uid, submissionId);
  const targetProfileRef = profileRef(db, item.accountType, uid);
  const latestSubmittedQuery = db.collection('verification_submissions').doc(uid)
    .collection('revisions').where('state', '==', 'submitted')
    .orderBy('submittedAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(1);
  const result = await db.runTransaction(async transaction => {
    const [submissionSnapshot, existingReview, profileSnapshot, latestSnapshot] = await Promise.all([
      transaction.get(targetRef), transaction.get(targetReviewRef), transaction.get(targetProfileRef), transaction.get(latestSubmittedQuery),
    ]);
    if (!submissionSnapshot.exists) fail('not-found', 'Verification submission not found.');
    if (existingReview.exists) fail('already-exists', 'This verification submission has already been reviewed.');
    const current = publicSubmission(submissionSnapshot, { includeState: true });
    if (!current || current.uid !== uid || current.submissionId !== submissionId || current.accountType !== item.accountType ||
        current.state !== 'submitted' || current.verificationStatus !== 'pending') {
      fail('failed-precondition', 'Submission state changed. Refresh the review queue and try again.');
    }
    const latest = latestSnapshot.docs?.[0];
    if (!latest || latest.ref.path !== targetRef.path) {
      fail('failed-precondition', 'This revision is no longer the latest submitted verification. Review the latest submitted revision instead.');
    }
    if (!profileSnapshot.exists) fail('failed-precondition', 'The matching account profile is missing; no review was saved.');
    const profile = profileSnapshot.data();
    if (Object.hasOwn(profile, 'verificationStatus') &&
        (typeof profile.verificationStatus !== 'string' || !SAFE_PROFILE_STATUSES.has(profile.verificationStatus))) {
      fail('failed-precondition', 'The profile verification status is malformed; no review was saved.');
    }
    // Auth is external to Firestore and cannot participate in its transaction.
    // Recheck after all transaction reads and immediately before scheduling writes.
    await assertCurrentAdmin({ auth, actor, now, requireRecentAuth: true });
    const reviewedAt = FieldValue.serverTimestamp();
    transaction.create(targetReviewRef, {
      uid,
      submissionId,
      decision,
      reviewedBy: actor.uid,
      reviewedAt,
      ...(decision === 'rejected' ? { rejectionReason } : {}),
    });
    transaction.update(targetProfileRef, {
      verificationStatus: decision,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { uid, submissionId, decision, profileCollection: PROFILE_COLLECTIONS[item.accountType] };
  });
  const committedReview = await targetReviewRef.get();
  return { ...result, reviewedBy: actor.uid, reviewedAt: toIso(committedReview.data()?.reviewedAt) };
}

async function verifyBearerAdmin({ auth, request }) {
  const headers = request.rawHeaders || [];
  let authorizationCount = 0;
  for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === 'authorization') authorizationCount++;
  if (authorizationCount > 1) fail('invalid-argument', 'Duplicate Authorization headers are not allowed.');
  const value = request.headers?.authorization;
  if (typeof value !== 'string' || !/^Bearer [^\s]+$/.test(value)) fail('unauthenticated', 'A Firebase ID token is required.');
  try { return await auth.verifyIdToken(value.slice(7), true); }
  catch (error) {
    if (['auth/id-token-revoked', 'auth/id-token-expired', 'auth/invalid-id-token', 'auth/argument-error', 'auth/user-disabled'].includes(error?.code)) {
      fail('unauthenticated', 'Please sign in again.');
    }
    throw error;
  }
}

function safeFilename(name) {
  return name.replace(/[\r\n"\\]/g, '_').slice(0, 255);
}
function createVerificationDocumentHandler({ auth, db, bucket, allowedOrigins = [] }) {
  const originSet = new Set(allowedOrigins.filter(value => typeof value === 'string' && /^https?:\/\/[^/]+$/.test(value)));
  return async function verificationDocumentHandler(request, response) {
    response.set('Cache-Control', 'private, no-store, max-age=0');
    response.set('Pragma', 'no-cache');
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Referrer-Policy', 'no-referrer');
    response.set('Content-Security-Policy', "default-src 'none'; sandbox");
    const origin = request.get ? request.get('Origin') : request.headers?.origin;
    const allowed = typeof origin === 'string' && originSet.has(origin);
    if (!allowed || originSet.size === 0) return response.status(403).json({ error: { code: 'permission-denied', message: 'Origin is not allowed.' } });
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      const requestedHeaders = String(request.headers?.['access-control-request-headers'] || '')
        .toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (request.headers?.['access-control-request-method'] !== 'GET' ||
          requestedHeaders.some(value => value !== 'authorization')) {
        return response.status(403).json({ error: { code: 'permission-denied', message: 'Preflight not allowed.' } });
      }
      response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Authorization');
      response.set('Access-Control-Max-Age', '300');
      return response.status(204).send('');
    }
    const reject = (status, code, message) => response.status(status).json({ error: { code, message } });
    try {
      if (request.method !== 'GET') return reject(405, 'invalid-argument', 'Only GET is supported.');
      const query = request.query || {};
      if (Object.keys(query).some(key => !['uid', 'submissionId'].includes(key)) ||
          !validUid(query.uid) || !validSubmissionId(query.submissionId)) return reject(400, 'invalid-argument', 'Invalid submission identity.');
      const actor = await verifyBearerAdmin({ auth, request });
      await assertCurrentAdmin({ auth, actor });
      const snapshot = await submissionRef(db, query.uid, query.submissionId).get();
      if (!snapshot.exists) return reject(404, 'not-found', 'Verification submission not found.');
      const item = publicSubmission(snapshot, { includeState: true });
      if (!item || item.state !== 'submitted') return reject(404, 'not-found', 'Submitted verification document not found.');
      const file = await verifyStorageDocument({ bucket, document: item.document });
      response.set('Content-Type', item.document.contentType);
      response.set('Content-Length', String(item.document.size));
      response.set('Content-Disposition', `attachment; filename="${safeFilename(item.document.name)}"; filename*=UTF-8''${encodeURIComponent(item.document.name)}`);
      const stream = file.createReadStream();
      stream.on('error', () => {
        if (!response.headersSent) reject(503, 'unavailable', 'The private verification document could not be streamed.');
        else response.destroy();
      });
      stream.pipe(response);
    } catch (error) {
      if (error instanceof VerificationManagementError) {
        const status = { 'unauthenticated': 401, 'permission-denied': 403, 'invalid-argument': 400,
          'not-found': 404, 'failed-precondition': 409 }[error.code] || 409;
        if (!response.headersSent) return reject(status, error.code, error.message);
        return response.destroy();
      }
      if (!response.headersSent) return reject(503, 'unavailable', 'The private verification document is temporarily unavailable.');
      return response.destroy();
    }
  };
}

module.exports = {
  MAX_DOCUMENT_BYTES, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE, FIELDS, PROFILE_COLLECTIONS,
  VerificationManagementError, assertCurrentAdmin, listPendingVerificationSubmissions,
  getVerificationSubmission, reviewVerificationSubmission, verifyStorageDocument,
  verifyBearerAdmin, createVerificationDocumentHandler, publicSubmission,
};
