'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRealEnvironment } = require('./real_config');
const path = require('node:path');
const base = { OPT_REAL_FIREBASE_MODE: 'prepare-read-only', OPT_REAL_PROJECT: 'optolocum-f314e',
  GOOGLE_APPLICATION_CREDENTIALS: path.resolve('credential.json'), OPT_DOCUMENT_STORE_ROOT: path.resolve('private') };
test('real preparation requires explicit consistent configuration and rejects emulator overrides', () => {
  assert.equal(validateRealEnvironment(base, () => true).projectId, 'optolocum-f314e');
  for (const change of [{ OPT_REAL_FIREBASE_MODE: '' }, { OPT_REAL_PROJECT: 'other' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { GCLOUD_PROJECT: 'other' },
    { FIREBASE_CONFIG: '{"projectId":"other"}' }, { OPT_DOCUMENT_STORE_ROOT: '' }])
    assert.throws(() => validateRealEnvironment({ ...base, ...change }, () => true));
  assert.throws(() => validateRealEnvironment(base, () => false));
});
