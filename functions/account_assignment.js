'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const { assertCurrentAdmin, VerificationManagementError } = require('./verification_management');
const fail = (code, message) => { throw new VerificationManagementError(code, message); };

// The administrator must independently review evidence before invoking this.
// The evidence reference is an audit identifier, not evidence stored here.
async function assignAccountType({ auth, db, actor, uid, accountType, evidenceReference }) {
  await assertCurrentAdmin({ auth, actor, requireRecentAuth: true });
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/') ||
      !['locum', 'practice_owner'].includes(accountType) ||
      typeof evidenceReference !== 'string' || !evidenceReference.trim() || evidenceReference.length > 200) {
    fail('invalid-argument', 'Invalid assignment request.');
  }
  let target;
  try { target = await auth.getUser(uid); } catch (_) { fail('not-found', 'Account not found.'); }
  if (target.disabled || target.customClaims?.admin === true) fail('failed-precondition', 'Account is unavailable for assignment.');
  const ref = db.collection('account_management').doc(uid);
  const access = db.collection('account_access').doc(uid);
  return db.runTransaction(async tx => {
    const [snapshot, accessSnapshot] = await Promise.all([tx.get(ref), tx.get(access)]);
    const existing = snapshot.data()?.trustedAccountType;
    if (existing !== undefined) {
      if (existing !== accountType) fail('failed-precondition', 'Account type changes require a separate controlled process.');
      if (!accessSnapshot.exists) {
        await assertCurrentAdmin({ auth, actor, requireRecentAuth: true });
        const current = await auth.getUser(uid);
        if (current.disabled || current.customClaims?.admin === true) fail('failed-precondition', 'Account is unavailable for assignment.');
        tx.set(access, { state: 'active', validAfter: Math.floor(Date.now() / 1000) });
      }
      return { uid, accountType, alreadyAssigned: true };
    }
    if (accessSnapshot.exists) fail('failed-precondition', 'Existing account access requires controlled recovery.');
    await assertCurrentAdmin({ auth, actor, requireRecentAuth: true });
    const current = await auth.getUser(uid);
    if (current.disabled || current.customClaims?.admin === true) fail('failed-precondition', 'Account is unavailable for assignment.');
    tx.set(ref, { trustedAccountType: accountType, accountTypeAssignedBy: actor.uid,
      accountTypeAssignedAt: FieldValue.serverTimestamp(), accountTypeEvidenceReference: evidenceReference.trim() }, { merge: true });
    tx.set(access, { state: 'active', validAfter: Math.floor(Date.now() / 1000) });
    return { uid, accountType, alreadyAssigned: false };
  });
}

module.exports = { assignAccountType };
