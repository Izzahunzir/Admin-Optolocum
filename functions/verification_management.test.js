"use strict";

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { createHash } = require('node:crypto');
const {
  listPendingVerificationSubmissions, getVerificationSubmission,
  reviewVerificationSubmission, createVerificationDocumentHandler,
  VerificationManagementError, MAX_PAGE_SIZE,
} = require('./verification_management');
const { FieldPath } = require('firebase-admin/firestore');

const bytes = Buffer.from('%PDF-1.7\nsynthetic certificate');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const id = 'a'.repeat(40);
const olderId = 'b'.repeat(40);

function clone(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

class Snapshot {
  constructor(ref, value) { this.ref = ref; this.id = ref.id; this.exists = value !== undefined; this.value = value; }
  data() { return this.exists ? clone(this.value) : undefined; }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  async get() { return new Snapshot(this, this.db.docs.get(this.path)); }
}
class Collection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
  where(field, operator, value) { return new Query(this.db, this.path, false).where(field, operator, value); }
  orderBy(field, direction) { return new Query(this.db, this.path, false).orderBy(field, direction); }
  async get() { return new Query(this.db, this.path, false).get(); }
}
class Query {
  constructor(db, path, group) { this.db = db; this.path = path; this.group = group; this.filters = []; this.orders = []; this.max = Infinity; this.cursor = null; }
  where(field, operator, value) { this.filters.push([field, operator, value]); return this; }
  orderBy(field, direction = 'asc') { this.orders.push([field instanceof FieldPath ? '__name__' : field, direction]); return this; }
  limit(value) { this.max = value; return this; }
  startAfter(snapshot) { this.cursor = snapshot.ref.path; return this; }
  async get() {
    let pairs = [...this.db.docs.entries()].filter(([path]) => this.group
      ? path.split('/').length === 4 && path.split('/')[2] === 'revisions'
      : path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1);
    pairs = pairs.filter(([, data]) => this.filters.every(([field, op, value]) => op === '==' && data[field] === value));
    pairs.sort((a, b) => {
      for (const [field, direction] of this.orders) {
        const left = field === '__name__' ? a[0] : a[1][field];
        const right = field === '__name__' ? b[0] : b[1][field];
        const l = left instanceof Date ? left.getTime() : left;
        const r = right instanceof Date ? right.getTime() : right;
        if (l !== r) return (l < r ? -1 : 1) * (direction === 'desc' ? -1 : 1);
      }
      return a[0].localeCompare(b[0]);
    });
    if (this.cursor) {
      const at = pairs.findIndex(([path]) => path === this.cursor);
      if (at >= 0) pairs = pairs.slice(at + 1);
    }
    const docs = pairs.slice(0, this.max).map(([path, data]) => new Snapshot(new Ref(this.db, path), data));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}
class MemoryDb {
  constructor() { this.docs = new Map(); this.tail = Promise.resolve(); }
  collection(name) { return new Collection(this, name); }
  collectionGroup(name) { return new Query(this, name, true); }
  doc(path) { return new Ref(this, path); }
  async getAll(...refs) { return Promise.all(refs.map(ref => ref.get())); }
  async runTransaction(callback) {
    const run = this.tail.then(async () => {
      const writes = [];
      const tx = {
        get: ref => ref instanceof Query ? ref.get() : ref.get(),
        create: (ref, value) => writes.push(['create', ref.path, clone(value)]),
        update: (ref, value) => writes.push(['update', ref.path, clone(value)]),
      };
      const result = await callback(tx);
      for (const [action, path, value] of writes) {
        if (action === 'create' && this.docs.has(path)) throw Object.assign(new Error('already exists'), { code: 6 });
        if (action === 'update' && !this.docs.has(path)) throw Object.assign(new Error('missing'), { code: 5 });
        this.docs.set(path, action === 'update' ? { ...this.docs.get(path), ...value } : value);
      }
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}

const locumFields = {
  fullName: 'Test Locum', email: 'locum@example.invalid', nric: '990101010101',
  phoneNumber: '0123456789', gender: 'Female', dateOfBirth: '1999-01-01',
  highestEducation: 'Degree', course: 'Optometry',
};
const ownerFields = {
  practiceType: 'Retail Optical Store', clinicName: 'Vision', registrationNumber: '12345',
  address: '22 Jalan Test', state: 'Johor', contactNumber: '0123456789', companyEmail: 'store@example.invalid',
};
function submission(uid, submissionId, accountType, status = 'pending', state = 'submitted', submittedAt = new Date()) {
  return {
    uid, accountType, schemaVersion: 1,
    submittedFields: accountType === 'locum' ? locumFields : ownerFields,
    verificationStatus: status, fingerprint: 'c'.repeat(64), state,
    createdAt: submittedAt, submittedAt, updatedAt: submittedAt,
    document: { path: `verification_documents/${uid}/${submissionId}/document`, name: 'evidence.pdf', contentType: 'application/pdf', size: bytes.length, sha256 },
  };
}
function fixture(options = {}) {
  const db = new MemoryDb();
  const users = new Map([
    ['admin', { disabled: false, customClaims: { admin: true } }],
    ['disabled-admin', { disabled: true, customClaims: { admin: true } }],
    ['locum-user', { disabled: !!options.targetDisabled, customClaims: {} }],
    ['owner-user', { disabled: false, customClaims: {} }],
    ['non-admin', { disabled: false, customClaims: {} }],
  ]);
  const auth = {
    getUser: async uid => {
      if (!users.has(uid)) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      return clone(users.get(uid));
    },
    verifyIdToken: async (token, checkRevoked) => {
      assert.equal(checkRevoked, true);
      if (token === 'invalid') throw Object.assign(new Error('bad token'), { code: 'auth/invalid-id-token' });
      return { uid: token === 'non-admin-token' ? 'non-admin' : token === 'disabled-token' ? 'disabled-admin' : 'admin', admin: token !== 'non-admin-token', auth_time: Date.now() / 1000 };
    },
  };
  const files = new Map();
  const bucket = { file: path => files.get(path) || makeFile({ missing: true }) };
  function addFile(uid, submissionId, fileOptions = {}) {
    const path = `verification_documents/${uid}/${submissionId}/document`;
    const content = fileOptions.bytes ?? bytes;
    files.set(path, {
      exists: async () => [!fileOptions.missing],
      getMetadata: async () => [
        { size: String(fileOptions.size ?? content.length), generation: '123456', contentType: fileOptions.contentType ?? 'application/pdf', metadata: { sha256: fileOptions.customSha ?? sha256 } },
      ],
      createReadStream: () => Readable.from([content]),
    });
  }
  function makeFile() {
    return { exists: async () => [false], getMetadata: async () => { throw Object.assign(new Error('missing'), { code: 404 }); }, createReadStream: () => Readable.from([]) };
  }
  const actor = { uid: 'admin', admin: true, auth_time: Date.now() / 1000 };
  db.docs.set(`verification_submissions/locum-user/revisions/${id}`, submission('locum-user', id, 'locum'));
  db.docs.set('locum_profiles/locum-user', { fullName: 'Test Locum', verificationStatus: 'pending', updatedAt: new Date() });
  db.docs.set('practice_owner_profiles/owner-user', { fullName: 'Test Owner', role: 'Optometrist', verificationStatus: 'pending', updatedAt: new Date() });
  addFile('locum-user', id);
  return { auth, db, bucket, actor, users, addFile, files };
}
function isCode(code) { return error => error instanceof VerificationManagementError && error.code === code; }

test('admin lists pending Locum and Practice Owner submissions, excluding drafts', async () => {
  const f = fixture();
  f.db.docs.set(`verification_submissions/owner-user/revisions/${olderId}`, submission('owner-user', olderId, 'practice_owner'));
  f.addFile('owner-user', olderId);
  f.db.docs.set(`verification_submissions/locum-user/revisions/${'d'.repeat(40)}`, submission('locum-user', 'd'.repeat(40), 'locum', 'pending', 'draft'));
  const locums = await listPendingVerificationSubmissions({ ...f, accountType: 'locum' });
  const owners = await listPendingVerificationSubmissions({ ...f, accountType: 'practice_owner' });
  assert.equal(locums.items.length, 1);
  assert.equal(locums.items[0].uid, 'locum-user');
  assert.equal(locums.items[0].document.path, `verification_documents/locum-user/${id}/document`);
  assert.deepEqual(owners.items.map(item => item.accountType), ['practice_owner']);
  assert.equal(JSON.stringify(locums).includes('bytes'), false);
});

test('list rejects non-admins, disabled admins, invalid account types, and unbounded pages', async () => {
  const f = fixture();
  await assert.rejects(listPendingVerificationSubmissions({ ...f, actor: { ...f.actor, uid: 'non-admin' } }), isCode('permission-denied'));
  await assert.rejects(listPendingVerificationSubmissions({ ...f, actor: { ...f.actor, uid: 'disabled-admin' } }), isCode('permission-denied'));
  await assert.rejects(listPendingVerificationSubmissions({ ...f, accountType: 'clinic' }), isCode('invalid-argument'));
  await assert.rejects(listPendingVerificationSubmissions({ ...f, pageSize: MAX_PAGE_SIZE + 1 }), isCode('invalid-argument'));
});

test('bounded pagination returns a cursor and retrieves the next page', async () => {
  const f = fixture();
  const secondId = 'd'.repeat(40);
  f.db.docs.set(`verification_submissions/locum-user/revisions/${secondId}`, submission('locum-user', secondId, 'locum', 'pending', 'submitted', new Date(Date.now() - 1000)));
  const first = await listPendingVerificationSubmissions({ ...f, accountType: 'locum', pageSize: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextPageToken);
  const second = await listPendingVerificationSubmissions({ ...f, accountType: 'locum', pageSize: 1, pageToken: first.nextPageToken });
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].submissionId, second.items[0].submissionId);
});

test('queue advances over unrelated matching revision documents at a page boundary', async () => {
  const f = fixture();
  const newer = submission('locum-user', 'd'.repeat(40), 'locum', 'pending', 'submitted', new Date(Date.now() + 10000));
  const older = submission('locum-user', 'e'.repeat(40), 'locum', 'pending', 'submitted', new Date(Date.now() - 10000));
  f.db.docs.set('verification_submissions/locum-user/revisions/' + 'd'.repeat(40), newer);
  f.db.docs.set('verification_submissions/locum-user/revisions/' + 'e'.repeat(40), older);
  f.db.docs.set('verification_reviews/other-user/revisions/' + 'f'.repeat(40), {
    uid: 'other-user', accountType: 'locum', state: 'submitted', verificationStatus: 'pending', submittedAt: new Date(Date.now() + 20000),
  });
  const first = await listPendingVerificationSubmissions({ ...f, accountType: 'locum', pageSize: 1 });
  assert.equal(first.items.length, 1);
  assert.notEqual(first.items[0].uid, 'other-user');
  assert.ok(first.nextPageToken);
  const second = await listPendingVerificationSubmissions({ ...f, accountType: 'locum', pageSize: 1, pageToken: first.nextPageToken });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0].submissionId, first.items[0].submissionId);
});

test('details include exact submission, prior revisions, and separate review history', async () => {
  const f = fixture();
  f.db.docs.set(`verification_submissions/locum-user/revisions/${olderId}`, submission('locum-user', olderId, 'locum', 'pending', 'submitted', new Date(Date.now() - 5000)));
  f.db.docs.set(`verification_reviews/locum-user/revisions/${olderId}`, {
    uid: 'locum-user', submissionId: olderId, decision: 'rejected', reviewedBy: 'admin', reviewedAt: new Date(), rejectionReason: 'Expired certificate',
  });
  const result = await getVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id });
  assert.equal(result.submission.submissionId, id);
  assert.equal(result.history.length, 2);
  assert.equal(result.history.find(item => item.submissionId === olderId).review.rejectionReason, 'Expired certificate');
  await assert.rejects(getVerificationSubmission({ ...f, uid: '../bad', submissionId: id }), isCode('invalid-argument'));
  await assert.rejects(getVerificationSubmission({ ...f, uid: 'locum-user', submissionId: 'bad' }), isCode('invalid-argument'));
  await assert.rejects(getVerificationSubmission({ ...f, uid: 'locum-user', submissionId: 'e'.repeat(40) }), isCode('not-found'));
});

