"use strict";

const { assertEmulatorEnvironment, createEmulatorServices, PROJECT } = require('./safety');
const { createLocalApp, HOST, PORT } = require('../local_app');
const { createLocalDocumentStore } = require('../local_document_store');

async function main() {
try {
  // This separate launcher preserves the 8787 API contract while making it
  // impossible to initialize its Admin clients against production services.
  assertEmulatorEnvironment();
  const { app, auth, db } = createEmulatorServices();
  const documentStore = process.env.OPT_DOCUMENT_STORE_ROOT
    ? await createLocalDocumentStore({ root: process.env.OPT_DOCUMENT_STORE_ROOT }) : null;
  const demoPolicy = Object.freeze({ accountMutationsEnabled: true, jobSoftDeleteEnabled: true });
  const server = createLocalApp({ auth, db, demoPolicy, documentStore, applicantEmulatorOnly: true }).listen(PORT, HOST, () => {
    console.log(`LOCAL EMULATOR API ONLY: http://${HOST}:${PORT}; project ${PROJECT}`);
  });
  server.on('error', async () => {
    console.error('Local emulator API failed to start; verify port 8787 is free.');
    await db.terminate();
    await require('firebase-admin/app').deleteApp(app);
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(async () => {
      await db.terminate();
      await require('firebase-admin/app').deleteApp(app);
      process.exit(0);
    }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
}
main();
