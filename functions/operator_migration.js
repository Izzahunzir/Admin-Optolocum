'use strict';
// Offline planning and isolated execution only. No production apply entrypoint.
const { validAccess } = require('./access_schema');
const { assertEmulatorEnvironment } = require('./emulator/safety');
const { createHash } = require('node:crypto');
const PROJECT = 'optolocum-f314e';
const uidValid = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\/\s\x00-\x1f]/.test(v) && !['.', '..'].includes(v);
const fail = message => { throw new Error(message); };
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const PAGE_SIZE = 200;
const MAX_ROWS = 10000;
const COLLECTIONS = ['locum_profiles', 'practice_owner_profiles', 'account_management', 'account_access'];
const statusValue = v => ['unverified', 'pending', 'verified', 'approved', 'rejected'].includes(v) ? v : v == null ? 'missing' : 'other';
function safeAccess(v) {
  const result = {};
  for (const k of Object.keys(v)) {
    if (!['state', 'validAfter', 'operation'].includes(k)) { result.unrecognizedFields = true; continue; }
    if (k === 'state') result.state = ['active', 'disabled', 'deleting', 'deleted'].includes(v.state) ? v.state : 'invalid';
    if (k === 'validAfter') result.validAfter = Number.isSafeInteger(v.validAfter) && v.validAfter >= 0 ? v.validAfter : null;
    if (k === 'operation') result.operation = v.operation == null ? null : 'incomplete';
  }
  return result;
}
// The adapter exposes only paginated reads. Abort instead of presenting a
// truncated snapshot as complete; never print identity-level data to stdout.
async function collectPaged({ listUsers, readPage, projectId, now = () => new Date().toISOString(), pageSize = PAGE_SIZE, maxRows = MAX_ROWS }) {
  if (projectId !== PROJECT || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS) fail('Invalid inventory settings.');
  const users = [], ids = new Set(), tokens = new Set(); let cursor;
  do {
    const page = await listUsers(pageSize, cursor);
    if (!Array.isArray(page.users) || page.users.length > pageSize) fail('Invalid Auth page.');
    for (const u of page.users) {
      if (!uidValid(u.uid) || ids.has(u.uid) || users.length >= maxRows) fail('Invalid, duplicate or excessive Auth records.');
      ids.add(u.uid);
      const rawAdmin = u.customClaims?.admin;
      users.push({ uid: u.uid, disabled: typeof u.disabled === 'boolean' ? u.disabled : null,
        admin: rawAdmin === undefined ? false : typeof rawAdmin === 'boolean' ? rawAdmin : null,
        historicalDisable: Object.hasOwn(u.customClaims || {}, 'accountDisabledAt'),
        tokensValidAfterTime: typeof u.tokensValidAfterTime === 'string' && Number.isFinite(Date.parse(u.tokensValidAfterTime)) ? new Date(u.tokensValidAfterTime).toISOString() : null });
    }
    cursor = page.pageToken;
    if (cursor && (typeof cursor !== 'string' || tokens.has(cursor))) fail('Invalid Auth cursor.');
    if (cursor) tokens.add(cursor);
  } while (cursor);
  const records = {};
  for (const name of COLLECTIONS) {
    const rows = [], seen = new Set(); let last;
    while (true) {
      const page = await readPage(name, pageSize, last);
      if (!Array.isArray(page) || page.length > pageSize) fail('Invalid Firestore page.');
      for (const d of page) {
        if (!uidValid(d.id) || seen.has(d.id) || rows.length >= maxRows) fail('Invalid, duplicate or excessive Firestore records.');
        seen.add(d.id); const v = d.data();
        if (name.endsWith('_profiles')) rows.push({ uid: d.id, verificationStatus: statusValue(v.verificationStatus) });
        else if (name === 'account_management') rows.push({ uid: d.id, trustedAccountType: ['locum', 'practice_owner'].includes(v.trustedAccountType) ? v.trustedAccountType : null });
        else rows.push({ uid: d.id, value: safeAccess(v) });
      }
      if (page.length < pageSize) break;
      last = page.at(-1).id;
    }
    records[name] = rows;
  }
  return { projectId, capturedAt: now(), users, ...records };
}

