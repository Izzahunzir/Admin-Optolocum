"use strict";
const { assertEmulatorEnvironment } = require('./safety');
const { ManagementError } = require('../management');
const fail = (code, message) => { throw new ManagementError(code, message); };
const validUid = uid => typeof uid === 'string' && /^[^/\s\x00-\x1f\x7f]{1,128}$/.test(uid) && !['.', '..'].includes(uid);

// No production entrypoint imports this module. Callers supply a verified ID token,
// never a client-selected actor. Auth and Firestore are not a cross-service transaction.
async function provisionAccount({ auth, db, actor, data, now = Date.now() }) {
  assertEmulatorEnvironment();
  if (!data || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'kind,uid' ||
      !validUid(data.uid) || !['locum', 'practice_owner'].includes(data.kind)) fail('invalid-argument', 'Expected only a valid uid and kind.');
  if (!actor || actor.admin !== true || !validUid(actor.uid)) fail('permission-denied', 'Administrator required.');
  const seconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(actor.auth_time) ||
      actor.auth_time > seconds || seconds - actor.auth_time > 300) fail('unauthenticated', 'Recent administrator login required.');
  const caller = await auth.getUser(actor.uid);
  const revoked = Date.parse(caller.tokensValidAfterTime);
  if (caller.disabled || caller.customClaims?.admin !== true || !Number.isFinite(revoked) || actor.auth_time < revoked / 1000) fail('permission-denied', 'Administrator session is no longer valid.');
  if (data.uid === actor.uid) fail('failed-precondition', 'Self provisioning is prohibited.');
  const target = await auth.getUser(data.uid);
  if (target.disabled || target.customClaims?.admin === true || target.customClaims?.accountDisabledAt !== undefined) fail('failed-precondition', 'Disabled or administrator accounts require separate recovery.');
  const cutoff = Date.parse(target.tokensValidAfterTime);
  if (!Number.isFinite(cutoff) || cutoff < 0) fail('failed-precondition', 'Invalid Authentication cutoff.');
  const { Timestamp } = require('firebase-admin/firestore');
  return db.runTransaction(async tx => {
    assertEmulatorEnvironment();
    const ref = db.collection('account_access').doc(data.uid);
    const own = db.collection(data.kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles').doc(data.uid);
    const other = db.collection(data.kind === 'locum' ? 'practice_owner_profiles' : 'locum_profiles').doc(data.uid);
    const [access, profile, conflict] = await Promise.all([tx.get(ref), tx.get(own), tx.get(other)]);
    if (access.exists) fail('already-exists', 'Access record exists; provisioning never overwrites it.');
    if (!profile.exists || conflict.exists || profile.data().verificationStatus !== 'verified') fail('failed-precondition', 'Exactly one verified profile is required; onboarding needs a separate intake workflow.');
    // Recheck Auth on every transaction retry. External Auth writers still require
    // operational coordination before any production version could be approved.
    const latest = await auth.getUser(data.uid);
    if (latest.disabled || latest.customClaims?.admin === true || latest.customClaims?.accountDisabledAt !== undefined || latest.tokensValidAfterTime !== target.tokensValidAfterTime) fail('aborted', 'Authentication state changed.');
    const validAfter = Math.max(seconds, Math.ceil(cutoff / 1000));
    tx.create(ref, { state: 'active', validAfter, updatedAt: Timestamp.fromMillis(now), updatedBy: actor.uid, schemaVersion: 1 });
    return { uid: data.uid, state: 'active', validAfter, requiresNewLogin: true };
  });
}
module.exports = { provisionAccount, validUid };
