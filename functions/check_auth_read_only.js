"use strict";
// One scoped Auth read only. No server, Firestore, inventory or mutation imports.
const fs = require('node:fs');
const PROJECT = 'optolocum-f314e';
function stop(code) { throw Object.assign(new Error('Read-only check stopped.'), { safeCode: code }); }
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== PROJECT) stop('exact-project-confirmation-required');
  if (Object.entries(process.env).some(([key, value]) => value &&
      (key.includes('EMULATOR') || key.startsWith('CLOUDSDK_API_ENDPOINT_OVERRIDES_')))) stop('remove-emulator-or-endpoint-overrides');
  if (['DEBUG', 'NODE_DEBUG', 'GRPC_TRACE', 'GOOGLE_SDK_NODE_LOGGING'].some(key => process.env[key])) stop('remove-diagnostic-logging-settings');
  if (['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'].some(key => process.env[key] && process.env[key] !== PROJECT)) stop('environment-project-mismatch');
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file) stop('credential-environment-variable-missing');
  let credential;
  try { credential = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { stop('credential-file-unreadable-or-invalid'); }
  if (credential?.type !== 'service_account') stop('service-account-credential-required');
  if (credential.project_id !== PROJECT) stop('credential-project-mismatch');
  if (typeof credential.client_email !== 'string' || !credential.client_email ||
      typeof credential.private_key !== 'string' || !credential.private_key) stop('credential-fields-missing');
  try { require('node:crypto').createPrivateKey(credential.private_key); }
  catch { stop('credential-private-key-invalid'); }
  // No Firebase call occurs before all local validation above succeeds.
  const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const app = initializeApp({ projectId: PROJECT, credential: cert(credential) }, 'scoped-read-only-check');
  try {
    const page = await getAuth(app).listUsers(1); // Exactly one page, never follow pageToken.
    console.log(JSON.stringify({ status: 'success', projectId: PROJECT, credentialProjectValidated: true,
      authenticationReadAuthorized: true, accountsSampled: page.users.length,
      sampledAccountState: page.users.length ? (page.users[0].disabled ? 'disabled' : 'enabled') : 'no-accounts-returned',
      scope: 'listUsers(1); not an inventory or mutation-permission test', mutationsEnabled: false }));
  } finally { await deleteApp(app).catch(() => {}); }
}
main().catch(error => {
  const allowedSdkCodes = new Set(['auth/insufficient-permission', 'auth/invalid-credential', 'app/invalid-credential', 'auth/project-not-found', 'auth/configuration-not-found']);
  const code = error.safeCode || (allowedSdkCodes.has(error.code) ? error.code : 'credential-or-network-or-authorization-check-failed');
  console.error(JSON.stringify({ status: 'stopped', projectId: PROJECT, code, mutationsEnabled: false }));
  process.exitCode = 1;
});