// Data is a non-atomic snapshot; it is not evidence of eligibility.
async function collect({ auth, db, projectId }) {
  if (projectId !== PROJECT) fail('Wrong project.');
  const users = []; let pageToken; const tokens = new Set();
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) users.push({ uid: u.uid, disabled: u.disabled, admin: u.customClaims?.admin ?? false,
      historicalDisable: Object.hasOwn(u.customClaims || {}, 'accountDisabledAt'), tokensValidAfterTime: u.tokensValidAfterTime });
    pageToken = page.pageToken;
    if (pageToken && tokens.has(pageToken)) fail('Repeated cursor.');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  const names = ['locum_profiles', 'practice_owner_profiles', 'account_management', 'account_access'];
  const results = await Promise.all(names.map(n => db.collection(n).get()));
  const records = {};
  names.forEach((name, i) => { records[name] = results[i].docs.map(d => {
    const v = d.data();
    if (name.endsWith('_profiles')) return { uid: d.id, verificationStatus: typeof v.verificationStatus === 'string' ? v.verificationStatus : null };
    if (name === 'account_management') return { uid: d.id, trustedAccountType: v.trustedAccountType ?? null };
    const value = Object.fromEntries(Object.keys(v).map(k => [k, ['state', 'validAfter', 'operation'].includes(k) ? v[k] : '[redacted]']));
    return { uid: d.id, value };
  }); });
  return { projectId, capturedAt: new Date().toISOString(), users, ...records };
}
function plan(snapshot, reviews = []) {
  if (!snapshot || snapshot.projectId !== PROJECT || !Number.isFinite(Date.parse(snapshot.capturedAt)) || !Array.isArray(reviews)) fail('Invalid snapshot.');
  const names = ['users', 'locum_profiles', 'practice_owner_profiles', 'account_management', 'account_access'];
  const maps = {};
  for (const name of names) {
    if (!Array.isArray(snapshot[name])) fail('Incomplete inventory.');
    maps[name] = new Map();
    for (const row of snapshot[name]) {
      if (!uidValid(row.uid) || maps[name].has(row.uid)) fail('Invalid or duplicate UID.');
      maps[name].set(row.uid, row);
    }
  }
  const approvals = new Map();
  for (const r of reviews) {
    if (!r || !uidValid(r.uid) || approvals.has(r.uid) || !['locum', 'practice_owner', 'administrator'].includes(r.kind) ||
        typeof r.reviewer !== 'string' || !r.reviewer.trim() || r.reviewer.length > 128 ||
        typeof r.evidenceReference !== 'string' || !r.evidenceReference.trim() || r.evidenceReference.length > 200) fail('Invalid explicit review.');
    approvals.set(r.uid, r);
  }
  const ids = [...new Set([...Object.values(maps).flatMap(m => [...m.keys()]), ...approvals.keys()])].sort();
  const rows = ids.map(uid => {
    const u = maps.users.get(uid), l = maps.locum_profiles.has(uid), o = maps.practice_owner_profiles.has(uid);
    const assignment = maps.account_management.get(uid), access = maps.account_access.get(uid), review = approvals.get(uid);
    const issues = [];
    if (!u) issues.push('auth-missing');
    if (u && (u.disabled !== false || ![true, false].includes(u.admin) || u.historicalDisable !== false || !Number.isFinite(Date.parse(u.tokensValidAfterTime)))) issues.push('auth-review-required');
    if (l && o) issues.push('conflicting-profiles');
    if (!l && !o && !u?.admin) issues.push('missing-profile');
    if (!assignment && !u?.admin) issues.push('missing-assignment');
    if (!access) issues.push('missing-access');
    if (access && !validAccess(access.value)) issues.push('incompatible-access-preserve');
    if (access && (access.value?.state !== 'active' || access.value?.operation != null)) issues.push('restrictive-access-preserve');
    if (access && u && Number.isFinite(Date.parse(u.tokensValidAfterTime)) && Number.isSafeInteger(access.value?.validAfter) && access.value.validAfter < Math.ceil(Date.parse(u.tokensValidAfterTime) / 1000)) issues.push('stale-access-cutoff');
    if (assignment && !['locum', 'practice_owner'].includes(assignment.trustedAccountType)) issues.push('assignment-conflict');
    if (assignment && ((assignment.trustedAccountType === 'locum' && (!l || o)) || (assignment.trustedAccountType === 'practice_owner' && (!o || l)))) issues.push('assignment-profile-conflict');
    if (!review) issues.push('explicit-review-required');
    if (review && ((review.kind === 'administrator') !== (u?.admin === true) ||
       (review.kind === 'locum' && (!l || o)) || (review.kind === 'practice_owner' && (!o || l)) ||
       (assignment && review.kind !== assignment.trustedAccountType))) issues.push('review-conflict');
    const blocking = issues.filter(x => !['missing-access', 'missing-assignment'].includes(x));
    return { uid, issues, reviewedKind: review?.kind ?? null, action: blocking.length ? 'manual-review' : (!access || (!assignment && !u.admin)) ? 'create-missing-only' : 'preserve-existing' };
  });
  return { mode: 'dry-run', projectId: PROJECT, inventorySha256: hash(snapshot), reviewSha256: hash(reviews),
    summary: { total: rows.length, createMissing: rows.filter(r => r.action === 'create-missing-only').length, manualReview: rows.filter(r => r.action === 'manual-review').length, preserve: rows.filter(r => r.action === 'preserve-existing').length }, rows };
}

