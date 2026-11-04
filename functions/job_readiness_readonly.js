'use strict';
// Read-only readiness checks. Never prints tokens, principals, job IDs or data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PROJECT = 'optolocum-f314e';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function main() {
  if (process.env.DEBUG || process.env.NODE_DEBUG || process.env.GRPC_TRACE || process.env.GOOGLE_SDK_NODE_LOGGING) {
    throw new Error('Remove diagnostic logging before running this check.');
  }
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth'));
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error('Firebase CLI login unavailable.');
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const get = async url => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Rules read returned HTTP ${response.status}.`);
    return response.json();
  };
  const release = await get(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`);
  if (!release.rulesetName?.startsWith(`projects/${PROJECT}/rulesets/`)) throw new Error('Unexpected ruleset project.');
  const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  const local = fs.readFileSync(path.join(__dirname, 'emulator/access/job-soft-delete.rules'), 'utf8');
  const files = ruleset.source?.files ?? [];
  console.log(JSON.stringify({ deployedRules: { fileCount: files.length, exactMatch: files.length === 1 && files[0].content === local, approvedSha256: digest(local), releaseUpdatedAt: release.updateTime } }));
  const credentialFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.env.APPDATA, 'gcloud/application_default_credentials.json');
  if (!fs.existsSync(credentialFile)) {
    console.log(JSON.stringify({ backendCredential: 'unavailable in this terminal', firestoreRead: 'not verified', firestoreUpdatePermission: 'not verified' }));
    return;
  }
  require('./demo_config').assertLocalServerEnvironment();
  const { GoogleAuth } = require('google-auth-library');
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId: PROJECT }).getClient();
  try {
    const result = await client.request({ url: `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/job_postings?pageSize=1&mask.fieldPaths=status`, method: 'GET', timeout: 30000 });
    console.log(JSON.stringify({ firestoreRead: 'passed', sampleDocumentExists: (result.data.documents ?? []).length > 0 }));
  } catch { console.log(JSON.stringify({ firestoreRead: 'failed; details suppressed' })); }
  try {
    const permissions = ['datastore.entities.get', 'datastore.entities.list', 'datastore.entities.update'];
    const result = await client.request({ url: `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`, method: 'POST', data: { permissions }, timeout: 30000 });
    console.log(JSON.stringify({ backendPermissions: Object.fromEntries(permissions.map(permission => [permission, (result.data.permissions ?? []).includes(permission)])), note: 'Read-only IAM check; not proof of a successful future transaction.' }));
  } catch { console.log(JSON.stringify({ backendPermissions: 'not verified; IAM query unavailable' })); }
}
main().catch(() => { console.error('Read-only readiness check failed; private error details suppressed.'); process.exitCode = 1; });
