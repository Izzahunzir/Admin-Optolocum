'use strict';
const express = require('express');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
function validate(data) {
  if (!exact(data, ['requestId', 'recoverySecret', 'email', 'password', 'accountType', 'profile']) ||
      typeof data.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(data.requestId) ||
      typeof data.recoverySecret !== 'string' || !/^[a-f0-9]{64}$/.test(data.recoverySecret) ||
      typeof data.email !== 'string' || data.email.length > 254 || data.email !== data.email.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ||
      typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128 ||
      !['locum', 'practice_owner'].includes(data.accountType)) fail('invalid-argument', 'Invalid enrollment request.');
  const keys = data.accountType === 'locum' ? ['fullName'] : ['fullName', 'phoneNumber', 'role'];
  if (!exact(data.profile, keys) || keys.some(k => typeof data.profile[k] !== 'string' || !data.profile[k].trim() || data.profile[k] !== data.profile[k].trim() || data.profile[k].length > 200)) fail('invalid-argument', 'Invalid profile.');
  if (data.accountType === 'practice_owner' && (!['HR', 'Manager', 'Optical Owner'].includes(data.profile.role) || !/^\+?[0-9]{7,15}$/.test(data.profile.phoneNumber.replace(/[\s()-]/g, '')))) fail('invalid-argument', 'Invalid profile.');
}
async function enroll({ auth, db, data }) {
  validate(data);
  const { requestId, recoverySecret, email, password, accountType, profile } = data;
  const ref = db.collection('registration_intents').doc(requestId);
  const secretHash = hash(recoverySecret);
  const profileHash = hash(JSON.stringify(Object.keys(profile).sort().map(k => [k, profile[k]])));
  const candidate = `enroll-${randomBytes(24).toString('hex')}`;
  const intent = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const old = snap.data();
      if (!equal(old.secretHash, secretHash) || old.email !== email || old.accountType !== accountType || old.profileHash !== profileHash) fail('permission-denied', 'Enrollment request cannot be recovered.');
      return old;
    }
    const value = { uid: candidate, email, accountType, profileHash, secretHash, state: 'pending', createdAt: FieldValue.serverTimestamp() };
    tx.create(ref, value);
    return value;
  });
  // A random server-created UID is bound to the private intent before Auth is
  // touched. An existing email is never looked up or attached to the intent.
  let user;
  try { user = await auth.getUser(intent.uid); }
  catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    try { user = await auth.createUser({ uid: intent.uid, email, password, disabled: false }); }
    catch (createError) {
      if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(createError.code)) fail('failed-precondition', 'Account creation could not be completed.');
      try { user = await auth.getUser(intent.uid); }
      catch (_) { fail('failed-precondition', 'Account creation could not be completed.'); }
    }
  }
  const assertAvailable = async () => {
    const current = await auth.getUser(intent.uid);
    if (current.disabled || Object.keys(current.customClaims || {}).length !== 0 || current.email?.toLowerCase() !== email) fail('permission-denied', 'Account is unavailable.');
  };
  if (user.uid !== intent.uid || user.email?.toLowerCase() !== email) fail('permission-denied', 'Account is unavailable.');
  await assertAvailable();
  const assignment = db.collection('account_management').doc(intent.uid);
  const target = db.collection(accountType === 'locum' ? 'locum_profiles' : 'practice_owner_profiles').doc(intent.uid);
  const other = db.collection(accountType === 'locum' ? 'practice_owner_profiles' : 'locum_profiles').doc(intent.uid);
  const access = db.collection('account_access').doc(intent.uid);
  await db.runTransaction(async tx => {
    const [currentIntent, existing, targetSnap, otherSnap, accessSnap] = await Promise.all([tx.get(ref), tx.get(assignment), tx.get(target), tx.get(other), tx.get(access)]);
    if (!currentIntent.exists || !equal(currentIntent.data().secretHash, secretHash) || currentIntent.data().uid !== intent.uid || currentIntent.data().accountType !== accountType || currentIntent.data().profileHash !== profileHash) fail('permission-denied', 'Enrollment request cannot be recovered.');
    if (currentIntent.data().state === 'completed') {
      if (!existing.exists || existing.data().trustedAccountType !== accountType || existing.data().enrollmentRequestId !== requestId || !targetSnap.exists || otherSnap.exists || !accessSnap.exists) fail('failed-precondition', 'Account requires administrator review.');
      return;
    }
    if (currentIntent.data().state !== 'pending' || existing.exists || targetSnap.exists || otherSnap.exists || accessSnap.exists) fail('failed-precondition', 'Account requires administrator review.');
    await assertAvailable();
    tx.create(assignment, { trustedAccountType: accountType, accountTypeAssignedBy: 'registration', accountTypeAssignedAt: FieldValue.serverTimestamp(), enrollmentRequestId: requestId });
    tx.create(target, { ...profile, email, verificationStatus: 'unverified', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.create(access, { state: 'active', validAfter: Math.floor(Date.now() / 1000) });
    tx.update(ref, { state: 'completed', completedAt: FieldValue.serverTimestamp() });
  });
  return { uid: intent.uid, accountType };
}
function createEnrollmentRouter({ auth, db }) {
  const router = express.Router();
  router.post('/', express.json({ limit: '4kb', strict: true }), async (req, res) => {
    try {
      if (!req.is('application/json') || Object.keys(req.query).length || req.headers.authorization) fail('invalid-argument', 'Invalid enrollment request.');
      const result = await enroll({ auth, db, data: req.body });
      res.json({ data: result });
    } catch (error) {
      const statuses = { 'invalid-argument': 400, 'permission-denied': 403, 'failed-precondition': 409 };
      const status = statuses[error.code] || (error.type === 'entity.too.large' ? 413 : 503);
      res.status(status).json({ error: { code: statuses[error.code] ? error.code : 'unavailable', message: status === 503 ? 'Enrollment could not be completed. Retry the same request.' : error.message } });
    }
  });
  return router;
}
module.exports = { enroll, createEnrollmentRouter };