// Intentionally isolated: even an operator-supplied adapter cannot bypass the
// emulator environment gate. Never wire this into the real server or a CLI apply.
async function applyIsolated({ auth, db, snapshot, reviews, uid, now = Date.now() }) {
  assertEmulatorEnvironment();
  const row = plan(snapshot, reviews).rows.find(r => r.uid === uid);
  if (!row || row.action !== 'create-missing-only') fail('Reviewed create-only plan required.');
  const review = reviews.find(r => r.uid === uid), previous = snapshot.users.find(u => u.uid === uid);
  const user = await auth.getUser(uid);
  if (user.disabled !== false || (user.customClaims?.admin === true) !== (review.kind === 'administrator') ||
      Object.hasOwn(user.customClaims || {}, 'accountDisabledAt') || user.tokensValidAfterTime !== previous.tokensValidAfterTime) fail('Auth state changed.');
  const cutoff = Math.ceil(Date.parse(user.tokensValidAfterTime) / 1000);
  if (!Number.isSafeInteger(cutoff) || cutoff < 0 || !Number.isSafeInteger(now) || now < 0) fail('Invalid cutoff.');
  return db.runTransaction(async tx => {
    assertEmulatorEnvironment();
    const refs = ['account_management', 'account_access', 'locum_profiles', 'practice_owner_profiles'].map(n => db.collection(n).doc(uid));
    const [assignment, access, locum, owner] = await Promise.all(refs.map(ref => tx.get(ref)));
    if ((review.kind === 'locum' && (!locum.exists || owner.exists)) || (review.kind === 'practice_owner' && (!owner.exists || locum.exists))) fail('Profiles changed.');
    if (assignment.exists && assignment.data().trustedAccountType !== review.kind) fail('Assignment conflict.');
    if (access.exists && (!validAccess(access.data()) || access.data().state !== 'active' || access.data().operation != null)) fail('Existing access requires recovery review.');
    const latest = await auth.getUser(uid);
    if (latest.disabled !== false || (latest.customClaims?.admin === true) !== (review.kind === 'administrator') || Object.hasOwn(latest.customClaims || {}, 'accountDisabledAt') || latest.tokensValidAfterTime !== user.tokensValidAfterTime) fail('Auth state changed.');
    if (!assignment.exists && review.kind !== 'administrator') tx.create(refs[0], { trustedAccountType: review.kind, accountTypeAssignedBy: review.reviewer, accountTypeEvidenceReference: review.evidenceReference });
    if (!access.exists) tx.create(refs[1], { state: 'active', validAfter: Math.max(cutoff, Math.floor(now / 1000)), operation: null });
    return { result: 'created-or-preserved', requiresNewLogin: true };
  });
}

