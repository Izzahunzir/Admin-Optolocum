"use strict";
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createLocalApp, HOST, PORT } = require('./local_app');

// Never let emulator configuration weaken token verification for this live project.
if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Remove Firebase emulator environment variables before starting the live-project local server.');
  process.exitCode = 1;
} else {
  initializeApp({ credential: applicationDefault(), projectId: 'optolocum-f314e' });
  const app = createLocalApp({ auth: getAuth(), db: getFirestore() });
  const server = app.listen(PORT, HOST, () => console.log(`Read-only account API: http://${HOST}:${PORT} (allowed origin: http://localhost:5173)`));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('error', () => { console.error('Unable to start local server. Check that 127.0.0.1:8787 is available.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
