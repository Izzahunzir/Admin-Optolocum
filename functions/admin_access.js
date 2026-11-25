'use strict';
// Operator-only, emulator-gated module. Never expose this through HTTP.
const { assertEmulatorEnvironment } = require('./emulator/safety');
const fail = message => { throw Object.assign(new Error(message), { code: 'failed-precondition' }); };
async function controlAdminAccess({ auth, db, uid, action }) {
  assertEmulatorEnvironment();
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/') || !['bootstrap', 'disable', 'remove-admin'].includes(action)) fail('Invalid administrator control request.');
  const access = db.collection('account_access').doc(uid);
  const user = await auth.getUser(uid);
  if (action === 'bootstrap' && (user.disabled || user.customClaims?.admin !== true)) fail('An active administrator claim is required.');
  if (action !== 'bootstrap' && user.customClaims?.admin !== true && action !== 'remove-admin') fail('Administrator claim is required.');
  const operation = `admin-${action}`;
  await db.runTransaction(async tx => {
    const snap = await tx.get(access);
    const existing = snap.exists ? snap.data() : null;
    if (existing && (!['active', 'disabled'].includes(existing.state) || !Number.isSafeInteger(existing.validAfter) || existing.validAfter < 0)) fail('Malformed access record requires operator review.');
    if (existing?.operation && existing.operation !== operation) fail('Another transition requires operator review.');
    tx.set(access, { state: 'disabled', validAfter: Math.max(existing?.validAfter || 0, Math.floor(Date.now() / 1000)), operation });
  });
  // All failures from this point leave the previously committed access block in
  // place unless the final transaction actually committed despite a lost reply.
  if (action === 'disable') await auth.updateUser(uid, { disabled: true });
  if (action === 'remove-admin') {
    const current = await auth.getUser(uid);
    const claims = { ...(current.customClaims || {}) };
    delete claims.admin;
    await auth.setCustomUserClaims(uid, claims);
  }
  await auth.revokeRefreshTokens(uid);
  const after = await auth.getUser(uid);
  if (action === 'bootstrap' && (after.disabled || after.customClaims?.admin !== true)) fail('Administrator privileges changed; access remains blocked.');
  if (action === 'disable' && (!after.disabled || after.customClaims?.admin !== true)) fail('Administrator status changed; access remains blocked.');
  if (action === 'remove-admin' && after.customClaims?.admin === true) fail('Administrator privileges remain; access remains blocked.');
  await db.runTransaction(async tx => {
    const snap = await tx.get(access);
    if (!snap.exists || snap.data().state !== 'disabled' || snap.data().operation !== operation) fail('Administrator transition changed; access remains blocked.');
    tx.set(access, { state: action === 'bootstrap' ? 'active' : 'disabled', validAfter: Math.max(snap.data().validAfter, Math.floor(Date.now() / 1000)), operation: null });
  });
  return { uid, state: action === 'bootstrap' ? 'active' : 'disabled' };
}
module.exports = { controlAdminAccess };
