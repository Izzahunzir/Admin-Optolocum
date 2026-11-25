'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateDraft, finalizeVerification, finalizeVerificationRequest } = require('./finalize_verification');

const uid = 'synthetic-user', id = 'a'.repeat(40);
const fields = { fullName: 'Test User', email: 'test@example.com', nric: '990101010101', phoneNumber: '0123456789', gender: 'Female', dateOfBirth: '1999-01-01', highestEducation: 'Degree', course: 'Optometry' };
const sha256 = createHash('sha256').update('%PDF-synthetic').digest('hex');
function draft() {
  const sorted = Object.fromEntries(Object.keys(fields).sort().map(k => [k, fields[k]]));
  return { uid, accountType: 'locum', schemaVersion: 1, submittedFields: { ...fields }, verificationStatus: 'pending',
    fingerprint: createHash('sha256').update(JSON.stringify([uid, 'locum', sorted, sha256, 'file.pdf'])).digest('hex'),
    document: { path: `verification_documents/${uid}/${id}/document`, name: 'file.pdf', contentType: 'application/pdf', size: 14, sha256 },
    state: 'draft', createdAt: { toMillis: () => 100 }, updatedAt: { toMillis: () => 100 } };
}
test('accepts a complete valid synthetic draft and rejects altered fields or metadata', () => {
  const data = draft();
  assert.equal(validateDraft(data, uid, id), data);
  for (const invalid of [
    { ...data, uid: 'another-user' },
    { ...data, submittedFields: { ...fields, fullName: 'Changed' } },
    { ...data, document: { ...data.document, path: 'public/file' } },
    { ...data, document: { ...data.document, size: 52428801 } },
    { ...data, state: 'submitted' },
  ]) assert.throws(() => validateDraft(invalid, uid, id));
});
test('missing or invalid Storage object never starts a Firestore transaction', async () => {
  let transactionStarted = false;
  const ref = { get: async () => ({ exists: true, data: draft }) };
  const db = { collection: name => name === 'account_management'
    ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ trustedAccountType: 'locum' }) }) }) }
    : { doc: () => ({ collection: () => ({ doc: () => ref }) }) }, runTransaction: async () => { transactionStarted = true; } };
  await assert.rejects(finalizeVerification({ db, uid, submissionId: id, verifyStorageDocument: async () => { throw Error('missing object'); } }), /missing object/);
  assert.equal(transactionStarted, false);
});
test('callable adapter rejects unauthenticated, forged and disabled requests before persistence', async () => {
  const request = { data: { submissionId: id }, auth: { uid }, rawRequest: { headers: { authorization: 'Bearer test-token' }, rawHeaders: ['Authorization', 'Bearer test-token'] } };
  const auth = { verifyIdToken: async () => ({ uid }), getUser: async () => ({ disabled: true }) };
  await assert.rejects(finalizeVerificationRequest({ request: { ...request, data: { submissionId: id, uid: 'forged' } }, auth }), { code: 'invalid-argument' });
  await assert.rejects(finalizeVerificationRequest({ request: { ...request, auth: { uid: 'other' } }, auth }), { code: 'unauthenticated' });
  await assert.rejects(finalizeVerificationRequest({ request, auth }), { code: 'permission-denied' });
  await assert.rejects(finalizeVerificationRequest({ request, auth: { ...auth, verifyIdToken: async () => { throw Error('revoked'); } } }), { code: 'unauthenticated' });
});
