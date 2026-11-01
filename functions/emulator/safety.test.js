"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROJECT, AUTH_HOST, FIRESTORE_HOST, assertEmulatorEnvironment } = require('./safety');
test('emulator startup rejects missing hosts, production projects, remote hosts and credentials', () => {
  const safe = { GCLOUD_PROJECT: PROJECT, FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST, FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST };
  assert.doesNotThrow(() => assertEmulatorEnvironment(safe));
  assert.doesNotThrow(() => assertEmulatorEnvironment({ ...safe, FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com`, databaseURL: `https://${PROJECT}.firebaseio.com` }) }));
  for (const patch of [
    { GCLOUD_PROJECT: undefined }, { GCLOUD_PROJECT: 'optolocum-f314e' },
    { GOOGLE_CLOUD_PROJECT: 'optolocum-f314e' }, { FIREBASE_AUTH_EMULATOR_HOST: undefined },
    { FIRESTORE_EMULATOR_HOST: undefined }, { FIREBASE_AUTH_EMULATOR_HOST: '0.0.0.0:19099' },
    { FIRESTORE_EMULATOR_HOST: 'example.com:18080' }, { FIRESTORE_EMULATOR_HOST: 'http://127.0.0.1:18080' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'do-not-read.json' }, { FIREBASE_CONFIG: '{}' },
    { FIREBASE_TOKEN: 'synthetic' }, { GOOGLE_OAUTH_ACCESS_TOKEN: 'synthetic' },
    { FIREBASE_CONFIG: '/do-not-read.json' }, { FIREBASE_CONFIG: '{"projectId":"optolocum-f314e"}' },
  ]) assert.throws(() => assertEmulatorEnvironment({ ...safe, ...patch }));
});
