'use strict';
// Real verification writes require an explicit operator-selected mode.
const { validateRealEnvironment } = require('./real_config');
async function main() {
  try {
    const config = validateRealEnvironment();
    const { PORT, parseHttpsConfig, loadTls } = require('./secure_tls');
    const transport = parseHttpsConfig();
    const tlsOptions = await loadTls(transport);
    const { createLocalDocumentStore } = require('./local_document_store');
    const documentStore = await createLocalDocumentStore({ root: config.root });
    const { initializeApp, applicationDefault } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { getFirestore } = require('firebase-admin/firestore');
    const { createLocalApp } = require('./local_app');
    const firebase = initializeApp({ projectId: config.projectId, credential: applicationDefault() });
    const app = createLocalApp({ auth: getAuth(firebase), db: getFirestore(firebase), documentStore,
      realPreparationOnly: true, realVerificationEnabled: config.verificationEnabled, transport, demoPolicy: Object.freeze({ accountMutationsEnabled: false, jobSoftDeleteEnabled: false }) });
    const server = require('node:https').createServer(tlsOptions, app);
    server.listen(PORT, transport.bind, () => console.log(`Real Firebase ${config.verificationEnabled ? 'verification active' : 'preparation read-only'} HTTPS: ${transport.bind}:${PORT}`));
    server.requestTimeout = 30000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
    server.on('error', () => { console.error('Preparation server failed.'); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  } catch (_) {
    console.error('Preparation server refused to start: check explicit project, credentials, emulator overrides and private storage.');
    process.exitCode = 1;
  }
}
main();