// Prototype journaled operation: never available against production. A started
// operation without completion is an uncertain outcome, not an automatic retry.
async function journaledIsolated({ auth, db, snapshot, reviews, uid, token, journalPath, expectedPlanHash, now = Date.now() }) {
  assertEmulatorEnvironment();
  const fs = require('node:fs/promises');
  const { activeAccess } = require('./access_schema');
  const report = plan(snapshot, reviews);
  if (expectedPlanHash !== hash([report.inventorySha256, report.reviewSha256, uid]) || !Number.isFinite(Date.parse(snapshot.capturedAt)) || now < Date.parse(snapshot.capturedAt) || now - Date.parse(snapshot.capturedAt) > 15 * 60 * 1000) fail('Plan is stale or changed.');
  const actor = await auth.verifyIdToken(token, true);
  if (!actor || actor.admin !== true || !uidValid(actor.uid) || actor.uid === uid || !Number.isSafeInteger(actor.auth_time) || actor.auth_time > Math.floor(now / 1000) || Math.floor(now / 1000) - actor.auth_time > 300) fail('Operator authorization required.');
  const current = await auth.getUser(actor.uid), access = await db.collection('account_access').doc(actor.uid).get();
  if (current.disabled !== false || current.customClaims?.admin !== true || !access.exists || !activeAccess(access.data()) || actor.auth_time <= access.data().validAfter) fail('Operator authorization required.');
  const handle = await fs.open(journalPath, 'wx', 0o600);
  const append = async entry => { await handle.writeFile(JSON.stringify(entry) + '\n'); await handle.sync(); };
  try {
    await append({ phase: 'intent', planHash: expectedPlanHash, uid, operatorUid: actor.uid });
    const result = await applyIsolated({ auth, db, snapshot, reviews, uid, now });
    await append({ phase: 'complete', planHash: expectedPlanHash });
    return result;
  } finally { await handle.close(); }
}

