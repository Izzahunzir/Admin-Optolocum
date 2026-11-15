"use strict";
const { FieldValue } = require('firebase-admin/firestore');
const { ManagementError } = require('./management');
const fail = (code, message) => { throw new ManagementError(code, message); };

function isScheduledEndPast(job, now) {
  const dateValue = job.jobDate;
  const date = dateValue instanceof Date ? dateValue : dateValue?.toDate?.();
  const endTime = typeof job.endTime === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(job.endTime) : null;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !endTime ||
      Number(endTime[1]) > 23 || Number(endTime[2]) > 59) {
    fail('failed-precondition', 'The posting schedule cannot be verified. It was not restored.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const datePart = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const cutoff = Date.parse(`${datePart.year}-${datePart.month}-${datePart.day}T${endTime[1].padStart(2, '0')}:${endTime[2]}:00+08:00`);
  return cutoff <= now;
}

async function manageJob({ auth, db, actor, data, demoPolicy, now = Date.now() }) {
  if (!actor || actor.admin !== true) fail('permission-denied', 'Administrator access required.');
  const caller = await auth.getUser(actor.uid);
  if (caller.disabled || caller.customClaims?.admin !== true) fail('permission-denied', 'Administrator authorization is no longer valid.');
  if (!data || Array.isArray(data) || Object.keys(data).some(k => !['jobId', 'action', 'expectedStatus'].includes(k)) ||
      typeof data.jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.jobId) ||
      !['status', 'softDelete', 'restore'].includes(data.action) ||
      (data.action === 'status' && 'expectedStatus' in data) ||
      (data.action !== 'status' && (typeof data.expectedStatus !== 'string' || data.expectedStatus.length > 128)) ||
      (data.action === 'restore' && data.expectedStatus !== 'deleted'))
    fail('invalid-argument', 'Invalid job request.');
  const mutationsEnabled = demoPolicy?.jobSoftDeleteEnabled === true;
  if (data.action !== 'status') {
    if (!mutationsEnabled) fail('failed-precondition', 'Job soft deletion is disabled.');
    if (!Number.isFinite(actor.auth_time) || actor.auth_time > now / 1000 || now / 1000 - actor.auth_time > 300)
      fail('unauthenticated', 'Please sign out and sign in again before changing job status.');
  }
  const ref = db.collection('job_postings').doc(data.jobId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'Job posting not found.');
    const status = snap.data().status;
    if (typeof status !== 'string' || !status) fail('failed-precondition', 'Job status requires review.');
    if (data.action === 'status') return { status, mutationsEnabled };
    if (data.action === 'softDelete' && status === 'deleted') fail('failed-precondition', 'This posting is already deleted.');
    if (status !== data.expectedStatus) fail('aborted', 'Job status changed. Refresh before retrying.');
    if (data.action === 'softDelete') {
      tx.update(ref, {
        status: 'deleted', statusBeforeDelete: status,
        deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return { status: 'deleted', mutationsEnabled: true };
    }

    const previousStatus = snap.data().statusBeforeDelete;
    if (status !== 'deleted' || typeof previousStatus !== 'string' || !previousStatus || previousStatus === 'deleted') {
      fail('failed-precondition', 'The previous posting status is unavailable. It was not restored.');
    }
    let restoredStatus = previousStatus;
    if (previousStatus === 'available') {
      const applications = await tx.get(db.collection('applications').where('jobId', '==', data.jobId));
      const hasAcceptedApplication = applications.docs.some(application =>
        ['accepted', 'hired', 'completed'].includes(application.data().status));
      if (hasAcceptedApplication) restoredStatus = 'filled';
      else if (isScheduledEndPast(snap.data(), now)) restoredStatus = 'expired';
    }
    tx.update(ref, { status: restoredStatus, updatedAt: FieldValue.serverTimestamp() });
    return { status: restoredStatus, mutationsEnabled: true };
  });
}
module.exports = { manageJob, isScheduledEndPast };