test('history uses bounded newest-first pages and always includes the selected submission', async () => {
  const f = fixture();
  for (const [revisionId, age] of [['b'.repeat(40), 3000], ['c'.repeat(40), 2000], ['d'.repeat(40), 1000]]) {
    f.db.docs.set(`verification_submissions/locum-user/revisions/${revisionId}`, submission('locum-user', revisionId, 'locum', 'pending', 'submitted', new Date(Date.now() - age)));
  }
  const first = await getVerificationSubmission({ ...f, uid: 'locum-user', submissionId: 'd'.repeat(40), historyPageSize: 2 });
  assert.equal(first.submission.submissionId, 'd'.repeat(40));
  assert.equal(first.history.length, 2);
  assert.equal(first.historyHasMore, true);
  const second = await getVerificationSubmission({ ...f, uid: 'locum-user', submissionId: 'd'.repeat(40), historyPageSize: 2, historyPageToken: first.historyNextPageToken });
  assert.equal(second.history.length, 2);
  assert.equal(second.historyHasMore, false);
  assert.equal(second.history.some(item => item.submissionId === 'd'.repeat(40)), false);
});

test('history safely signals malformed revisions omitted from a page', async () => {
  const f = fixture();
  f.db.docs.set(`verification_submissions/locum-user/revisions/${olderId}`, { uid: 'locum-user', submittedAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 1000) });
  const result = await getVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, historyPageSize: 2 });
  assert.equal(result.historyHasOmittedRecords, true);
  assert.equal(result.historyOmittedCount, 1);
});

