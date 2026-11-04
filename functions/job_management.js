"use strict";
const { FieldValue } = require('firebase-admin/firestore');
const { ManagementError } = require('./management');
const fail = (code, message) => { throw new ManagementError(code, message); };
async function manageJob({ auth, db, actor, data, demoPolicy, now = Date.now() }) {
  if (!actor || actor.admin !== true) fail('permission-denied', 'Administrator access required.');
  const caller = await auth.getUser(actor.uid);
  if (caller.disabled || caller.customClaims?.admin !== true) fail('permission-denied', 'Administrator authorization is no longer valid.');
  if (!data || Array.isArray(data) || Object.keys(data).some(k => !['jobId', 'action', 'expectedStatus'].includes(k)) ||
      typeof data.jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.jobId) ||
      !['status', 'softDelete'].includes(data.action) ||
      (data.action === 'status' && 'expectedStatus' in data) ||
      (data.action === 'softDelete' && (typeof data.expectedStatus !== 'string' || data.expectedStatus.length > 128)))
    fail('invalid-argument', 'Invalid job request.');
  const approved = demoPolicy?.allowsJob?.(data.jobId) === true;
  if (data.action === 'softDelete') {
    if (!approved) fail('failed-precondition', 'Job deletion is off or this job is not approved.');
    if (!Number.isFinite(actor.auth_time) || actor.auth_time > now / 1000 || now / 1000 - actor.auth_time > 300)
      fail('unauthenticated', 'Please sign out and sign in again before deleting jobs.');
  }
  const ref = db.collection('job_postings').doc(data.jobId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'Job posting not found.');
    const status = snap.data().status;
    if (typeof status !== 'string' || !status) fail('failed-precondition', 'Job status requires review.');
    if (data.action === 'status') return { status, mutationsEnabled: approved && status !== 'deleted' };
    if (status === 'deleted') fail('failed-precondition', 'This posting is already deleted.');
    if (status !== data.expectedStatus) fail('aborted', 'Job status changed. Refresh before retrying.');
    tx.update(ref, { status: 'deleted', deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { status: 'deleted', mutationsEnabled: false };
  });
}
module.exports = { manageJob };
