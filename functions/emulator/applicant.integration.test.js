'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { assertEmulatorEnvironment, createEmulatorServices } = require('./safety');
const { createLocalApp, HOST, PORT, ORIGIN } = require('../local_app');
const { createLocalDocumentStore } = require('../local_document_store');
const { assignAccountType } = require('../account_assignment');
const { manageAccount } = require('../management');
const { controlAdminAccess } = require('../admin_access');
const { deleteApp } = require('firebase-admin/app');
assertEmulatorEnvironment();
const locum = { fullName: 'Synthetic Locum', email: 'synthetic@example.invalid', nric: '990101010101', phoneNumber: '0123456789', gender: 'Female', dateOfBirth: '1999-01-01', highestEducation: 'Degree', course: 'Optometry' };
const owner = { practiceType: 'Retail Optical Store', clinicName: 'Synthetic Clinic', registrationNumber: '123', address: 'Test Street', state: 'Johor', contactNumber: '0123456789', companyEmail: 'synthetic@example.invalid' };
const rid = () => randomBytes(16).toString('hex');
test('isolated applicant HTTP workflow and authorization', { timeout: 240000 }, async t => {
  const { app, auth, db } = createEmulatorServices();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opt-http-test-'));
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-(?:\d+-)+\d+/)[0];
    execFileSync('icacls.exe', [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`]);
  } else await fs.chmod(root, 0o700);
  const store = await createLocalDocumentStore({ root });
  const server = createLocalApp({ auth, db, documentStore: store, applicantEmulatorOnly: true }).listen(PORT, HOST);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.terminate(); await deleteApp(app); await fs.rm(root, { recursive: true, force: true }); });
  const password = 'Synthetic-Password-123!';
  async function user(admin = false) {
    const uid = `synthetic-${randomUUID()}`, email = `${uid}@example.invalid`;
    await auth.createUser({ uid, email, password });
    if (admin) await auth.setCustomUserClaims(uid, { admin: true });
    const response = await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    assert.equal(response.status, 200); return { uid, token: (await response.json()).idToken };
  }
  async function tokenFor(email) {
    const response = await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    assert.equal(response.status, 200); return (await response.json()).idToken;
  }
  async function tokenAfterCutoff(uid, email) {
    const access = (await db.collection('account_access').doc(uid).get()).data();
    const delay = Math.max(0, (access.validAfter + 2) * 1000 - Date.now());
    await new Promise(resolve => setTimeout(resolve, delay));
    const token = await tokenFor(email);
    const decoded = await auth.verifyIdToken(token, true);
    assert.ok(decoded.auth_time > access.validAfter, 'Synthetic sign-in must be newer than the access cutoff');
    return token;
  }
  async function call(route, token, body, contentType = 'application/json') {
    const response = await fetch(`http://${HOST}:${PORT}${route}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: contentType === 'application/json' ? JSON.stringify(body) : body });
    return { status: response.status, body: await response.json() };
  }
  const admin = await user(true), unassigned = await user();
  assert.equal((await call('/api/verification/queue', admin.token, {})).status, 403);
  await controlAdminAccess({ auth, db, uid: admin.uid, action: 'bootstrap' });
  admin.token = await tokenAfterCutoff(admin.uid, (await auth.getUser(admin.uid)).email);
  const actor = { uid: admin.uid, admin: true, auth_time: Math.floor(Date.now() / 1000) };
  await assignAccountType({ auth, db, actor, uid: unassigned.uid, accountType: 'locum', evidenceReference: 'synthetic-recovery' });
  const existing = await user();
  const enrollment = (accountType, email) => ({ requestId: rid(), recoverySecret: randomBytes(32).toString('hex'), email, password, accountType, profile: accountType === 'locum' ? { fullName: 'Synthetic Locum' } : { fullName: 'Synthetic Owner', phoneNumber: '0123456789', role: 'Manager' } });
  const prior = await auth.getUser(existing.uid);
  assert.equal((await call('/api/enrollment', null, enrollment('locum', prior.email))).status, 409);
  const locumEnrollment = enrollment('locum', `locum-${randomUUID()}@example.invalid`);
  const attempts = await Promise.all([call('/api/enrollment', null, locumEnrollment), call('/api/enrollment', null, locumEnrollment)]);
  assert.ok(attempts.every(x => x.status === 200), JSON.stringify(attempts));
  assert.equal(attempts[0].body.data.uid, attempts[1].body.data.uid);
  assert.equal((await call('/api/enrollment', null, { ...locumEnrollment, accountType: 'practice_owner', profile: { fullName: 'Synthetic Owner', phoneNumber: '0123456789', role: 'Manager' } })).status, 403);
  assert.equal((await call('/api/enrollment', null, { ...locumEnrollment, recoverySecret: randomBytes(32).toString('hex') })).status, 403);
  assert.equal((await call('/api/enrollment', null, { ...locumEnrollment, uid: admin.uid })).status, 400);
  assert.equal((await call('/api/enrollment', null, { ...locumEnrollment, admin: true })).status, 400);
  assert.equal((await call('/api/enrollment', admin.token, locumEnrollment)).status, 400);
  const conflict = enrollment('locum', `conflict-${randomUUID()}@example.invalid`);
  const otherType = { ...conflict, accountType: 'practice_owner', profile: { fullName: 'Synthetic Owner', phoneNumber: '0123456789', role: 'Manager' } };
  const conflictResults = await Promise.all([call('/api/enrollment', null, conflict), call('/api/enrollment', null, otherType)]);
  assert.deepEqual(conflictResults.map(r => r.status).sort(), [200, 403]);
  const l = { uid: attempts[0].body.data.uid, token: await tokenAfterCutoff(attempts[0].body.data.uid, locumEnrollment.email) };
  const ownerEnrollment = enrollment('practice_owner', `owner-${randomUUID()}@example.invalid`);
  const ownerResult = await call('/api/enrollment', null, ownerEnrollment); assert.equal(ownerResult.status, 200);
  const p = { uid: ownerResult.body.data.uid, token: await tokenAfterCutoff(ownerResult.body.data.uid, ownerEnrollment.email) };
  for (const u of [l, p]) {
    assert.equal((await auth.getUser(u.uid)).customClaims?.admin, undefined);
    const profileName = u === l ? 'locum_profiles' : 'practice_owner_profiles';
    assert.equal((await db.collection(profileName).doc(u.uid).get()).data().verificationStatus, 'unverified');
    const access = (await db.collection('account_access').doc(u.uid).get()).data();
    assert.equal(access.state, 'active'); assert.ok(Number.isInteger(access.validAfter));
  }
  const directWrite = await fetch(`http://127.0.0.1:18080/v1/projects/demo-optolocum-account-management/databases/(default)/documents/account_management/${l.uid}`, { method: 'PATCH', headers: { authorization: `Bearer ${l.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { trustedAccountType: { stringValue: 'practice_owner' } } }) });
  assert.equal(directWrite.status, 403);
  const retryPayload = enrollment('locum', `retry-${randomUUID()}@example.invalid`);
  const originalTransaction = db.runTransaction.bind(db); let calls = 0;
  db.runTransaction = (...args) => { calls++; if (calls === 2) return Promise.reject(new Error('synthetic profile write failure')); return originalTransaction(...args); };
  assert.equal((await call('/api/enrollment', null, retryPayload)).status, 503);
  db.runTransaction = originalTransaction;
  const recovered = await call('/api/enrollment', null, retryPayload); assert.equal(recovered.status, 200);
  await auth.updateUser(recovered.body.data.uid, { disabled: true });
  assert.equal((await call('/api/enrollment', null, retryPayload)).status, 403);
  const fields = { locum, practice_owner: owner };
  assert.equal((await call('/api/applicant/draft', null, {})).status, 401);
  assert.equal((await call('/api/applicant/draft', 'invalid', {})).status, 401);
  assert.equal((await call('/api/applicant/draft', existing.token, { requestId: rid(), accountType: 'locum', submittedFields: locum })).status, 403);
  assert.equal((await call('/api/applicant/draft', l.token, { requestId: rid(), accountType: 'practice_owner', submittedFields: owner })).status, 409);
  assert.equal((await call('/api/applicant/draft', l.token, { requestId: rid(), accountType: 'locum', submittedFields: locum, uid: p.uid })).status, 400);
  const results = [];
  for (const [u, accountType] of [[l, 'locum'], [p, 'practice_owner']]) {
    const requestId = rid(), payload = { requestId, accountType, submittedFields: fields[accountType] };
    const created = await call('/api/applicant/draft', u.token, payload); assert.equal(created.status, 200, `${accountType}: ${JSON.stringify(created.body)}`);
    assert.deepEqual((await call('/api/applicant/draft', u.token, payload)).body, created.body);
    const recoveredDrafts = await Promise.all([call('/api/applicant/draft', u.token, payload), call('/api/applicant/draft', u.token, payload)]);
    assert.ok(recoveredDrafts.every(result => result.status === 200 && result.body.data.submissionId === created.body.data.submissionId));
    if (accountType === 'locum') {
      await new Promise(resolve => {
        const request = http.request({ host: HOST, port: PORT, path: '/api/applicant/upload/' + requestId, method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${u.token}`, 'content-type': 'application/pdf', 'content-length': 1000 } });
        request.on('error', () => resolve());
        request.write('%PDF-incomplete');
        request.destroy();
      });
      assert.equal((await call('/api/applicant/finalize', u.token, { requestId })).status, 409);
    }
    assert.ok([403, 404].includes((await call('/api/applicant/upload/' + requestId, unassigned.token, Buffer.from('%PDF-test'), 'application/pdf')).status));
    assert.equal((await call('/api/applicant/finalize', u.token, { requestId })).status, 409);
    assert.equal((await call('/api/applicant/upload/' + requestId, u.token, Buffer.from('invalid'), 'application/pdf')).status, 409);
    assert.equal((await call('/api/applicant/upload/' + requestId, u.token, Buffer.alloc(50 * 1024 * 1024 + 1), 'application/pdf')).status, 413);
    const bytes = Buffer.from('%PDF-synthetic evidence');
    assert.equal((await call('/api/applicant/upload/' + requestId, u.token, bytes, 'application/pdf')).status, 200);
    assert.equal((await call('/api/applicant/upload/' + requestId, u.token, bytes, 'application/pdf')).status, 200);
    assert.equal((await call('/api/applicant/upload/' + requestId, u.token, Buffer.from('%PDF-different'), 'application/pdf')).status, 409);
    if (accountType === 'locum') {
      const [id] = (await store.reconcile([])).orphaned;
      const file = path.join(root, id);
      await fs.writeFile(file, Buffer.from('%PDF-corrupted evidence'));
      assert.equal((await call('/api/applicant/finalize', u.token, { requestId })).status, 409);
      await fs.unlink(file);
      assert.equal((await call('/api/applicant/finalize', u.token, { requestId })).status, 409);
      assert.equal((await call('/api/applicant/upload/' + requestId, u.token, bytes, 'application/pdf')).status, 200);
    }
    const finalized = await call('/api/applicant/finalize', u.token, { requestId }); assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
    assert.equal((await call('/api/applicant/finalize', u.token, { requestId })).status, 200);
    assert.equal((await call('/api/applicant/draft', u.token, payload)).body.data.state, 'submitted');
    results.push({ ...u, requestId, submissionId: created.body.data.submissionId });
  }
  const queue = await call('/api/verification/queue', admin.token, {}); assert.equal(queue.status, 200); assert.ok(results.every(x => queue.body.data.items.some(item => item.uid === x.uid)));
  assert.equal((await call('/api/verification/review', admin.token, { uid: l.uid, submissionId: results[0].submissionId, decision: 'approved' })).status, 200);
  assert.equal((await call('/api/verification/review', admin.token, { uid: p.uid, submissionId: results[1].submissionId, decision: 'rejected', rejectionReason: 'Synthetic reason' })).status, 200);
  const newId = rid(); const updatedOwner = { ...owner, clinicName: 'New Synthetic Clinic' };
  assert.equal((await call('/api/applicant/draft', p.token, { requestId: newId, accountType: 'practice_owner', submittedFields: updatedOwner })).status, 200);
  assert.equal((await call('/api/applicant/upload/' + newId, p.token, Buffer.from('%PDF-new'), 'application/pdf')).status, 200);
  assert.equal((await call('/api/applicant/finalize', p.token, { requestId: newId })).status, 200);
  assert.equal((await db.collection('practice_owner_profiles').doc(p.uid).get()).data().clinicName, undefined);
  // A rejected owner can submit corrected information; prior revisions stay intact.
  const ownerRevision = (await db.collection('verification_submissions').doc(p.uid).collection('revisions').doc(results[1].submissionId).get()).data();
  assert.equal(ownerRevision.verificationStatus, 'rejected');
  const pending = await call('/api/verification/queue', admin.token, {});
  const currentOwner = pending.body.data.items.find(item => item.uid === p.uid);
  assert.equal((await call('/api/verification/review', admin.token, { uid: p.uid, submissionId: currentOwner.submissionId, decision: 'approved' })).status, 200);
  for (const [u, type, data] of [[l, 'locum', locum], [p, 'practice_owner', owner]]) {
    const profileName = type === 'locum' ? 'locum_profiles' : 'practice_owner_profiles';
    const before = (await db.collection(profileName).doc(u.uid).get()).data();
    assert.equal(before.verificationStatus, 'approved');
    assert.equal((await call('/api/applicant/draft', u.token, { requestId: rid(), accountType: type, submittedFields: data })).status, 409);
    assert.deepEqual((await db.collection(profileName).doc(u.uid).get()).data(), before);
    const original = await db.collection('verification_submissions').doc(u.uid).collection('revisions').doc(results.find(x => x.uid === u.uid).submissionId).get();
    assert.equal(original.exists, true);
  }

  // Pause the next transaction before it starts, allowing the competing request
  // to commit first. The real Firestore transaction still runs after release.
  function pauseNextTransaction() {
    let signal, release;
    const reached = new Promise(resolve => { signal = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const original = db.runTransaction;
    db.runTransaction = function (...args) {
      db.runTransaction = original;
      signal();
      return gate.then(() => original.apply(db, args));
    };
    return { reached, release };
  }
  // Exercise both commit orderings with fresh synthetic applicants.
  for (const type of ['locum', 'practice_owner']) {
    for (const operation of ['draft', 'upload', 'finalize']) {
      for (const firstCommit of ['approval', 'operation']) {
      const payload = enrollment(type, `race-${randomUUID()}@example.invalid`);
      const enrolled = await call('/api/enrollment', null, payload); assert.equal(enrolled.status, 200);
      const u = { uid: enrolled.body.data.uid, token: await tokenAfterCutoff(enrolled.body.data.uid, payload.email) };
      const firstId = rid();
      const first = await call('/api/applicant/draft', u.token, { requestId: firstId, accountType: type, submittedFields: fields[type] });
      assert.equal(first.status, 200);
      assert.equal((await call('/api/applicant/upload/' + firstId, u.token, Buffer.from('%PDF-race-first'), 'application/pdf')).status, 200);
      assert.equal((await call('/api/applicant/finalize', u.token, { requestId: firstId })).status, 200);
      const nextId = rid();
      let next;
      if (operation !== 'draft') {
        next = await call('/api/applicant/draft', u.token, { requestId: nextId, accountType: type, submittedFields: fields[type] });
        assert.equal(next.status, 200);
      }
      if (operation === 'finalize') {
        assert.equal((await call('/api/applicant/upload/' + nextId, u.token, Buffer.from('%PDF-race-next'), 'application/pdf')).status, 200);
      }
      const compete = () => operation === 'draft'
        ? call('/api/applicant/draft', u.token, { requestId: nextId, accountType: type, submittedFields: fields[type] })
        : operation === 'upload'
          ? call('/api/applicant/upload/' + nextId, u.token, Buffer.from('%PDF-race-next'), 'application/pdf')
          : call('/api/applicant/finalize', u.token, { requestId: nextId });
      const approve = () => call('/api/verification/review', admin.token, { uid: u.uid, submissionId: first.body.data.submissionId, decision: 'approved' });
      const pause = pauseNextTransaction();
      const delayed = firstCommit === 'approval' ? compete() : approve();
      await pause.reached;
      let review, attempt;
      try {
        if (firstCommit === 'approval') review = await approve();
        else attempt = await compete();
      } finally { pause.release(); }
      if (firstCommit === 'approval') attempt = await delayed;
      else review = await delayed;
      assert.equal(attempt.status, firstCommit === 'approval' ? 409 : 200, `${type} ${operation} ${firstCommit}: ${JSON.stringify(attempt)}`);
      assert.equal(review.status, firstCommit === 'operation' && operation === 'finalize' ? 409 : 200, JSON.stringify(review));
      const profileName = type === 'locum' ? 'locum_profiles' : 'practice_owner_profiles';
      const profile = (await db.collection(profileName).doc(u.uid).get()).data();
      if (review.status === 200) {
        assert.equal(profile.verificationStatus, 'approved');
        if (operation === 'finalize') assert.equal(attempt.status, 409);
        assert.equal((await call('/api/applicant/draft', u.token, { requestId: rid(), accountType: type, submittedFields: fields[type] })).status, 409);
        if (operation !== 'draft' || attempt.status === 200) {
          assert.equal((await call('/api/applicant/upload/' + nextId, u.token, Buffer.from('%PDF-race-next'), 'application/pdf')).status, 409);
          assert.equal((await call('/api/applicant/finalize', u.token, { requestId: nextId })).status, 409);
        }
      } else {
        assert.equal(operation, 'finalize');
        assert.equal(attempt.status, 200);
        assert.equal(profile.verificationStatus, 'pending');
      }
      assert.equal((await db.collection('verification_submissions').doc(u.uid).collection('revisions').doc(first.body.data.submissionId).get()).exists, true);
      if (operation === 'upload' && firstCommit === 'approval') {
        const revision = await db.collection('verification_submissions').doc(u.uid).collection('revisions').doc(next.body.data.submissionId).get();
        assert.equal(revision.exists, false, 'Rejected upload must not publish a revision');
        const response = await fetch(`http://${HOST}:${PORT}/api/verification/document?uid=${encodeURIComponent(u.uid)}&submissionId=${next.body.data.submissionId}`, { headers: { origin: ORIGIN, authorization: `Bearer ${admin.token}` } });
        assert.equal(response.status, 404, 'Uncommitted upload must not be accessible');
      }
      }
    }
  }
  for (const type of ['locum', 'practice_owner']) {
    const payload = enrollment(type, `reject-${randomUUID()}@example.invalid`);
    const enrolled = await call('/api/enrollment', null, payload); assert.equal(enrolled.status, 200);
    const uid = enrolled.body.data.uid, token = await tokenAfterCutoff(uid, payload.email), firstId = rid();
    const first = await call('/api/applicant/draft', token, { requestId: firstId, accountType: type, submittedFields: fields[type] });
    assert.equal(first.status, 200);
    assert.equal((await call('/api/applicant/upload/' + firstId, token, Buffer.from('%PDF-rejected'), 'application/pdf')).status, 200);
    assert.equal((await call('/api/applicant/finalize', token, { requestId: firstId })).status, 200);
    assert.equal((await call('/api/verification/review', admin.token, { uid, submissionId: first.body.data.submissionId, decision: 'rejected', rejectionReason: 'Correct the details' })).status, 200);
    const corrected = type === 'locum' ? { ...locum, fullName: 'Corrected Locum' } : { ...owner, clinicName: 'Corrected Clinic' };
    const secondId = rid();
    const second = await call('/api/applicant/draft', token, { requestId: secondId, accountType: type, submittedFields: corrected });
    assert.equal(second.status, 200);
    assert.equal((await call('/api/applicant/upload/' + secondId, token, Buffer.from('%PDF-corrected'), 'application/pdf')).status, 200);
    assert.equal((await call('/api/applicant/finalize', token, { requestId: secondId })).status, 200);
    const revisions = db.collection('verification_submissions').doc(uid).collection('revisions');
    assert.equal((await revisions.doc(first.body.data.submissionId).get()).data().verificationStatus, 'rejected');
    assert.equal((await revisions.doc(second.body.data.submissionId).get()).data().verificationStatus, 'pending');
  }
  const manage = data => manageAccount({ auth, db, actor, data: { uid: l.uid, kind: 'locum', action: 'setDisabled', ...data }, demoPolicy: { accountMutationsEnabled: true } });
  await manage({ disabled: true, expectedDisabled: false });
  assert.equal((await db.collection('account_access').doc(l.uid).get()).data().state, 'disabled');
  assert.ok([401, 403].includes((await call('/api/applicant/draft', l.token, { requestId: rid(), accountType: 'locum', submittedFields: locum })).status));
  await manage({ disabled: false, expectedDisabled: true });
  const enabled = (await db.collection('account_access').doc(l.uid).get()).data();
  assert.equal(enabled.state, 'active'); assert.ok(Number.isInteger(enabled.validAfter));
  assert.ok([401, 403].includes((await call('/api/applicant/draft', l.token, { requestId: rid(), accountType: 'locum', submittedFields: locum })).status));
  const freshToken = await tokenAfterCutoff(l.uid, locumEnrollment.email);
  assert.equal((await call('/api/applicant/draft', freshToken, { requestId: rid(), accountType: 'locum', submittedFields: locum })).status, 409);
  // A failed Auth transition leaves access blocked and can be retried.
  let failed = false;
  const flaky = new Proxy(auth, { get(target, key) { if (key === 'revokeRefreshTokens' && !failed) return async () => { failed = true; throw Error('synthetic failure'); }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  await assert.rejects(manageAccount({ auth: flaky, db, actor, data: { uid: l.uid, kind: 'locum', action: 'setDisabled', disabled: true, expectedDisabled: false }, demoPolicy: { accountMutationsEnabled: true } }));
  assert.equal((await db.collection('account_access').doc(l.uid).get()).data().state, 'disabled');
  await manage({ disabled: true, expectedDisabled: false });
  assert.equal((await db.collection('account_access').doc(l.uid).get()).data().operation, null);
  await auth.updateUser(unassigned.uid, { disabled: true });
  assert.ok([401, 403].includes((await call('/api/applicant/draft', unassigned.token, { requestId: rid(), accountType: 'locum', submittedFields: locum })).status));
  // Install the main repository candidate only in this disposable emulator.
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = require('firebase/firestore');
  const rulesPath = path.resolve(__dirname, '../../../Optolocum/optolocum/firebase/local-verification/firestore.candidate.rules');
  const rules = await fs.readFile(rulesPath, 'utf8');
  const env = await initializeTestEnvironment({ projectId: 'demo-optolocum-account-management', firestore: { host: '127.0.0.1', port: 18080, rules } });
  t.after(() => env.cleanup());
  const rulesLocum = `rl-${randomUUID()}`, rulesOwner = `ro-${randomUUID()}`;
  for (const [uid, kind, collection] of [[rulesLocum, 'locum', 'locum_profiles'], [rulesOwner, 'practice_owner', 'practice_owner_profiles']]) {
    await db.collection('account_management').doc(uid).set({ trustedAccountType: kind });
    await db.collection('account_access').doc(uid).set({ state: 'active', validAfter: 100 });
    await db.collection(collection).doc(uid).set({ verificationStatus: 'approved' });
  }
  const ownerDb = env.authenticatedContext(rulesOwner, { auth_time: 101 }).firestore();
  const locumDb = env.authenticatedContext(rulesLocum, { auth_time: 101 }).firestore();
  const staleDb = env.authenticatedContext(rulesOwner, { auth_time: 100 }).firestore();
  const job = `job-${randomUUID()}`;
  await assertFails(updateDoc(doc(locumDb, 'locum_profiles', rulesLocum), { phoneNumber: '000' }));
  await assertFails(updateDoc(doc(ownerDb, 'practice_owner_profiles', rulesOwner), { phoneNumber: '000' }));
  await assertFails(setDoc(doc(locumDb, 'account_management', rulesLocum), { trustedAccountType: 'practice_owner' }));
  await db.collection('practice_owner_profiles').doc(rulesOwner).update({ verificationStatus: 'pending' });
  await assertFails(setDoc(doc(ownerDb, 'job_postings', `${job}-unapproved`), { clinicOwnerId: rulesOwner, status: 'available' }));
  await db.collection('practice_owner_profiles').doc(rulesOwner).update({ verificationStatus: 'approved' });
  await db.collection('account_management').doc(rulesOwner).update({ trustedAccountType: 'locum' });
  await assertFails(setDoc(doc(ownerDb, 'job_postings', `${job}-wrong-type`), { clinicOwnerId: rulesOwner, status: 'available' }));
  await db.collection('account_management').doc(rulesOwner).update({ trustedAccountType: 'practice_owner' });
  await assertFails(setDoc(doc(staleDb, 'job_postings', `${job}-stale`), { clinicOwnerId: rulesOwner, status: 'available' }));
  await assertSucceeds(setDoc(doc(ownerDb, 'job_postings', job), { clinicOwnerId: rulesOwner, status: 'available' }));
  await assertSucceeds(setDoc(doc(locumDb, 'applications', `${job}_${rulesLocum}`), { jobId: job, locumId: rulesLocum, clinicOwnerId: rulesOwner, status: 'pending', appliedAt: serverTimestamp() }));
  const deletedJob = `${job}-deleted`;
  await db.collection('job_postings').doc(deletedJob).set({ clinicOwnerId: rulesOwner, status: 'deleted' });
  await assertFails(setDoc(doc(locumDb, 'applications', `${deletedJob}_${rulesLocum}`), { jobId: deletedJob, locumId: rulesLocum, clinicOwnerId: rulesOwner, status: 'pending', appliedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(locumDb, 'account_access', rulesLocum), { state: 'active', validAfter: 0 }));
  await db.collection('account_access').doc(rulesOwner).update({ state: 'disabled' });
  await assertFails(setDoc(doc(ownerDb, 'job_postings', `${job}-disabled`), { clinicOwnerId: rulesOwner, status: 'available' }));
  await assertFails(updateDoc(doc(ownerDb, 'job_postings', job), { title: 'Synthetic stale-token update' }));
  await assertFails(updateDoc(doc(ownerDb, 'applications', `${job}_${rulesLocum}`), { status: 'hired' }));
  await db.collection('account_access').doc(rulesOwner).update({ state: 'active', validAfter: 101 });
  await assertFails(setDoc(doc(ownerDb, 'job_postings', `${job}-old-token`), { clinicOwnerId: rulesOwner, status: 'available' }));
  await db.collection('locum_profiles').doc(rulesLocum).update({ verificationStatus: 'pending' });
  const anotherJob = `${job}-another`;
  await db.collection('job_postings').doc(anotherJob).set({ clinicOwnerId: rulesOwner, status: 'available' });
  await assertFails(setDoc(doc(locumDb, 'applications', `${anotherJob}_${rulesLocum}`), { jobId: anotherJob, locumId: rulesLocum, clinicOwnerId: rulesOwner, status: 'pending', appliedAt: serverTimestamp() }));
  const rulesAdmin = await user(true);
  const adminMock = env.authenticatedContext(rulesAdmin.uid, { admin: true, auth_time: Math.floor(Date.now() / 1000) + 30 }).firestore();
  await assertFails(getDoc(doc(adminMock, 'locum_profiles', rulesLocum)));
  await assert.rejects(controlAdminAccess({ auth, db, uid: rulesLocum, action: 'bootstrap' }));
  await assert.rejects(controlAdminAccess({ auth, db, uid: p.uid, action: 'bootstrap' }));
  assert.equal((await call('/api/admin-access', p.token, {})).status, 404);
  let adminFailure = true;
  const failedAdminAuth = new Proxy(auth, { get(target, key) { if (key === 'revokeRefreshTokens' && adminFailure) return async () => { adminFailure = false; throw Error('synthetic failure'); }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  await assert.rejects(controlAdminAccess({ auth: failedAdminAuth, db, uid: rulesAdmin.uid, action: 'bootstrap' }));
  assert.equal((await db.collection('account_access').doc(rulesAdmin.uid).get()).data().state, 'disabled');
  await assertFails(getDoc(doc(adminMock, 'locum_profiles', rulesLocum)));
  await controlAdminAccess({ auth, db, uid: rulesAdmin.uid, action: 'bootstrap' });
  await assertSucceeds(getDoc(doc(adminMock, 'locum_profiles', rulesLocum)));
  await controlAdminAccess({ auth, db, uid: rulesAdmin.uid, action: 'disable' });
  await assertFails(getDoc(doc(adminMock, 'locum_profiles', rulesLocum)));
  await auth.updateUser(rulesAdmin.uid, { disabled: false });
  await controlAdminAccess({ auth, db, uid: rulesAdmin.uid, action: 'bootstrap' });
  await assertSucceeds(getDoc(doc(adminMock, 'locum_profiles', rulesLocum)));
  await controlAdminAccess({ auth, db, uid: rulesAdmin.uid, action: 'remove-admin' });
  await assertFails(getDoc(doc(adminMock, 'locum_profiles', rulesLocum)));
  assert.notEqual((await auth.getUser(rulesAdmin.uid)).customClaims?.admin, true);
});