test('approval writes review and matching profile only; target Auth state and revision remain unchanged', async () => {
  const f = fixture({ targetDisabled: true });
  const before = f.db.docs.get(`verification_submissions/locum-user/revisions/${id}`);
  const previous = submission('locum-user', olderId, 'locum', 'pending', 'submitted', new Date(Date.now() - 5000));
  f.db.docs.set(`verification_submissions/locum-user/revisions/${olderId}`, previous);
  const result = await reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approved' });
  assert.equal(result.profileCollection, 'locum_profiles');
  assert.equal(f.db.docs.get('locum_profiles/locum-user').verificationStatus, 'approved');
  assert.equal(f.users.get('locum-user').disabled, true);
  assert.deepEqual(f.db.docs.get(`verification_submissions/locum-user/revisions/${id}`), before);
  assert.deepEqual(f.db.docs.get(`verification_submissions/locum-user/revisions/${olderId}`), previous);
  assert.equal(f.db.docs.get(`verification_reviews/locum-user/revisions/${id}`).decision, 'approved');
  assert.equal(f.db.docs.get(`verification_reviews/locum-user/revisions/${id}`).reviewedBy, 'admin');
  assert.equal(Object.hasOwn(f.db.docs.get(`verification_reviews/locum-user/revisions/${id}`), 'rejectionReason'), false);
});

