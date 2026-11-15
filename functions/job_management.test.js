"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { manageJob } = require('./job_management');
const { parseDemoConfig, PROJECT } = require('./demo_config');

function fixture({ jobIds = ['job-a', 'job-b'], initialJobs = {}, policy = parseDemoConfig({ projectId: PROJECT, enableJobSoftDelete: true }) } = {}) {
  const jobs = new Map(jobIds.map(id => [id, initialJobs[id] || {
    status: 'available', jobDate: new Date(Date.now() + 2 * 86400000), endTime: '23:59',
    title: `Preserve ${id}`, clinicOwnerId: 'synthetic-owner', extra: { nested: true },
  }]));
  const applications = new Map(jobIds.map(id => [`${id}_applicant`, { jobId: id, status: 'pending' }]));
  let writes = 0;
  const auth = { getUser: async () => ({ disabled: false, customClaims: { admin: true } }) };
  const db = {
    collection: name => name === 'job_postings'
      ? { doc: id => ({ id }) }
      : { where: (field, operator, value) => ({ collection: name, field, operator, value }) },
    runTransaction: async callback => callback({
      get: async ref => ref.id
        ? { exists: jobs.has(ref.id), data: () => jobs.get(ref.id) }
        : { docs: [...applications.entries()].filter(([, value]) => value[ref.field] === ref.value)
            .map(([id, value]) => ({ id, data: () => value })) },
      update: (ref, patch) => { jobs.set(ref.id, { ...jobs.get(ref.id), ...patch }); writes++; },
    }),
  };
  const actor = { uid: 'synthetic-admin', admin: true, auth_time: Date.now() / 1000 };
  const run = (jobId, data = {}, extra = {}) => manageJob({ auth, db, actor, demoPolicy: policy,
    data: { jobId, action: 'softDelete', expectedStatus: 'available', ...data }, ...extra });
  return { jobs, applications, auth, db, actor, run, get writes() { return writes; } };
}

test('job soft-delete gate defaults off and is independent of the account permission', () => {
  const defaults = parseDemoConfig({ projectId: PROJECT });
  assert.equal(defaults.accountMutationsEnabled, false);
  assert.equal(defaults.jobSoftDeleteEnabled, false);
  const accountsOnly = parseDemoConfig({ projectId: PROJECT, enableAccountMutations: true });
  assert.equal(accountsOnly.accountMutationsEnabled, true);
  assert.equal(accountsOnly.jobSoftDeleteEnabled, false);
  const jobsOnly = parseDemoConfig({ projectId: PROJECT, enableJobSoftDelete: true });
  assert.equal(jobsOnly.accountMutationsEnabled, false);
  assert.equal(jobsOnly.jobSoftDeleteEnabled, true);
});

test('soft delete dynamically accepts different eligible job IDs and preserves documents and applications', async () => {
  const f = fixture();
  for (const id of ['job-a', 'job-b']) {
    const before = structuredClone(f.jobs.get(id));
    const application = structuredClone(f.applications.get(`${id}_applicant`));
    assert.deepEqual(await f.run(id), { status: 'deleted', mutationsEnabled: true });
    assert.equal(f.jobs.get(id).status, 'deleted');
    assert.equal(f.jobs.get(id).title, before.title);
    assert.deepEqual(f.jobs.get(id).extra, before.extra);
    assert.ok(f.jobs.get(id).deletedAt);
    assert.ok(f.jobs.get(id).updatedAt);
    assert.deepEqual(f.applications.get(`${id}_applicant`), application);
    await assert.rejects(f.run(id), /already deleted/);
  }
  assert.equal(f.jobs.size, 2, 'documents are retained');
  assert.equal(f.applications.size, 2, 'applications are retained');
  assert.equal(f.writes, 2);
});

