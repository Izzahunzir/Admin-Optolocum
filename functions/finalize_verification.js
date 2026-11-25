'use strict';

// Local integration candidate for the Admin functions package. Dependencies are
// injected so the existing Admin document validator remains the single source.
const { createHash } = require('node:crypto');

const locumKeys = ['fullName', 'email', 'nric', 'phoneNumber', 'gender', 'dateOfBirth', 'highestEducation', 'course'];
const practiceKeys = ['practiceType', 'clinicName', 'registrationNumber', 'address', 'state', 'contactNumber', 'companyEmail'];
const types = ['Hospital', 'Private Optical Clinic', 'Retail Optical Store', 'University/Training Institution'];
const states = ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Putrajaya', 'Labuan'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const reject = message => { const error = new Error(message); error.code = 'failed-precondition'; throw error; };

function validateDraft(data, uid, id) {
  if (!uid || uid.includes('/') || uid.length > 128 || !/^[a-f0-9]{40}$/.test(id)) reject('Invalid revision identity.');
  if (!exact(data, ['uid', 'accountType', 'schemaVersion', 'submittedFields', 'verificationStatus', 'fingerprint', 'document', 'state', 'createdAt', 'updatedAt']) ||
      data.uid !== uid || data.schemaVersion !== 1 || data.state !== 'draft' || data.verificationStatus !== 'pending' ||
      !['locum', 'practice_owner'].includes(data.accountType)) reject('Invalid revision schema.');
  const keys = data.accountType === 'locum' ? locumKeys : practiceKeys;
  const fields = data.submittedFields;
  if (!exact(fields, keys) || keys.some(k => typeof fields[k] !== 'string' || !fields[k].trim() || fields[k].length > 2000 || fields[k] !== fields[k].trim())) reject('Invalid verification fields.');
  const email = fields[data.accountType === 'locum' ? 'email' : 'companyEmail'];
  const phone = fields[data.accountType === 'locum' ? 'phoneNumber' : 'contactNumber'].replace(/[\s()-]/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[0-9]{7,15}$/.test(phone)) reject('Invalid contact details.');
  if (data.accountType === 'locum') {
    const date = fields.dateOfBirth;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^[0-9]{12}$/.test(fields.nric.replace(/-/g, '')) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || parsed.getTime() > Date.now()) reject('Invalid personal details.');
  } else if (!types.includes(fields.practiceType) || !states.includes(fields.state)) reject('Invalid practice details.');
  const d = data.document;
  if (!exact(d, ['path', 'name', 'contentType', 'size', 'sha256']) || d.path !== `verification_documents/${uid}/${id}/document` || typeof d.name !== 'string' || d.name.length > 255 || /[/\\]/.test(d.name) ||
      !Number.isSafeInteger(d.size) || d.size < 1 || d.size > 50 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(d.sha256) ||
      !({'application/pdf': /\.pdf$/i, 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i}[d.contentType]?.test(d.name))) reject('Invalid document metadata.');
  const ordered = Object.fromEntries(Object.keys(fields).sort().map(k => [k, fields[k]]));
  const fingerprint = createHash('sha256').update(JSON.stringify([uid, data.accountType, ordered, d.sha256, d.name])).digest('hex');
  if (data.fingerprint !== fingerprint || !data.createdAt || typeof data.createdAt.toMillis !== 'function') reject('Invalid revision fingerprint or timestamp.');
  return data;
}