test('only the latest submitted revision can be reviewed; newer drafts do not supersede it', async () => {
  const f = fixture();
  const latestId = 'd'.repeat(40);
  const staleId = 'b'.repeat(40);
  const now = Date.now();
  f.db.docs.set(`verification_submissions/locum-user/revisions/${staleId}`, submission('locum-user', staleId, 'locum', 'pending', 'submitted', new Date(now - 10000)));
  f.db.docs.set(`verification_submissions/locum-user/revisions/${latestId}`, submission('locum-user', latestId, 'locum', 'pending', 'submitted', new Date(now + 10000)));
  const draftId = 'e'.repeat(40);
  f.db.docs.set(`verification_submissions/locum-user/revisions/${draftId}`, submission('locum-user', draftId, 'locum', 'pending', 'draft', new Date(now + 20000)));
  f.addFile('locum-user', latestId);
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: staleId, decision: 'rejected', rejectionReason: 'Stale revision' }), error => isCode('failed-precondition')(error) && error.message.includes('latest submitted'));
  assert.equal(f.db.docs.has(`verification_reviews/locum-user/revisions/${staleId}`), false);
  assert.equal(f.db.docs.get('locum_profiles/locum-user').verificationStatus, 'pending');
  await reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: latestId, decision: 'approved' });
  assert.equal(f.db.docs.get(`verification_reviews/locum-user/revisions/${latestId}`).decision, 'approved');
  assert.equal(f.db.docs.get('locum_profiles/locum-user').verificationStatus, 'approved');
  assert.equal(f.db.docs.has(`verification_reviews/locum-user/revisions/${draftId}`), false);
});

test('authorization revocation during document validation aborts review before writes', async () => {
  const f = fixture();
  const stored = f.files.get(`verification_documents/locum-user/${id}/document`);
  const originalMetadata = stored.getMetadata;
  stored.getMetadata = async () => {
    const metadata = await originalMetadata();
    f.users.get('admin').disabled = true;
    return metadata;
  };
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approved' }), isCode('permission-denied'));
  assert.equal(f.db.docs.has(`verification_reviews/locum-user/revisions/${id}`), false);
  assert.equal(f.db.docs.get('locum_profiles/locum-user').verificationStatus, 'pending');
});

