"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDemoConfig, PROJECT, assertLocalServerEnvironment } = require('./demo_config');

test('both independent mutation permissions default off', () => {
  const policy = parseDemoConfig({ projectId: PROJECT });
  assert.equal(policy.accountMutationsEnabled, false);
  assert.equal(policy.jobSoftDeleteEnabled, false);
  assert.throws(() => parseDemoConfig({ projectId: PROJECT, enableMutations: true }));
  assert.throws(() => parseDemoConfig({ projectId: PROJECT, approvedTestUids: ['legacy'] }));
  assert.throws(() => parseDemoConfig({ projectId: PROJECT, approvedJobIds: ['legacy'] }));
});

test('account and job permissions enable independently', () => {
  const accountOnly = parseDemoConfig({ projectId: PROJECT, enableAccountMutations: true });
  assert.equal(accountOnly.accountMutationsEnabled, true);
  assert.equal(accountOnly.jobSoftDeleteEnabled, false);
  const jobsOnly = parseDemoConfig({ projectId: PROJECT, enableJobSoftDelete: true });
  assert.equal(jobsOnly.accountMutationsEnabled, false);
  assert.equal(jobsOnly.jobSoftDeleteEnabled, true);
  const both = parseDemoConfig({ projectId: PROJECT, enableAccountMutations: true, enableJobSoftDelete: true });
  assert.equal(both.accountMutationsEnabled, true);
  assert.equal(both.jobSoftDeleteEnabled, true);
});

test('unknown fields, wrong project and non-boolean permissions fail closed', () => {
  for (const config of [
    { projectId: 'wrong' },
    { projectId: PROJECT, enableAccountMutations: 'true' },
    { projectId: PROJECT, enableJobSoftDelete: 1 },
    { projectId: PROJECT, locumTestUid: 'legacy' },
    { projectId: PROJECT, practiceOwnerTestUid: 'legacy' },
    { projectId: PROJECT, approvedTestUids: [] },
    { projectId: PROJECT, approvedJobIds: [] },
    { projectId: PROJECT, extra: true },
  ]) assert.throws(() => parseDemoConfig(config));
});

test('local credential preflight is offline, sanitized and rejects unsafe configuration', () => {
  const env = { GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-local-file' };
  assert.doesNotThrow(() => assertLocalServerEnvironment(env, () => true));
  assert.throws(() => assertLocalServerEnvironment(env, () => false), /credential file is unavailable/);
  assert.throws(() => assertLocalServerEnvironment({}, () => false), /credential file is unavailable/);
  for (const patch of [{ DEBUG: 'synthetic' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1' }, { GCLOUD_PROJECT: 'wrong' }])
    assert.throws(() => assertLocalServerEnvironment({ ...env, ...patch }, () => true));
});
