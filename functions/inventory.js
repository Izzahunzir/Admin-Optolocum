"use strict";
// Production READS ONLY. Importing this module never loads the SDK or credentials.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PROJECT = 'optolocum-f314e';
const OUTPUT_ROOT = path.join(__dirname, '.private-inventory');
const PAGE_SIZE = 500;
const MARKERS = ['accountDisabledAt', 'disabledAt', 'accountDeletedAt', 'deletedAt', 'disabled', 'deleted', 'isDisabled', 'isDeleted'];
const FIELDS = Object.freeze({
  locum_profiles: ['verificationStatus', ...MARKERS],
  practice_owner_profiles: ['verificationStatus', ...MARKERS],
  account_access: ['state', 'validAfter', 'updatedAt', 'updatedBy', 'schemaVersion'],
  account_lifecycle: ['state', 'generation', 'operationId', 'operation', 'phase', 'updatedAt', 'disabledAt', 'deletedAt', 'everDisabled', 'everDeleted'],
});
function optionsFromArgs(args, env = process.env) {
  if (args.length !== 6) throw new Error('Expected --project, --confirm-project and --out.');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--project', '--confirm-project', '--out'].includes(args[i]) || options[args[i]] !== undefined || !args[i + 1]) throw new Error('Invalid inventory arguments.');
    options[args[i]] = args[i + 1];
  }
  if (options['--project'] !== PROJECT || options['--confirm-project'] !== PROJECT) throw new Error('Exact project confirmation is required.');
  for (const [key, value] of Object.entries(env)) {
    if (value && (key.includes('EMULATOR') || key.startsWith('CLOUDSDK_API_ENDPOINT_OVERRIDES_'))) throw new Error('Remove emulator or endpoint overrides.');
  }
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) {
    if (env[key] && env[key] !== PROJECT) throw new Error('Conflicting environment project.');
  }
  for (const key of ['DEBUG', 'NODE_DEBUG', 'GRPC_TRACE', 'GOOGLE_SDK_NODE_LOGGING']) {
    if (env[key]) throw new Error('Remove diagnostic logging environment variables.');
  }
  if (env.FIREBASE_CONFIG) {
    let config;
    try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error('Remove conflicting Firebase configuration.'); }
    if (!config || config.projectId !== PROJECT || Object.keys(config).some(k => k !== 'projectId')) throw new Error('Remove conflicting Firebase configuration.');
  }
  const output = path.resolve(options['--out']);
  if (path.dirname(output) !== OUTPUT_ROOT || !/^report-[a-zA-Z0-9-]+\.json$/.test(path.basename(output))) throw new Error('Report must be report-<label>.json in functions/.private-inventory.');
  return { projectId: PROJECT, output };
}
function prepareDestination(output) {
  // Local filesystem only, before credentials/SDK/network. Never overwrite a report.
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(OUTPUT_ROOT).isSymbolicLink() || fs.realpathSync(OUTPUT_ROOT) !== OUTPUT_ROOT || fs.existsSync(output)) throw new Error('Report destination is redirected or already exists.');
  // Fail early for an unwritable directory; remove this empty probe before reads.
  const probe = path.join(OUTPUT_ROOT, `.probe-${require('node:crypto').randomUUID()}`);
  fs.closeSync(fs.openSync(probe, 'wx', 0o600)); fs.unlinkSync(probe);
}
function epoch(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string') { const ms = Date.parse(value); return Number.isFinite(ms) && ms >= 0 ? Math.ceil(ms / 1000) : null; }
  if (value && typeof value.toMillis === 'function') { const ms = value.toMillis(); return Number.isFinite(ms) && ms >= 0 ? Math.ceil(ms / 1000) : null; }
  return null;
}
const enumValue = (value, allowed) => allowed.includes(value) ? value : value === undefined ? 'missing' : 'malformed';
function markers(data) {
  return Object.fromEntries(MARKERS.filter(k => Object.hasOwn(data, k)).map(k => [k,
    typeof data[k] === 'boolean' ? { present: true, boolean: data[k] } : { present: true, epochSeconds: epoch(data[k]), malformed: epoch(data[k]) === null }]));
}
async function collectReport({ listUsers, readPage, now = () => new Date().toISOString() }) {
  const startedAt = now(), users = new Map(), documents = {};
  let pageToken;
  const seenTokens = new Set();
  do {
    const page = await listUsers(PAGE_SIZE, pageToken);
    if (!Array.isArray(page.users)) throw new Error('Invalid Auth page.');
    for (const u of page.users) {
      if (typeof u.uid !== 'string' || users.has(u.uid)) throw new Error('Duplicate/invalid Auth identity; repeat inventory.');
      const claims = u.customClaims || {};
      users.set(u.uid, { uid: u.uid, disabled: typeof u.disabled === 'boolean' ? u.disabled : null,
        adminClaim: enumValue(claims.admin, [true, false]), accountDisabledAt: Object.hasOwn(claims, 'accountDisabledAt') ? { present: true, epochSeconds: epoch(claims.accountDisabledAt) } : { present: false },
        createdAtSeconds: epoch(u.metadata?.creationTime), tokensValidAfterSeconds: epoch(u.tokensValidAfterTime) });
    }
    pageToken = page.pageToken;
    if (pageToken && seenTokens.has(pageToken)) throw new Error('Repeated Auth cursor.');
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken);
  for (const [collection, fields] of Object.entries(FIELDS)) {
    const records = new Map(); let cursor;
    while (true) {
      const page = await readPage(collection, fields, PAGE_SIZE, cursor);
      if (!Array.isArray(page) || page.length > PAGE_SIZE) throw new Error('Invalid Firestore page.');
      for (const doc of page) {
        if (typeof doc.id !== 'string' || records.has(doc.id)) throw new Error('Duplicate/invalid document; repeat inventory.');
        const d = doc.data();
        let record;
        if (collection.endsWith('_profiles')) record = { verificationStatus: enumValue(d.verificationStatus, ['unverified', 'pending', 'verified']), markers: markers(d) };
        else if (collection === 'account_access') record = {
          state: enumValue(d.state, ['active', 'disabled', 'deleting', 'deleted']), validAfter: Number.isSafeInteger(d.validAfter) && d.validAfter >= 0 ? d.validAfter : null,
          schemaVersion: d.schemaVersion === 1 ? 1 : null, updatedAtSeconds: epoch(d.updatedAt), updatedAtIsTimestamp: typeof d.updatedAt?.toMillis === 'function', updatedByPresent: typeof d.updatedBy === 'string' && d.updatedBy.length > 0,
        };
        else record = { state: enumValue(d.state, ['active', 'disabled', 'deleting', 'deleted', 'enabling', 'enrolling', 'review_required']),
          generation: Number.isSafeInteger(d.generation) && d.generation >= 0 ? d.generation : null,
          operationIdPresent: typeof d.operationId === 'string' && d.operationId.length > 0,
          operation: enumValue(d.operation, ['disable', 'enable', 'delete', 'enroll']),
          phase: enumValue(d.phase, ['intent', 'auth-complete', 'complete', 'recovery-required']),
          updatedAtSeconds: epoch(d.updatedAt), markers: markers(d), everDisabled: typeof d.everDisabled === 'boolean' ? d.everDisabled : null,
          everDeleted: typeof d.everDeleted === 'boolean' ? d.everDeleted : null };
        records.set(doc.id, record);
      }
      if (page.length < PAGE_SIZE) break;
      cursor = page.at(-1).id;
    }
    documents[collection] = records;
  }
  const uids = [...new Set([...users.keys(), ...Object.values(documents).flatMap(m => [...m.keys()])])].sort();
  const rows = uids.map(uid => {
    const auth = users.get(uid) || null, locum = documents.locum_profiles.get(uid) || null,
      owner = documents.practice_owner_profiles.get(uid) || null, access = documents.account_access.get(uid) || null,
      lifecycle = documents.account_lifecycle.get(uid) || null;
    const flags = [];
    if (!auth) flags.push('auth-absent-not-proof-of-deletion');
    if (!locum && !owner) flags.push('missing-profile');
    if (locum && owner) flags.push('conflicting-profiles');
    if (!auth && (locum || owner)) flags.push('orphan-profile');
    if (!access) flags.push('missing-access-not-new-account-proof');
    if (!lifecycle) flags.push('missing-lifecycle-history');
    if (auth?.adminClaim === true) flags.push('administrator-protected');
    if (auth?.adminClaim === 'malformed' || auth?.disabled === null) flags.push('malformed-auth-state');
    if (auth?.disabled === true && access?.state === 'active') flags.push('disabled-auth-active-access-conflict');
    if (access && (['malformed', 'missing'].includes(access.state) || access.validAfter === null || access.schemaVersion === null || access.updatedAtSeconds === null || !access.updatedAtIsTimestamp || !access.updatedByPresent)) flags.push('malformed-projected-access');
    if (access && auth?.tokensValidAfterSeconds !== null && auth?.tokensValidAfterSeconds !== undefined && access.validAfter !== null && access.validAfter < auth.tokensValidAfterSeconds) flags.push('access-cutoff-before-auth-cutoff');
    if (access && access.state !== 'active') flags.push('restrictive-access-preserve');
    if (access?.state === 'active' && (!(locum || owner) || (locum && owner) || (locum || owner).verificationStatus !== 'verified')) flags.push('active-access-without-single-verified-profile');
    if (auth?.accountDisabledAt.present || lifecycle?.everDisabled === true || lifecycle?.everDeleted === true || [locum, owner, lifecycle].some(d => d && Object.keys(d.markers).length > 0) || ['disabled', 'deleting', 'deleted'].includes(access?.state)) flags.push('lifecycle-marker-observed-review');
    return { uid, auth, locum, practiceOwner: owner, access, lifecycle, flags, decision: 'manual-review-only' };
  });
  const count = flag => rows.filter(r => r.flags.includes(flag)).length;
  const summary = { authUsers: users.size, enabledUsers: rows.filter(r => r.auth?.disabled === false).length,
    disabledUsers: rows.filter(r => r.auth?.disabled === true).length, administrators: rows.filter(r => r.auth?.adminClaim === true).length,
    locumProfiles: documents.locum_profiles.size, practiceOwnerProfiles: documents.practice_owner_profiles.size,
    accessRecords: documents.account_access.size, lifecycleRecords: documents.account_lifecycle.size,
    conflictingProfiles: count('conflicting-profiles'), orphanProfiles: count('orphan-profile'),
    missingAccess: count('missing-access-not-new-account-proof'), observedMarkers: count('lifecycle-marker-observed-review'),
    authAccessConflicts: count('disabled-auth-active-access-conflict'), reviewRows: rows.length };
  return { schemaVersion: 1, mode: 'production-read-only-inventory', projectId: PROJECT, database: '(default)', startedAt, completedAt: now(),
    completeForDeclaredScope: true, atomicSnapshot: false, scope: { auth: 'default-project users only; tenants not enumerated',
      firestoreCollections: Object.keys(FIELDS), fieldMasks: FIELDS, nestedCollections: 'not scanned', unknownMarkerLocations: 'not scanned',
      extraAccessFields: 'not fetched; projected schema validation only' },
    limitations: ['Current state cannot establish complete deleted/disabled history.', 'No absence or profile proves enrollment eligibility.',
      'Reads across services/pages are not atomic; repeat and reconcile before any future migration.', 'Every row requires manual review; no activation recommendations.'],
    summary, observationsSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), rows };
}
async function run(args, { env = process.env, createServices = productionServices, log = console.log } = {}) {
  const options = optionsFromArgs(args, env);
  prepareDestination(options.output);
  const services = await createServices();
  try {
    const report = await collectReport(services);
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    // Only allowlisted aggregate counts reach the terminal. Never serialize SDK errors.
    log(JSON.stringify({ status: 'complete', projectId: PROJECT, summary: report.summary }));
    return report;
  } finally { await services.close(); }
}
async function productionServices() {
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldPath } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `read-only-inventory-${require('node:crypto').randomUUID()}`);
  const auth = getAuth(app), db = getFirestore(app);
  db.settings({ host: 'firestore.googleapis.com', ssl: true });
  // Deliberately expose only reads to the collector. No management imports.
  return {
    listUsers: (size, token) => auth.listUsers(size, token),
    readPage: async (collection, fields, size, cursor) => {
      if (!Object.hasOwn(FIELDS, collection) || fields !== FIELDS[collection]) throw new Error('Unapproved collection/mask.');
      let query = db.collection(collection).select(...fields).orderBy(FieldPath.documentId()).limit(size);
      if (cursor) query = query.startAfter(cursor);
      return (await query.get()).docs;
    },
    close: async () => { await db.terminate(); await deleteApp(app); },
  };
}
if (require.main === module) run(process.argv.slice(2)).catch(() => {
  console.error('Inventory failed. No complete report confirmed. Check arguments, existing credentials, read permissions, network and unused output destination. No remote writes were requested.');
  process.exitCode = 1;
});
module.exports = { PROJECT, OUTPUT_ROOT, FIELDS, optionsFromArgs, collectReport, run };
