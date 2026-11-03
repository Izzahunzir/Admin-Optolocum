"use strict";
// Pure offline planner. No SDK imports, credentials, writes, or apply mode.
const { createHash } = require('node:crypto');
const { validUid } = require('./emulator/provisioning');
function planMigration(input) {
  if (!input || input.schemaVersion !== 1 || input.projectId !== 'optolocum-f314e' ||
      !Number.isFinite(Date.parse(input.capturedAt)) ||
      !['users', 'locumProfiles', 'ownerProfiles', 'accessRecords'].every(k => Array.isArray(input[k]))) throw new Error('Invalid inventory envelope.');
  const maps = {};
  for (const key of ['users', 'locumProfiles', 'ownerProfiles', 'accessRecords']) {
    maps[key] = new Map();
    for (const row of input[key]) {
      if (!row || !validUid(row.uid) || maps[key].has(row.uid)) throw new Error(`Invalid or duplicate UID in ${key}.`);
      maps[key].set(row.uid, row);
    }
  }
  const uids = [...new Set(Object.values(maps).flatMap(m => [...m.keys()]))].sort();
  const rows = uids.map(uid => {
    const user = maps.users.get(uid), locum = maps.locumProfiles.get(uid), owner = maps.ownerProfiles.get(uid), access = maps.accessRecords.get(uid);
    const issues = [];
    if (!user) issues.push('orphan-documents');
    if (!locum && !owner) issues.push('missing-profile');
    if (locum && owner) issues.push('conflicting-profiles');
    if (!access) issues.push('missing-access');
    const admin = user?.customClaims?.admin === true;
    if (user?.customClaims != null && (typeof user.customClaims !== 'object' || Array.isArray(user.customClaims) ||
        (user.customClaims.admin !== undefined && typeof user.customClaims.admin !== 'boolean'))) issues.push('ambiguous-admin-claim');
    const revoked = typeof user?.tokensValidAfterTime === 'string' ? Date.parse(user.tokensValidAfterTime) : NaN;
    if (user && (typeof user.disabled !== 'boolean' || !Number.isFinite(revoked) || revoked < 0)) issues.push('invalid-auth-state');
    if (user?.customClaims?.accountDisabledAt !== undefined) issues.push('historical-disable-marker');
    const status = (locum || owner)?.verificationStatus;
    if (status !== 'verified') issues.push('verification-not-verified');
    if (admin) issues.push('administrator-bootstrap-review');
    if (access) {
      const fields = Object.keys(access).sort().join(',');
      if (fields !== 'schemaVersion,state,uid,updatedAt,updatedBy,validAfter' || access.schemaVersion !== 1 ||
          !['active', 'disabled', 'deleting', 'deleted'].includes(access.state) || !Number.isSafeInteger(access.validAfter) || access.validAfter < 0 ||
          typeof access.updatedBy !== 'string' || !access.updatedBy || !Number.isFinite(Date.parse(access.updatedAt))) issues.push('malformed-access');
      if (user?.disabled && access.state === 'active') issues.push('auth-access-conflict');
      if (Number.isFinite(revoked) && access.validAfter < Math.ceil(revoked / 1000)) issues.push('stale-cutoff');
      if (access.state !== 'active') issues.push('restrictive-access-preserve');
    }
    // Every row needs human review; existing records and tombstones are preserved.
    const eligible = user && !admin && user.disabled === false && issues.every(i => i === 'missing-access');
    return { uid, administrator: admin, authState: user ? (user.disabled === true ? 'disabled' : user.disabled === false ? 'enabled' : 'unknown') : 'missing',
      profileKind: locum && owner ? 'conflict' : locum ? 'locum' : owner ? 'practice_owner' : null,
      verificationStatus: typeof status === 'string' ? status : null, accessState: access?.state ?? 'missing', issues,
      recommendation: access ? 'preserve-existing-review-conflicts' : eligible ? 'review-active-candidate' : user?.disabled === true && !admin ? 'review-disabled-candidate' : 'manual-review',
      minimumValidAfter: Number.isFinite(revoked) && revoked >= 0 ? Math.ceil(revoked / 1000) : null };
  });
  return { schemaVersion: 1, mode: 'dry-run-only', projectId: input.projectId, capturedAt: input.capturedAt,
    inventorySha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'), requiresFreshInventoryBeforeApply: true,
    totals: { rows: rows.length, administrators: rows.filter(r => r.administrator).length, enabled: rows.filter(r => r.authState === 'enabled').length,
      disabled: rows.filter(r => r.authState === 'disabled').length, missingProfiles: rows.filter(r => r.issues.includes('missing-profile')).length,
      missingAccess: rows.filter(r => r.issues.includes('missing-access')).length }, rows };
}
// Read-only collector for an explicitly supplied service adapter. Not invoked by CLI.
// No credentials or real-project clients are constructed in this module.
async function collectInventory({ auth, db, projectId, now = new Date().toISOString() }) {
  if (projectId !== 'optolocum-f314e') throw new Error('Unexpected inventory project.');
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users.map(u => ({ uid: u.uid, disabled: u.disabled, customClaims: { admin: u.customClaims?.admin ?? false,
      ...(u.customClaims?.accountDisabledAt !== undefined ? { accountDisabledAt: u.customClaims.accountDisabledAt } : {}) }, tokensValidAfterTime: u.tokensValidAfterTime })));
    pageToken = page.pageToken;
  } while (pageToken);
  const read = async collection => (await db.collection(collection).get()).docs;
  const [locums, owners, access] = await Promise.all([read('locum_profiles'), read('practice_owner_profiles'), read('account_access')]);
  return { schemaVersion: 1, projectId, capturedAt: now, users,
    locumProfiles: locums.map(d => ({ uid: d.id, verificationStatus: d.data().verificationStatus ?? null })),
    ownerProfiles: owners.map(d => ({ uid: d.id, verificationStatus: d.data().verificationStatus ?? null })),
    accessRecords: access.map(d => { const value = d.data(); return { ...value, uid: d.id, updatedAt: value.updatedAt?.toDate?.().toISOString() ?? value.updatedAt ?? null }; }) };
}
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node migration.js inventory.json (report on stdout; no apply mode)');
    const input = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(planMigration(input), null, 2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { planMigration, collectInventory };