// Controlled create-only migration. The journal adapter must persist intent
// before returning and provide an exclusive operation lock. No profile writes.
async function controlledMigration({ auth, db, snapshot, reviews, uid, token, approvedHash, journal, now = Date.now() }) {
  const { activeAccess } = require('./access_schema');
  const report = plan(snapshot, reviews), expected = hash([report.inventorySha256, report.reviewSha256, uid]);
  if (approvedHash !== expected) fail('Reviewed plan hash mismatch.');
  const row = report.rows.find(r => r.uid === uid), review = reviews.find(r => r.uid === uid);
  if (!row || row.action !== 'create-missing-only') fail('Reviewed create-only plan required.');
  const actor = await auth.verifyIdToken(token, true), seconds = Math.floor(now / 1000);
  if (!actor || actor.admin !== true || !uidValid(actor.uid) || !Number.isSafeInteger(actor.auth_time) || actor.auth_time > seconds || seconds - actor.auth_time > 300) fail('Recent administrator sign-in required.');
  const operator = await auth.getUser(actor.uid);
  if (operator.disabled !== false || operator.customClaims?.admin !== true) fail('Operator authorization required.');
  const prior = await journal.read();
  if (!prior && (now < Date.parse(snapshot.capturedAt) || now - Date.parse(snapshot.capturedAt) > 15 * 60 * 1000)) fail('Inventory expired.');
  const originalUser = snapshot.users.find(u => u.uid === uid);
  const originalAssignment = snapshot.account_management.find(x => x.uid === uid);
  const originalAccess = snapshot.account_access.find(x => x.uid === uid);
  const adminSelfBootstrap = review.kind === 'administrator' && actor.uid === uid && !originalAccess;
  const operatorRef = db.collection('account_access').doc(actor.uid);
  const operatorAccess = await operatorRef.get();
  const operation = `migration-${expected.slice(0, 32)}`;
  if (adminSelfBootstrap) {
    const value = operatorAccess.data();
    if (operatorAccess.exists && (!prior || !((value?.state === 'disabled' && value.operation === operation && value.validAfter === prior.cutoff) || (value?.state === 'active' && value.operation == null && value.validAfter === prior.cutoff)))) fail('Administrator access requires separate recovery.');
  } else if (!operatorAccess.exists || !activeAccess(operatorAccess.data()) || actor.auth_time <= operatorAccess.data().validAfter) fail('Operator access unavailable.');
  const validateOperator = async () => {
    const current = await auth.getUser(actor.uid);
    if (current.disabled !== false || current.customClaims?.admin !== true) fail('Operator authorization changed.');
    if (!adminSelfBootstrap) {
      const access = await operatorRef.get();
      if (!access.exists || !activeAccess(access.data()) || actor.auth_time <= access.data().validAfter) fail('Operator access unavailable.');
    }
  };
  const validateUser = async () => {
    const user = await auth.getUser(uid);
    const currentAdmin = user.customClaims?.admin === undefined ? false : user.customClaims.admin;
    if (user.disabled !== false || currentAdmin !== originalUser.admin || currentAdmin !== (review.kind === 'administrator') ||
        Object.hasOwn(user.customClaims || {}, 'accountDisabledAt') || Date.parse(user.tokensValidAfterTime) !== Date.parse(originalUser.tokensValidAfterTime)) fail('Target Auth state changed.');
  };
  await validateUser();
  const cutoff = Math.max(seconds, Math.ceil(Date.parse(originalUser.tokensValidAfterTime) / 1000));
  const intent = prior || { version: 1, planHash: expected, uid, operatorUid: actor.uid, operation, cutoff, completed: false };
  if (intent.planHash !== expected || intent.uid !== uid || intent.operatorUid !== actor.uid || intent.operation !== operation || !Number.isSafeInteger(intent.cutoff)) fail('Journal mismatch.');
  if (!prior) await journal.create(intent);
  const refs = ['account_management', 'account_access', 'locum_profiles', 'practice_owner_profiles'].map(n => db.collection(n).doc(uid));
  const expectedAssignment = { trustedAccountType: review.kind, accountTypeAssignedBy: `migration:${expected}`, accountTypeEvidenceReference: review.evidenceReference };
  const equal = (a, b) => a && b && JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map(k => [k, b[k]]));
  const restricted = { state: 'disabled', validAfter: intent.cutoff, operation };
  const enabled = { state: 'active', validAfter: intent.cutoff, operation: null };
  // Missing documents may be created; existing documents must match the
  // inventory or exactly match this operation's durable intent.
  await db.runTransaction(async tx => {
    const [assignment, access, locum, owner] = await Promise.all(refs.map(ref => tx.get(ref)));
    if ((review.kind === 'locum' && (!locum.exists || owner.exists)) || (review.kind === 'practice_owner' && (!owner.exists || locum.exists))) fail('Profiles changed.');
    if (review.kind !== 'administrator') {
      const collection = review.kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles';
      const original = snapshot[collection].find(x => x.uid === uid);
      const currentProfile = review.kind === 'locum' ? locum : owner;
      if (!original || statusValue(currentProfile.data()?.verificationStatus) !== original.verificationStatus) fail('Profile status changed.');
    }
    if (originalAssignment) {
      if (!assignment.exists || assignment.data()?.trustedAccountType !== originalAssignment.trustedAccountType) fail('Assignment changed.');
    } else if (assignment.exists && (review.kind === 'administrator' || !equal(assignment.data(), expectedAssignment))) fail('Assignment changed.');
    if (originalAccess) {
      if (!access.exists || !equal(safeAccess(access.data()), originalAccess.value)) fail('Access changed.');
    } else if (access.exists && !equal(access.data(), restricted) && !equal(access.data(), enabled)) fail('Access changed.');
    await validateOperator(); await validateUser();
    if (!originalAssignment && !assignment.exists && review.kind !== 'administrator') tx.create(refs[0], expectedAssignment);
    if (!originalAccess && !access.exists) tx.create(refs[1], restricted);
  });
  // Cross-service state cannot be atomically committed; keep the newly created
  // access restrictive until Auth is rechecked. Operators must freeze Auth changes.
  await validateOperator(); await validateUser();
  if (!originalAccess) await db.runTransaction(async tx => {
    const [assignment, access, locum, owner] = await Promise.all(refs.map(ref => tx.get(ref)));
    if (review.kind !== 'administrator') {
      const expectedType = originalAssignment?.trustedAccountType || review.kind;
      if (!assignment.exists || assignment.data()?.trustedAccountType !== expectedType) fail('Assignment changed during recovery.');
      if (!originalAssignment && !equal(assignment.data(), expectedAssignment)) fail('Assignment changed during recovery.');
      const original = snapshot[review.kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles'].find(x => x.uid === uid);
      const own = review.kind === 'locum' ? locum : owner, other = review.kind === 'locum' ? owner : locum;
      if (!own.exists || other.exists || statusValue(own.data()?.verificationStatus) !== original?.verificationStatus) fail('Profile changed during recovery.');
    }
    if (!access.exists || (!equal(access.data(), restricted) && !equal(access.data(), enabled))) fail('Access changed during recovery.');
    await validateOperator(); await validateUser();
    if (equal(access.data(), restricted)) tx.update(refs[1], { state: 'active', operation: null });
  });
  await journal.complete(expected);
  return { result: 'complete', requiresNewLogin: !originalAccess };
}
async function runInventory(args, { env = process.env, createServices = inventoryServices, log = console.log } = {}) {
  const path = require('node:path'), fs = require('node:fs/promises');
  if (args.length !== 6 || args[0] !== '--project' || args[1] !== PROJECT || args[2] !== '--private-root' || args[4] !== '--output' || !/^inventory-[a-zA-Z0-9-]{1,60}\.json$/.test(args[5])) fail('Invalid inventory arguments.');
  const { assertLocalServerEnvironment } = require('./demo_config');
  assertLocalServerEnvironment(env);
  if (env.FIREBASE_CONFIG) {
    let config; try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { fail('Invalid Firebase configuration.'); }
    if (!config || Array.isArray(config) || config.projectId !== PROJECT || Object.keys(config).some(k => k !== 'projectId')) fail('Conflicting Firebase configuration.');
  }
  const { validateRoot } = require('./local_document_store');
  const root = await validateRoot(args[3], [path.resolve(__dirname, '..', '..')]);
  for (let current = root; ; current = path.dirname(current)) {
    try { await fs.lstat(path.join(current, '.git')); fail('Inventory destination is in a Git repository.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  const output = path.join(root, args[5]);
  // Reserve before network access; a failed run leaves no partial report.
  const file = await fs.open(output, 'wx', 0o600);
  let complete = false, services;
  try {
    services = await createServices();
    const snapshot = await collectPaged({ ...services, projectId: PROJECT });
    const report = plan(snapshot);
    await file.writeFile(JSON.stringify({ snapshot, reviews: [] }, null, 2) + '\n');
    await file.sync(); complete = true;
    const statuses = {};
    for (const row of [...snapshot.locum_profiles, ...snapshot.practice_owner_profiles]) statuses[row.verificationStatus] = (statuses[row.verificationStatus] || 0) + 1;
    log(JSON.stringify({ status: 'complete', projectId: PROJECT, authUsers: snapshot.users.length,
      administrators: snapshot.users.filter(u => u.admin === true && u.disabled === false).length,
      locumProfiles: snapshot.locum_profiles.length, ownerProfiles: snapshot.practice_owner_profiles.length,
      assignments: snapshot.account_management.length, accessRecords: snapshot.account_access.length,
      missingAssignments: report.rows.filter(r => r.issues.includes('missing-assignment')).length,
      missingAccess: report.rows.filter(r => r.issues.includes('missing-access')).length,
      conflictingProfiles: report.rows.filter(r => r.issues.includes('conflicting-profiles')).length, verificationStatuses: statuses }));
  } finally {
    try { if (services) await services.close(); }
    finally { await file.close(); if (!complete) await fs.unlink(output).catch(() => {}); }
  }
}
async function inventoryServices() {
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldPath } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `operator-inventory-${require('node:crypto').randomUUID()}`);
  const auth = getAuth(app), db = getFirestore(app);
  return {
    listUsers: (size, cursor) => auth.listUsers(size, cursor),
    readPage: async (name, size, cursor) => {
      if (!COLLECTIONS.includes(name)) fail('Unapproved collection.');
      let q = db.collection(name);
      if (name.endsWith('_profiles')) q = q.select('verificationStatus');
      if (name === 'account_management') q = q.select('trustedAccountType');
      q = q.orderBy(FieldPath.documentId()).limit(size);
      if (cursor) q = q.startAfter(cursor);
      return (await q.get()).docs;
    },
    close: async () => { await db.terminate(); await deleteApp(app); },
  };
}
async function runControlled(args, env = process.env) {
  const fs = require('node:fs/promises'), path = require('node:path');
  if (args.length !== 11 || args[0] !== '--project' || args[1] !== PROJECT || args[2] !== '--private-root' ||
      args[4] !== '--input' || !/^(?:inventory|review)-[a-zA-Z0-9-]{1,60}\.json$/.test(args[5]) ||
      args[6] !== '--uid' || !uidValid(args[7]) || args[8] !== '--approve-plan' || !/^[a-f0-9]{64}$/.test(args[9]) || args[10] !== '--auth-writes-frozen' ||
      env.OPT_REAL_MIGRATION !== 'I_UNDERSTAND_REAL_FIREBASE_WRITES' || !env.OPT_OPERATOR_ID_TOKEN) fail('Explicit execution configuration required.');
  const { validateRealEnvironment } = require('./real_config');
  validateRealEnvironment({ ...env, OPT_REAL_FIREBASE_MODE: 'prepare-read-only', OPT_REAL_PROJECT: PROJECT, OPT_DOCUMENT_STORE_ROOT: args[3] });
  const root = await require('./local_document_store').validateRoot(args[3], [path.resolve(__dirname, '..', '..')]);
  for (let current = root; ; current = path.dirname(current)) {
    try { await fs.lstat(path.join(current, '.git')); fail('Private root is inside a repository.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (path.dirname(current) === current) break;
  }
  const inputPath = path.join(root, args[5]);
  const stat = await fs.lstat(inputPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 10 * 1024 * 1024) fail('Invalid plan file.');
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const journalPath = path.join(root, `migration-${args[9]}.json`), lockPath = `${journalPath}.lock`;
  const lock = await fs.open(lockPath, 'wx', 0o600);
  let services;
  try {
    const journal = {
      async read() {
        try {
          const info = await fs.lstat(journalPath);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) fail('Invalid journal.');
          return JSON.parse(await fs.readFile(journalPath, 'utf8'));
        } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      },
      async create(value) { const f = await fs.open(journalPath, 'wx', 0o600); try { await f.writeFile(JSON.stringify(value)); await f.sync(); } finally { await f.close(); } },
      // A completed marker is unnecessary for reconciliation: intent and actual
      // records are enough, and never rewriting the journal avoids torn updates.
      async complete() {},
    };
    const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { getFirestore } = require('firebase-admin/firestore');
    const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `controlled-migration-${require('node:crypto').randomUUID()}`);
    const db = getFirestore(app); services = { auth: getAuth(app), db, close: async () => { await db.terminate(); await deleteApp(app); } };
    await controlledMigration({ ...services, snapshot: input.snapshot, reviews: input.reviews, uid: args[7], approvedHash: args[9], token: env.OPT_OPERATOR_ID_TOKEN, journal });
    console.log(JSON.stringify({ status: 'complete', requiresNewLogin: true }));
  } finally {
    try { if (services) await services.close(); }
    finally { await lock.close(); await fs.unlink(lockPath).catch(() => {}); }
  }
}
async function main() {
  try {
    if (process.argv[2] === '--inventory') return await runInventory(process.argv.slice(3));
    if (process.argv[2] === '--apply') return await runControlled(process.argv.slice(3));
    if (![4, 6].includes(process.argv.length) || process.argv[2] !== '--dry-run' || (process.argv.length === 6 && process.argv[4] !== '--uid')) fail('Invalid dry-run arguments.');
    const input = JSON.parse(require('node:fs').readFileSync(process.argv[3], 'utf8'));
    const report = plan(input.snapshot, input.reviews);
    // Detailed rows include UIDs; keep them in the private input/report workflow.
    const row = process.argv.length === 6 ? report.rows.find(r => r.uid === process.argv[5]) : null;
    if (process.argv.length === 6 && !row) fail('UID not in plan.');
    process.stdout.write(JSON.stringify({ mode: report.mode, projectId: report.projectId, summary: report.summary, inventorySha256: report.inventorySha256, reviewSha256: report.reviewSha256,
      ...(row ? { reviewedAction: row.action, issues: row.issues, approvalHash: hash([report.inventorySha256, report.reviewSha256, row.uid]) } : {}) }) + '\n');
  } catch (_) { console.error('Operator command failed. Check arguments, credentials, private destination and read permissions.'); process.exitCode = 1; }
}
if (require.main === module) main();
module.exports = { collect, collectPaged, plan, applyIsolated, journaledIsolated, controlledMigration, runInventory, runControlled };