test('authorization, recent login, gate, expected state and validation fail before writes', async () => {
  const f = fixture();
  for (const [data, extra] of [[{}, {actor:{...f.actor,admin:false}}], [{},{actor:{...f.actor,auth_time:0}}], [{},{actor:{...f.actor,auth_time:Infinity}}], [{},{actor:{...f.actor,auth_time:NaN}}], [{},{actor:{...f.actor,auth_time:Date.now()/1000+60}}], [{},{demoPolicy:null}], [{expectedStatus:'closed'},{}], [{action:'delete'},{}], [{extra:true},{}], [{jobId:'../bad'},{}]]) {
    await assert.rejects(f.run('job-a', data, extra));
  }
  f.auth.getUser = async () => ({ disabled: true, customClaims: { admin: true } });
  await assert.rejects(f.run('job-a'));
  assert.equal(f.writes, 0);
});

test('Delete then Undo Delete restores the previous status and preserves applications', async () => {
  const f = fixture();
  const application = structuredClone(f.applications.get('job-a_applicant'));
  assert.deepEqual(await f.run('job-a'), { status: 'deleted', mutationsEnabled: true });
  assert.equal(f.jobs.get('job-a').statusBeforeDelete, 'available');
  assert.deepEqual(await f.run('job-a', { action: 'restore', expectedStatus: 'deleted' }), {
    status: 'available', mutationsEnabled: true,
  });
  assert.equal(f.jobs.get('job-a').status, 'available');
  assert.deepEqual(f.applications.get('job-a_applicant'), application);
  assert.equal(f.jobs.size, 2);
});

test('restore keeps terminal statuses and never makes expired or filled postings available', async () => {
  const f = fixture({ initialJobs: {
    'job-expired': { status: 'available', jobDate: new Date(Date.now() - 86400000), endTime: '23:59' },
    'job-filled': { status: 'available', jobDate: new Date(Date.now() + 86400000), endTime: '23:59' },
    'job-cancelled': { status: 'cancelled' },
  }, jobIds: ['job-expired', 'job-filled', 'job-cancelled'] });
  f.applications.set('job-filled_hire', { jobId: 'job-filled', status: 'hired' });
  for (const id of ['job-expired', 'job-filled', 'job-cancelled']) {
    await f.run(id, { expectedStatus: f.jobs.get(id).status });
    const result = await f.run(id, { action: 'restore', expectedStatus: 'deleted' });
    assert.notEqual(result.status, 'available');
    assert.equal(f.jobs.get(id).status, result.status);
  }
  assert.equal(f.jobs.get('job-expired').status, 'expired');
  assert.equal(f.jobs.get('job-filled').status, 'filled');
  assert.equal(f.jobs.get('job-cancelled').status, 'cancelled');
});

test('restore fails closed when prior status is missing or expected state is stale', async () => {
  const f = fixture();
  await f.run('job-a');
  delete f.jobs.get('job-a').statusBeforeDelete;
  await assert.rejects(f.run('job-a', { action: 'restore', expectedStatus: 'deleted' }), { code: 'failed-precondition' });
  assert.equal(f.jobs.get('job-a').status, 'deleted');
  await assert.rejects(f.run('job-b', { action: 'restore', expectedStatus: 'available' }), { code: 'invalid-argument' });
});

test('status is read-only, disabled gate rejects, and missing jobs cannot be created', async () => {
  const f = fixture();
  const status = await manageJob({ auth: f.auth, db: f.db, actor: f.actor, demoPolicy: parseDemoConfig({ projectId: PROJECT, enableJobSoftDelete: true }), data: { jobId: 'job-a', action: 'status' } });
  assert.deepEqual(status, { status: 'available', mutationsEnabled: true });
  assert.equal(f.writes, 0);
  const off = fixture({ policy: parseDemoConfig({ projectId: PROJECT }) });
  await assert.rejects(off.run('job-a'), { code: 'failed-precondition' });
  await assert.rejects(f.run('missing'), { code: 'not-found' });
  assert.equal(f.writes, 0);
});
