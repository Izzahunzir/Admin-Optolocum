"use strict";

const DELETE_WAIT_MS = 61 * 60 * 1000;
class ManagementError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ManagementError(code, message); };

async function manageAccount({ auth, db, actor, data, now = Date.now() }) {
  if (!actor || actor.admin !== true) fail('permission-denied', 'Administrator access required.');
  const { uid, kind, action } = data || {};
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) fail('invalid-argument', 'Invalid account ID.');
  if (!['locum', 'practice_owner'].includes(kind) || !['status', 'setDisabled', 'delete'].includes(action)) fail('invalid-argument', 'Invalid account action.');
  const caller = await auth.getUser(actor.uid);
  if (caller.disabled || caller.customClaims?.admin !== true) fail('permission-denied', 'Administrator access is no longer valid.');
  if (actor.uid === uid) fail('failed-precondition', 'You cannot manage your own account.');
  const target = await auth.getUser(uid);
  if (target.customClaims?.admin === true) fail('failed-precondition', 'Administrator accounts are protected.');
  const profilePath = kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles';
  const profile = await db.collection(profilePath).doc(uid).get();
  if (!profile.exists) fail('not-found', 'The selected profile no longer exists.');
  if (action === 'status') return { disabled: target.disabled };
  if (typeof actor.auth_time !== 'number' || now / 1000 - actor.auth_time > 300) fail('unauthenticated', 'Please sign out and sign in again before managing accounts.');

  if (action === 'setDisabled') {
    if (typeof data.disabled !== 'boolean' || typeof data.expectedDisabled !== 'boolean') fail('invalid-argument', 'Invalid account state.');
    if (target.disabled !== data.expectedDisabled) fail('aborted', 'Account status changed. Refresh it and try again.');
    const claims = { ...(target.customClaims || {}) };
    if (data.disabled) claims.accountDisabledAt = Math.floor(now / 1000);
    else delete claims.accountDisabledAt;
    await auth.setCustomUserClaims(uid, claims);
    await auth.updateUser(uid, { disabled: data.disabled });
    // Revoke on both transitions so enabling never restores existing sessions.
    await auth.revokeRefreshTokens(uid);
    return { disabled: data.disabled };
  }

  if (data.confirmUid !== uid) fail('invalid-argument', 'Account confirmation does not match.');
  if (!target.disabled) fail('failed-precondition', 'Disable this account before deleting it.');
  const revokedAt = Date.parse(target.tokensValidAfterTime);
  const disabledAt = target.customClaims?.accountDisabledAt * 1000;
  if (!Number.isFinite(disabledAt) || !Number.isFinite(revokedAt) || now - Math.max(revokedAt, disabledAt) < DELETE_WAIT_MS) fail('failed-precondition', 'Wait at least 61 minutes after disabling through this dashboard before deleting this account.');
  const related = await Promise.all([
    db.collection('job_postings').where('clinicOwnerId', '==', uid).limit(1).get(),
    db.collection('applications').where('clinicOwnerId', '==', uid).limit(1).get(),
    db.collection('applications').where('locumId', '==', uid).limit(1).get(),
  ]);
  if (related.some(snapshot => !snapshot.empty)) fail('failed-precondition', 'This account has related job postings or applications. Deletion is blocked until a cleanup policy is approved.');
  const profiles = [db.collection('locum_profiles').doc(uid), db.collection('practice_owner_profiles').doc(uid)];
  const children = await Promise.all(profiles.map(ref => ref.listCollections()));
  if (children.some(list => list.length)) fail('failed-precondition', 'This account has nested profile data. Manual review is required.');
  // All mutations through this callable are serialized by its deployment options.
  const latest = await auth.getUser(uid);
  if (!latest.disabled || latest.customClaims?.admin === true || latest.tokensValidAfterTime !== target.tokensValidAfterTime || latest.customClaims?.accountDisabledAt !== target.customClaims?.accountDisabledAt) fail('aborted', 'Account status changed. Please review and try again.');
  await auth.deleteUser(uid);
  try {
    const batch = db.batch();
    profiles.forEach(ref => batch.delete(ref));
    await batch.commit();
  } catch (_) {
    fail('internal', 'Authentication account deleted, but profile cleanup failed. Contact your administrator; do not assume cleanup completed.');
  }
  return { deleted: true };
}
module.exports = { manageAccount, ManagementError, DELETE_WAIT_MS };
