"use strict";

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { assertEmulatorEnvironment, createEmulatorServices } = require('./safety');
assertEmulatorEnvironment();
const { reviewVerificationSubmission } = require('../verification_management');
const { deleteApp } = require('firebase-admin/app');

test('Firestore emulator serializes competing verification decisions', { timeout: 60000 }, async t => {
  const { app, auth, db } = createEmulatorServices();
  t.after(async () => { await db.terminate(); await deleteApp(app); });
  const suffix = randomUUID().replaceAll('-', '');
  const uid = `verification-user-${suffix}`;
  const adminUid = `verification-admin-${suffix}`;
  const submissionId = 'a'.repeat(40);
  await auth.createUser({ uid: adminUid, email: `${adminUid}@example.invalid` });
  await auth.setCustomUserClaims(adminUid, { admin: true });
  const now = new Date();
  const bytes = Buffer.from('%PDF-1.7\nemulator-only evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const submissionRef = db.collection('verification_submissions').doc(uid).collection('revisions').doc(submissionId);
  const reviewRef = db.collection('verification_reviews').doc(uid).collection('revisions').doc(submissionId);
  const profileRef = db.collection('locum_profiles').doc(uid);
  await submissionRef.set({
    uid, accountType: 'locum', schemaVersion: 1,
    submittedFields: {
      fullName: 'Synthetic Locum', email: 'synthetic@example.invalid', nric: '990101010101',
      phoneNumber: '0123456789', gender: 'Female', dateOfBirth: '1999-01-01',
      highestEducation: 'Degree', course: 'Optometry',
    },
    verificationStatus: 'pending', fingerprint: 'c'.repeat(64), state: 'submitted',
    createdAt: now, updatedAt: now, submittedAt: now,
    document: {
      path: `verification_documents/${uid}/${submissionId}/document`,
      name: 'evidence.pdf', contentType: 'application/pdf', size: bytes.length, sha256,
    },
  });
  await profileRef.set({ fullName: 'Synthetic Locum', verificationStatus: 'pending', updatedAt: now });
  const bucket = { file: () => ({
    exists: async () => [true],
    getMetadata: async () => [{ size: String(bytes.length), generation: '123456', contentType: 'application/pdf', metadata: { sha256 } }],
    createReadStream: () => Readable.from([bytes]),
  }) };
  const actor = { uid: adminUid, admin: true, auth_time: Date.now() / 1000 };
  const outcomes = await Promise.allSettled([
    reviewVerificationSubmission({ auth, db, bucket, actor, uid, submissionId, decision: 'approved' }),
    reviewVerificationSubmission({ auth, db, bucket, actor, uid, submissionId, decision: 'rejected', rejectionReason: 'Synthetic conflict test' }),
  ]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(value => value.status === 'rejected').length, 1);
  const [review, profile, submission] = await Promise.all([reviewRef.get(), profileRef.get(), submissionRef.get()]);
  assert.equal(review.exists, true);
  assert.equal(review.data().decision, profile.data().verificationStatus);
  assert.equal(submission.data().verificationStatus, review.data().decision);
  assert.equal(submission.data().state, 'submitted');
  // The isolated demo project is disposable; leave seeded records for emulator teardown.
});
