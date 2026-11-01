"use strict";
const PROJECT = 'demo-optolocum-account-management';
const AUTH_HOST = '127.0.0.1:19099';
const FIRESTORE_HOST = '127.0.0.1:18080';
function assertEmulatorEnvironment(env = process.env) {
  if (env.GCLOUD_PROJECT !== PROJECT || env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_HOST || env.FIRESTORE_EMULATOR_HOST !== FIRESTORE_HOST) {
    throw new Error('Exact demo project and loopback Auth/Firestore emulator hosts are required.');
  }
  for (const key of ['GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) {
    if (env[key] && env[key] !== PROJECT) throw new Error('Conflicting project configuration.');
  }
  if (env.FIREBASE_CONFIG) {
    let config;
    try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error('Only inline demo FIREBASE_CONFIG is permitted.'); }
    if (!config || config.projectId !== PROJECT || Object.keys(config).some(key => !['projectId', 'storageBucket', 'databaseURL'].includes(key)) ||
        (config.storageBucket && config.storageBucket !== `${PROJECT}.appspot.com`) ||
        (config.databaseURL && config.databaseURL !== `https://${PROJECT}.firebaseio.com`)) throw new Error('Conflicting Firebase configuration.');
  }
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'FIREBASE_AUTH_EMULATOR_HOST_OVERRIDE']) {
    if (env[key]) throw new Error(`Remove ${key} before emulator testing.`);
  }
}
function createEmulatorServices() {
  assertEmulatorEnvironment(); // Before importing SDKs or creating any clients.
  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { Firestore } = require('firebase-admin/firestore');
  const { OAuth2Client } = require('google-auth-library');
  const app = initializeApp({ projectId: PROJECT, credential: {
    // Explicit synthetic credential: never call applicationDefault or read a key.
    getAccessToken: async () => { assertEmulatorEnvironment(); return { access_token: 'owner', expires_in: 3600 }; },
  } }, `isolated-emulator-${require('node:crypto').randomUUID()}`);
  const auth = getAuth(app);
  // Admin getFirestore(app) rejects custom credentials. Construct its exported
  // Firestore client explicitly, with an in-memory OAuth client that never uses ADC.
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 86400000 });
  const db = new Firestore({ projectId: PROJECT, host: FIRESTORE_HOST, ssl: false, authClient });
  return { app, auth, db };
}
module.exports = { PROJECT, AUTH_HOST, FIRESTORE_HOST, assertEmulatorEnvironment, createEmulatorServices };
