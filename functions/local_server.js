"use strict";
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createLocalDocumentStore } = require('./local_document_store');
const { createLocalApp, HOST, PORT } = require('./local_app');
const { loadDemoConfig, assertLocalServerEnvironment } = require('./demo_config');

// Never let emulator configuration weaken token verification for this live project.
async function main() {
try {
  assertLocalServerEnvironment(); // Offline preflight; never probe metadata for missing local ADC.
  const demoPolicy = loadDemoConfig(); // Missing file = OFF. Invalid file fails before SDK initialization.
  initializeApp({ credential: applicationDefault(), projectId: 'optolocum-f314e' });
  const documentStore = process.env.OPT_DOCUMENT_STORE_ROOT
    ? await createLocalDocumentStore({ root: process.env.OPT_DOCUMENT_STORE_ROOT }) : null;

  const app = createLocalApp({
  auth: getAuth(),
  db: getFirestore(),
  documentStore,
  demoPolicy,
  });
  const enabled = demoPolicy.accountMutationsEnabled || demoPolicy.jobSoftDeleteEnabled;
  const server = app.listen(PORT, HOST, () => console.log(`Local account API (${enabled ? 'supervised-demo' : 'read-only'}): http://${HOST}:${PORT} (allowed origin: http://localhost:5174)`));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('error', (error) => {
  console.error('Local server error:', error.code || 'UNKNOWN');
  console.error(error.message || 'No additional error details.');
  process.exitCode = 1;
});
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
} catch (error) {
  // Only our own preflight messages are safe to display. No SDK error dumps.
  console.error(error.message?.startsWith('Local ADC') || error.message?.startsWith('Remove ') || error.message?.startsWith('Conflicting ') || error.message === 'Invalid local demo configuration; server not started.'
    ? error.message : 'Local server could not start. Check local credentials and configuration.');
  process.exitCode = 1;
}
}
main();
