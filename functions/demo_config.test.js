"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDemoConfig, PROJECT, assertLocalServerEnvironment } = require('./demo_config');
test('demo gate requires exact project, explicit bounded allowlist and boolean opt-in', () => {
  const base = { projectId: PROJECT, enableMutations: false, approvedTestUids: [] };
  assert.equal(parseDemoConfig(base).enabled, false);
  for (const patch of [{ projectId: 'wrong' }, { enableMutations: 'true' }, { enableMutations: true },
    { approvedTestUids: ['*'] }, { approvedTestUids: ['uid', 'uid'] }, { approvedTestUids: ['../uid'] },
    { approvedTestUids: Array(21).fill('uid') }, { extra: true }]) assert.throws(() => parseDemoConfig({ ...base, ...patch }));
  const enabled = parseDemoConfig({ ...base, enableMutations: true, approvedTestUids: ['synthetic-approved'], locumTestUid: 'synthetic-approved' });
  assert.equal(enabled.allows('synthetic-approved'), true);
  assert.equal(enabled.allows('other'), false);
  assert.equal(parseDemoConfig({ ...base, approvedTestUids: ['synthetic-approved'] }).allows('synthetic-approved'), false);
});
test('operation scope permits only the selected Locum and cannot enable Delete', () => {
  const base = { projectId: PROJECT, enableMutations: true, approvedTestUids: ['synthetic-locum', 'synthetic-owner'], locumTestUid: 'synthetic-locum' };
  const policy = parseDemoConfig(base);
  assert.equal(policy.allowsOperation('synthetic-locum', 'locum', 'setDisabled'), true);
  for (const [uid, kind, action] of [['synthetic-locum', 'locum', 'delete'], ['synthetic-owner', 'practice_owner', 'setDisabled'],
    ['synthetic-locum', 'practice_owner', 'setDisabled'], ['other', 'locum', 'setDisabled']]) assert.equal(policy.allowsOperation(uid, kind, action), false);
  assert.throws(() => parseDemoConfig({ ...base, locumTestUid: 'other' }));
  assert.throws(() => parseDemoConfig({ ...base, locumTestUid: undefined }));
  assert.throws(() => parseDemoConfig({ ...base, allowedOperations: ['delete'] }));
  assert.equal(parseDemoConfig({ ...base, enableMutations: false }).allowsOperation('synthetic-locum', 'locum', 'setDisabled'), false);
});
test('local credential preflight is offline, sanitized and rejects unsafe configuration', () => {
  const env = { GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-local-file' };
  assert.doesNotThrow(() => assertLocalServerEnvironment(env, () => true));
  assert.throws(() => assertLocalServerEnvironment(env, () => false), /credential file is unavailable/);
  assert.throws(() => assertLocalServerEnvironment({}, () => false), /credential file is unavailable/);
  for (const patch of [{ DEBUG: 'synthetic' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1' }, { GCLOUD_PROJECT: 'wrong' }])
    assert.throws(() => assertLocalServerEnvironment({ ...env, ...patch }, () => true));
});