async function finalizeVerification({ db, bucket, documentStore, uid, submissionId, verifyStorageDocument, FieldValue, FieldPath, assertActive = async () => {} }) {
  if (typeof uid !== 'string' || typeof submissionId !== 'string' || !/^[a-f0-9]{40}$/.test(submissionId) || !uid || uid.includes('/')) reject('Invalid revision identity.');
  const revision = db.collection('verification_submissions').doc(uid).collection('revisions').doc(submissionId);
  const initial = await revision.get();
  if (!initial.exists) reject('Revision does not exist.');
  const assignment = db.collection('account_management').doc(uid);
  const assigned = await assignment.get();
  if (!assigned.exists || !['locum', 'practice_owner'].includes(assigned.data().trustedAccountType) || assigned.data().trustedAccountType !== initial.data().accountType) reject('Trusted account assignment is missing or does not match.');
  if (initial.data().state === 'submitted') return { submissionId, state: 'submitted' };
  const draft = validateDraft(initial.data(), uid, submissionId);
  if (documentStore) await documentStore.verify(draft.document);
  else await verifyStorageDocument({ bucket, document: draft.document });
  await assertActive();
  const profileName = draft.accountType === 'locum' ? 'locum_profiles' : 'practice_owner_profiles';
  const otherName = draft.accountType === 'locum' ? 'practice_owner_profiles' : 'locum_profiles';
  const profile = db.collection(profileName).doc(uid);
  const other = db.collection(otherName).doc(uid);
  const latest = db.collection('verification_submissions').doc(uid).collection('revisions').where('state', '==', 'submitted').orderBy('submittedAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(1);
  await db.runTransaction(async tx => {
    const [current, existingProfile, otherProfile, previous, currentAssignment] = await Promise.all([tx.get(revision), tx.get(profile), tx.get(other), tx.get(latest), tx.get(assignment)]);
    if (!current.exists) reject('Revision does not exist.');
    if (!currentAssignment.exists || currentAssignment.data().trustedAccountType !== draft.accountType) reject('Trusted account assignment changed.');
    if (current.data().state === 'submitted') return;
    const checked = validateDraft(current.data(), uid, submissionId);
    if (checked.fingerprint !== draft.fingerprint || ['path', 'name', 'contentType', 'size', 'sha256'].some(key => checked.document[key] !== draft.document[key]) || checked.createdAt.toMillis() !== draft.createdAt.toMillis()) reject('Revision changed during validation.');
    if (otherProfile.exists || (draft.accountType === 'practice_owner' && !existingProfile.exists)) reject('Account profiles require review.');
    const newest = previous.docs[0];
    if (newest && newest.data().submittedAt.toMillis() >= checked.createdAt.toMillis()) reject('A newer submission exists. Start a new revision.');
    await assertActive();
    if (newest && newest.data().verificationStatus === 'pending') tx.update(newest.ref, { verificationStatus: 'superseded', updatedAt: FieldValue.serverTimestamp() });
    tx.set(profile, { verificationStatus: 'pending', updatedAt: FieldValue.serverTimestamp(), ...(!existingProfile.exists ? { createdAt: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    tx.update(revision, { state: 'submitted', submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { submissionId, state: 'submitted' };
}

// Adapter for an onCall handler. The caller supplies no UID: it is derived from
// a revocation-checked bearer token and matched against the callable identity.
async function finalizeVerificationRequest({ request, auth, ...dependencies }) {
  const error = (code, message) => { const e = new Error(message); e.code = code; throw e; };
  if (!exact(request.data, ['submissionId']) || typeof request.data.submissionId !== 'string' || !/^[a-f0-9]{40}$/.test(request.data.submissionId)) error('invalid-argument', 'Invalid submission request.');
  const headers = request.rawRequest?.rawHeaders || [];
  let count = 0;
  for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === 'authorization') count++;
  const authorization = request.rawRequest?.headers?.authorization;
  if (count > 1 || typeof authorization !== 'string' || !/^Bearer [^\s]+$/.test(authorization)) error('unauthenticated', 'Please sign in again.');
  let token;
  try { token = await auth.verifyIdToken(authorization.slice(7), true); }
  catch (_) { error('unauthenticated', 'Please sign in again.'); }
  if (!token?.uid || token.uid !== request.auth?.uid) error('unauthenticated', 'Please sign in again.');
  const assertActive = async () => {
    let user;
    try { user = await auth.getUser(token.uid); }
    catch (_) { error('unauthenticated', 'Please sign in again.'); }
    if (user.disabled) error('permission-denied', 'This account is unavailable.');
  };
  await assertActive();
  return finalizeVerification({ ...dependencies, uid: token.uid, submissionId: request.data.submissionId, assertActive });
}

module.exports = { validateDraft, finalizeVerification, finalizeVerificationRequest };