test('authorization revocation immediately before transaction writes aborts review', async () => {
  const f = fixture();
  const runTransaction = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = callback => {
    f.users.get('admin').customClaims.admin = false;
    return runTransaction(callback);
  };
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'rejected', rejectionReason: 'Reason' }), isCode('permission-denied'));
  assert.equal(f.db.docs.has(`verification_reviews/locum-user/revisions/${id}`), false);
  assert.equal(f.db.docs.get('locum_profiles/locum-user').verificationStatus, 'pending');
});

test('rejection requires nonblank reason, updates only Practice Owner verification status, and leaves account enabled', async () => {
  const f = fixture();
  f.db.docs.set(`verification_submissions/owner-user/revisions/${olderId}`, submission('owner-user', olderId, 'practice_owner'));
  const result = await reviewVerificationSubmission({ ...f, uid: 'owner-user', submissionId: olderId, decision: 'rejected', rejectionReason: '  SSM document is not current  ' });
  assert.equal(result.profileCollection, 'practice_owner_profiles');
  assert.equal(f.db.docs.get('practice_owner_profiles/owner-user').verificationStatus, 'rejected');
  assert.equal(f.users.get('owner-user').disabled, false);
  assert.equal(f.db.docs.get(`verification_reviews/owner-user/revisions/${olderId}`).rejectionReason, 'SSM document is not current');
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'owner-user', submissionId: id, decision: 'rejected' }), isCode('invalid-argument'));
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'owner-user', submissionId: id, decision: 'rejected', rejectionReason: '   ' }), isCode('invalid-argument'));
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'owner-user', submissionId: id, decision: 'approved', rejectionReason: 'unneeded' }), isCode('invalid-argument'));
});

test('review rejects unauthenticated authorization, invalid decision, missing submission, and missing profile', async () => {
  const f = fixture();
  await assert.rejects(reviewVerificationSubmission({ ...f, actor: { ...f.actor, uid: 'disabled-admin' }, uid: 'locum-user', submissionId: id, decision: 'rejected', rejectionReason: 'reason' }), isCode('permission-denied'));
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approve' }), isCode('invalid-argument'));
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: 'e'.repeat(40), decision: 'rejected', rejectionReason: 'reason' }), isCode('not-found'));
  f.db.docs.delete('locum_profiles/locum-user');
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'rejected', rejectionReason: 'reason' }), isCode('failed-precondition'));
  assert.equal(f.db.docs.has(`verification_reviews/locum-user/revisions/${id}`), false);
});

test('drafts and previously reviewed submissions cannot be reviewed twice', async () => {
  const f = fixture();
  const draftId = 'e'.repeat(40);
  f.db.docs.set(`verification_submissions/locum-user/revisions/${draftId}`, submission('locum-user', draftId, 'locum', 'pending', 'draft'));
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: draftId, decision: 'rejected', rejectionReason: 'reason' }), isCode('failed-precondition'));
  await reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'rejected', rejectionReason: 'reason' });
  await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approved' }), isCode('already-exists'));
});

test('concurrent reviews produce one decision with no conflicting profile update', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approved' }),
    reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'rejected', rejectionReason: 'Needs correction' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const review = f.db.docs.get(`verification_reviews/locum-user/revisions/${id}`);
  assert.equal(f.db.docs.get('locum_profiles/locum-user').verificationStatus, review.decision);
});

test('missing or mismatched private objects prevent approval', async () => {
  for (const options of [{ missing: true }, { size: bytes.length + 1 }, { bytes: Buffer.from('altered bytes') }]) {
    const f = fixture();
    f.addFile('locum-user', id, options);
    await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approved' }), isCode('failed-precondition'));
    assert.equal(f.db.docs.has(`verification_reviews/locum-user/revisions/${id}`), false);
    assert.equal(f.db.docs.get('locum_profiles/locum-user').verificationStatus, 'pending');
  }
});

test('approval accepts valid PDF, PNG and JPEG byte signatures', async () => {
  const cases = [
    ['application/pdf', Buffer.from('%PDF-1.7\ncertificate')],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])],
  ];
  for (const [contentType, fileBytes] of cases) {
    const f = fixture();
    const current = f.db.docs.get(`verification_submissions/locum-user/revisions/${id}`);
    current.document = { ...current.document, contentType, size: fileBytes.length, sha256: createHash('sha256').update(fileBytes).digest('hex') };
    f.addFile('locum-user', id, { bytes: fileBytes, contentType, customSha: current.document.sha256 });
    await reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approved' });
    assert.equal(f.db.docs.get(`verification_reviews/locum-user/revisions/${id}`).decision, 'approved');
  }
});

