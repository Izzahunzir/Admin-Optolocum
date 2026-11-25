'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, FieldPath } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { assignAccountType } = require('./account_assignment');
const { finalizeVerification, finalizeVerificationRequest } = require('./finalize_verification');
const { verifyStorageDocument, reviewVerificationSubmission, listPendingVerificationSubmissions } = require('./verification_management');

test('isolated assignment, finalization, review and supersession', { timeout: 60000 }, async t => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-optolocum-verification');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:9298');
  const app = initializeApp({ projectId: 'demo-optolocum-verification', storageBucket: 'demo-optolocum-verification.appspot.com' }, randomUUID());
  const db = getFirestore(app), bucket = getStorage(app).bucket();
  t.after(async () => { await db.terminate(); await deleteApp(app); });
  const uid = `synthetic-${randomUUID()}`, admin = `admin-${randomUUID()}`;
  const actor = { uid: admin, admin: true, auth_time: Date.now() / 1000 };
  const auth = { getUser: async id => ({ disabled: false, customClaims: id === admin ? { admin: true } : {} }) };
  const assignment = { auth, db, actor, uid, accountType: 'locum', evidenceReference: 'synthetic-case' };
  await assignAccountType(assignment);
  await assert.rejects(assignAccountType({ ...assignment, accountType: 'practice_owner' }));
  const data = Buffer.from('%PDF-1.7\nsynthetic evidence');
  const sha256 = createHash('sha256').update(data).digest('hex');
  const fields = { fullName: 'Synthetic Locum', email: 'test@example.invalid', nric: '990101010101', phoneNumber: '0123456789', gender: 'Female', dateOfBirth: '1999-01-01', highestEducation: 'Degree', course: 'Optometry' };
  const sorted = Object.fromEntries(Object.keys(fields).sort().map(key => [key, fields[key]]));
  const fingerprint = createHash('sha256').update(JSON.stringify([uid, 'locum', sorted, sha256, 'evidence.pdf'])).digest('hex');
  async function draft(id) {
    const path = `verification_documents/${uid}/${id}/document`;
    const ref = db.collection('verification_submissions').doc(uid).collection('revisions').doc(id);
    await ref.set({ uid, accountType: 'locum', schemaVersion: 1, submittedFields: fields, verificationStatus: 'pending', fingerprint,
      document: { path, name: 'evidence.pdf', contentType: 'application/pdf', size: data.length, sha256 }, state: 'draft', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { ref, path };
  }
  const id = 'a'.repeat(40), first = await draft(id);
  const args = { db, bucket, uid, submissionId: id, verifyStorageDocument, FieldValue, FieldPath };
  await assert.rejects(finalizeVerification(args));
  await bucket.file(first.path).save(data, { metadata: { contentType: 'application/pdf', metadata: { sha256 } } });
  await Promise.all([finalizeVerification(args), finalizeVerification(args)]);
  assert.equal((await first.ref.get()).data().verificationStatus, 'pending');
  const id2 = 'b'.repeat(40), second = await draft(id2);
  await bucket.file(second.path).save(data, { metadata: { contentType: 'application/pdf', metadata: { sha256 } } });
  await finalizeVerification({ ...args, submissionId: id2 });
  assert.equal((await first.ref.get()).data().verificationStatus, 'superseded');
  await assert.rejects(reviewVerificationSubmission({ auth, db, bucket, actor, uid, submissionId: id, decision: 'approved' }));
  await reviewVerificationSubmission({ auth, db, bucket, actor, uid, submissionId: id2, decision: 'rejected', rejectionReason: 'Synthetic reason' });
  assert.equal((await second.ref.get()).data().verificationStatus, 'rejected');
  assert.equal((await db.collection('locum_profiles').doc(uid).get()).data().verificationStatus, 'rejected');
  assert.equal((await listPendingVerificationSubmissions({ auth, db, actor })).items.length, 0);
  const id3 = 'c'.repeat(40), third = await draft(id3);
  await bucket.file(third.path).save(data, { metadata: { contentType: 'application/pdf', metadata: { sha256 } } });
  await finalizeVerification({ ...args, submissionId: id3 });
  const id4 = 'd'.repeat(40), fourth = await draft(id4);
  await bucket.file(fourth.path).save(data, { metadata: { contentType: 'application/pdf', metadata: { sha256 } } });
  const race = await Promise.allSettled([
    reviewVerificationSubmission({ auth, db, bucket, actor, uid, submissionId: id3, decision: 'approved' }),
    finalizeVerification({ ...args, submissionId: id4 }),
  ]);
  assert.equal(race[1].status, 'fulfilled');
  assert.equal((await fourth.ref.get()).data().verificationStatus, 'pending');
  assert.equal((await db.collection('locum_profiles').doc(uid).get()).data().verificationStatus, 'pending');
  const oldStatus = (await third.ref.get()).data().verificationStatus;
  assert.ok(['approved', 'superseded'].includes(oldStatus));
});

test('Auth emulator rejects forged callable identity and disabled accounts', { timeout: 30000 }, async t => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-optolocum-verification');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
  const app = initializeApp({ projectId: 'demo-optolocum-verification' }, randomUUID());
  const auth = require('firebase-admin/auth').getAuth(app);
  t.after(async () => deleteApp(app));
  const uid = `synthetic-${randomUUID()}`, email = `${uid}@example.invalid`, password = 'Synthetic-password-123!';
  await auth.createUser({ uid, email, password });
  const response = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(response.status, 200);
  const { idToken } = await response.json();
  const rawRequest = { headers: { authorization: `Bearer ${idToken}` }, rawHeaders: ['Authorization', `Bearer ${idToken}`] };
  const request = { data: { submissionId: 'a'.repeat(40) }, auth: { uid: 'forged' }, rawRequest };
  await assert.rejects(finalizeVerificationRequest({ request, auth }), { code: 'unauthenticated' });
  await auth.updateUser(uid, { disabled: true });
  await assert.rejects(finalizeVerificationRequest({ request: { ...request, auth: { uid } }, auth }), error => ['unauthenticated', 'permission-denied'].includes(error.code));
});
