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
test('isolated applicant HTTP workflow and authorization', { timeout: 120000 }, async t => {
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
  async function call(route, token, body, contentType = 'application/json') {
    const response = await fetch(`http://${HOST}:${PORT}${route}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: contentType === 'application/json' ? JSON.stringify(body) : body });
    return { status: response.status, body: await response.json() };
  }
  const admin = await user(true), unassigned = await user();
  assert.equal((await call('/api/verification/queue', admin.token, {})).status, 403);
  await controlAdminAccess({ auth, db, uid: admin.uid, action: 'bootstrap' });
  await new Promise(resolve => setTimeout(resolve, 1100));
  admin.token = await tokenFor((await auth.getUser(admin.uid)).email);
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
  await new Promise(resolve => setTimeout(resolve, 1100));
  const l = { uid: attempts[0].body.data.uid, token: await tokenFor(locumEnrollment.email) };
  const ownerEnrollment = enrollment('practice_owner', `owner-${randomUUID()}@example.invalid`);
  const ownerResult = await call('/api/enrollment', null, ownerEnrollment); assert.equal(ownerResult.status, 200);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const p = { uid: ownerResult.body.data.uid, token: await tokenFor(ownerEnrollment.email) };
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
    const created = await call('/api/applicant/draft', u.token, payload); assert.equal(created.status, 200);
    assert.deepEqual((await call('/api/applicant/draft', u.token, payload)).body, created.body);
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
  const nextId = rid();
  const next = await call('/api/applicant/draft', p.token, { requestId: nextId, accountType: 'practice_owner', submittedFields: owner });
  assert.equal(next.status, 200);
  assert.equal((await call('/api/applicant/upload/' + nextId, p.token, Buffer.from('%PDF-latest'), 'application/pdf')).status, 200);
  const pending = await call('/api/verification/queue', admin.token, {});
  const previous = pending.body.data.items.find(item => item.uid === p.uid);
  const race = await Promise.all([
    call('/api/applicant/finalize', p.token, { requestId: nextId }),
    call('/api/verification/review', admin.token, { uid: p.uid, submissionId: previous.submissionId, decision: 'approved' }),
  ]);
  assert.equal(race[0].status, 200);
  assert.ok([200, 409].includes(race[1].status));
  assert.equal((await db.collection('practice_owner_profiles').doc(p.uid).get()).data().verificationStatus, 'pending');
  const ownerEdit = { fullName: 'Edited Owner', phoneNumber: '01122223333', email: 'edited-owner@example.invalid', role: 'HR' };
  const [ownerReview] = await Promise.all([
    call('/api/verification/review', admin.token, { uid: p.uid, submissionId: next.body.data.submissionId, decision: 'approved' }),
    db.collection('practice_owner_profiles').doc(p.uid).update(ownerEdit),
  ]);
  assert.equal(ownerReview.status, 200);
  const ownerApproved = (await db.collection('practice_owner_profiles').doc(p.uid).get()).data();
  assert.equal(ownerApproved.clinicName, owner.clinicName);
  for (const [key, value] of Object.entries(ownerEdit)) assert.equal(ownerApproved[key], value);
  assert.equal(ownerApproved.companyEmail, undefined); assert.equal(ownerApproved.contactNumber, undefined);
  const rejectId = rid(), ownerChange = { ...owner, clinicName: 'Unapproved Clinic' };
  const rejectDraft = await call('/api/applicant/draft', p.token, { requestId: rejectId, accountType: 'practice_owner', submittedFields: ownerChange });
  assert.equal((await call('/api/applicant/upload/' + rejectId, p.token, Buffer.from('%PDF-next-owner'), 'application/pdf')).status, 200);
  assert.equal((await call('/api/applicant/finalize', p.token, { requestId: rejectId })).status, 200);
  assert.equal((await db.collection('practice_owner_profiles').doc(p.uid).get()).data().clinicName, owner.clinicName);
  assert.equal((await call('/api/verification/review', admin.token, { uid: p.uid, submissionId: rejectDraft.body.data.submissionId, decision: 'rejected', rejectionReason: 'Synthetic reason' })).status, 200);
  assert.equal((await db.collection('practice_owner_profiles').doc(p.uid).get()).data().clinicName, owner.clinicName);
  const locumChange = { ...locum, fullName: 'Changed Synthetic Name' }, locumId = rid();
  const changed = await call('/api/applicant/draft', l.token, { requestId: locumId, accountType: 'locum', submittedFields: locumChange });
  assert.equal((await call('/api/applicant/upload/' + locumId, l.token, Buffer.from('%PDF-new-locum'), 'application/pdf')).status, 200);
  assert.equal((await call('/api/applicant/finalize', l.token, { requestId: locumId })).status, 200);
  assert.equal((await db.collection('locum_profiles').doc(l.uid).get()).data().fullName, locum.fullName);
  const locumEdit = { email: 'new-contact@example.invalid', phoneNumber: '0191234567', gender: 'Other' };
  const [locumReview] = await Promise.all([
    call('/api/verification/review', admin.token, { uid: l.uid, submissionId: changed.body.data.submissionId, decision: 'approved' }),
    db.collection('locum_profiles').doc(l.uid).update(locumEdit),
  ]);
  assert.equal(locumReview.status, 200);
  const locumApproved = (await db.collection('locum_profiles').doc(l.uid).get()).data();
  assert.equal(locumApproved.fullName, locumChange.fullName);
  for (const [key, value] of Object.entries(locumEdit)) assert.equal(locumApproved[key], value);
  const locumRejectedId = rid();
  const locumRejected = await call('/api/applicant/draft', l.token, { requestId: locumRejectedId, accountType: 'locum', submittedFields: { ...locum, fullName: 'Rejected Name' } });
  assert.equal((await call('/api/applicant/upload/' + locumRejectedId, l.token, Buffer.from('%PDF-locum-reject'), 'application/pdf')).status, 200);
  assert.equal((await call('/api/applicant/finalize', l.token, { requestId: locumRejectedId })).status, 200);
  assert.equal((await call('/api/verification/review', admin.token, { uid: l.uid, submissionId: locumRejected.body.data.submissionId, decision: 'rejected', rejectionReason: 'Synthetic reason' })).status, 200);
  assert.equal((await db.collection('locum_profiles').doc(l.uid).get()).data().fullName, locumChange.fullName);
  const locumResubmit = rid();
  const locumResubmitted = await call('/api/applicant/draft', l.token, { requestId: locumResubmit, accountType: 'locum', submittedFields: locumChange });
  assert.equal((await call('/api/applicant/upload/' + locumResubmit, l.token, Buffer.from('%PDF-locum-resubmit'), 'application/pdf')).status, 200);
  assert.equal((await call('/api/applicant/finalize', l.token, { requestId: locumResubmit })).status, 200);
  assert.equal((await call('/api/verification/review', admin.token, { uid: l.uid, submissionId: locumResubmitted.body.data.submissionId, decision: 'approved' })).status, 200);
  const manage = data => manageAccount({ auth, db, actor, data: { uid: l.uid, kind: 'locum', action: 'setDisabled', ...data }, demoPolicy: { accountMutationsEnabled: true } });
  await manage({ disabled: true, expectedDisabled: false });
  assert.equal((await db.collection('account_access').doc(l.uid).get()).data().state, 'disabled');
  assert.ok([401, 403].includes((await call('/api/applicant/draft', l.token, { requestId: rid(), accountType: 'locum', submittedFields: locum })).status));
  await manage({ disabled: false, expectedDisabled: true });
  const enabled = (await db.collection('account_access').doc(l.uid).get()).data();
  assert.equal(enabled.state, 'active'); assert.ok(Number.isInteger(enabled.validAfter));
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
  await assertFails(setDoc(doc(staleDb, 'job_postings', `${job}-stale`), { clinicOwnerId: rulesOwner, status: 'available' }));
  await assertSucceeds(setDoc(doc(ownerDb, 'job_postings', job), { clinicOwnerId: rulesOwner, status: 'available' }));
  await assertSucceeds(setDoc(doc(locumDb, 'applications', `${job}_${rulesLocum}`), { jobId: job, locumId: rulesLocum, clinicOwnerId: rulesOwner, status: 'pending', appliedAt: serverTimestamp() }));
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