test('approval rejects invalid, truncated and mismatched file signatures', async () => {
  const cases = [
    { bytes: Buffer.from('not a document'), contentType: 'application/pdf' },
    { bytes: Buffer.from('%PD'), contentType: 'application/pdf' },
    { bytes: Buffer.from('%PDF-1.7'), contentType: 'image/png' },
    { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), contentType: 'image/jpeg' },
    { bytes: Buffer.alloc(0), contentType: 'application/pdf' },
  ];
  for (const entry of cases) {
    const f = fixture();
    const current = f.db.docs.get(`verification_submissions/locum-user/revisions/${id}`);
    const digest = createHash('sha256').update(entry.bytes).digest('hex');
    current.document = { ...current.document, contentType: entry.contentType, size: entry.bytes.length || 1, sha256: digest };
    f.addFile('locum-user', id, { bytes: entry.bytes, contentType: entry.contentType, size: entry.bytes.length || 1, customSha: digest });
    await assert.rejects(reviewVerificationSubmission({ ...f, uid: 'locum-user', submissionId: id, decision: 'approved' }), isCode('failed-precondition'));
    assert.equal(f.db.docs.has(`verification_reviews/locum-user/revisions/${id}`), false);
  }
});

test('private document handler denies non-admin and disabled users before serving bytes', async () => {
  for (const token of ['non-admin-token', 'disabled-token']) {
    const f = fixture();
    const handler = createVerificationDocumentHandler({ auth: f.auth, db: f.db, bucket: f.bucket, allowedOrigins: ['https://admin.example'] });
    const response = {
      headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
    };
    await handler({
      method: 'GET', headers: { origin: 'https://admin.example', authorization: `Bearer ${token}` },
      rawHeaders: ['Origin', 'https://admin.example', 'Authorization', `Bearer ${token}`],
      query: { uid: 'locum-user', submissionId: id }, get(name) { return this.headers[name.toLowerCase()]; },
    }, response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0');
  }
});

test('private document handler streams only the canonical object with no-store headers', async () => {
  const f = fixture();
  const handler = createVerificationDocumentHandler({ auth: f.auth, db: f.db, bucket: f.bucket, allowedOrigins: ['https://admin.example'] });
  const response = new Writable({
    write(chunk, encoding, callback) { this.chunks ||= []; this.chunks.push(Buffer.from(chunk)); callback(); },
  });
  response.headers = {};
  response.set = function(key, value) { this.headers[key] = value; return this; };
  response.status = function(code) { this.statusCode = code; return this; };
  response.json = function(value) { this.body = value; this.end(); return this; };
  response.get = function(name) { return this.headers[name]; };
  const finished = new Promise((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
  await handler({
    method: 'GET', headers: { origin: 'https://admin.example', authorization: 'Bearer valid' },
    rawHeaders: ['Origin', 'https://admin.example', 'Authorization', 'Bearer valid'],
    query: { uid: 'locum-user', submissionId: id }, get(name) { return this.headers[name.toLowerCase()]; },
  }, response);
  await finished;
  assert.equal(Buffer.concat(response.chunks).toString(), bytes.toString());
  assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal(response.headers['Content-Length'], String(bytes.length));
  assert.match(response.headers['Content-Disposition'], /^attachment;/);
  assert.equal(Object.values(response.headers).some(value => String(value).includes('token=')), false);
});

test('bearer authentication checks revocation and rejects duplicate authorization headers', async () => {
  const f = fixture();
  const { verifyBearerAdmin } = require('./verification_management');
  const actor = await verifyBearerAdmin({ auth: f.auth, request: { headers: { authorization: 'Bearer valid' }, rawHeaders: ['Authorization', 'Bearer valid'] } });
  assert.equal(actor.uid, 'admin');
  await assert.rejects(verifyBearerAdmin({ auth: f.auth, request: { headers: { authorization: 'Bearer valid' }, rawHeaders: ['Authorization', 'Bearer a', 'authorization', 'Bearer b'] } }), isCode('invalid-argument'));
  await assert.rejects(verifyBearerAdmin({ auth: f.auth, request: { headers: { authorization: 'Bearer invalid' }, rawHeaders: ['Authorization', 'Bearer invalid'] } }), isCode('unauthenticated'));
});
