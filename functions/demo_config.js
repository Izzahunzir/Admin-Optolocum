"use strict";
const fs = require('node:fs');
const path = require('node:path');
const PROJECT = 'optolocum-f314e';
const CONFIG_PATH = path.join(__dirname, '.demo-local.json');
function parseDemoConfig(value) {
  if (!value || Array.isArray(value) || !['approvedTestUids,enableMutations,projectId', 'approvedTestUids,enableMutations,locumTestUid,projectId'].includes(Object.keys(value).sort().join(',')) ||
      value.projectId !== PROJECT || typeof value.enableMutations !== 'boolean' || !Array.isArray(value.approvedTestUids) ||
      value.approvedTestUids.length > 20 || value.approvedTestUids.some(uid => typeof uid !== 'string' ||
        !/^[^/\s\x00-\x1f\x7f]{1,128}$/.test(uid) || ['.', '..', '*'].includes(uid)) ||
      new Set(value.approvedTestUids).size !== value.approvedTestUids.length ||
      ('locumTestUid' in value && !value.approvedTestUids.includes(value.locumTestUid)) ||
      (value.enableMutations && !value.approvedTestUids.includes(value.locumTestUid)))
    throw new Error('Invalid demo configuration. Exact project, boolean gate, unique test UIDs and an approved locumTestUid before enabling are required.');
  const approved = new Set(value.approvedTestUids);
  const enabled = value.enableMutations, selectedLocumUid = value.locumTestUid;
  const allows = uid => enabled && uid === selectedLocumUid && approved.has(uid);
  return Object.freeze({ enabled, allows,
    allowsOperation: (uid, kind, action) => allows(uid) && kind === 'locum' && action === 'setDisabled' });
}
function loadDemoConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return parseDemoConfig({ projectId: PROJECT, enableMutations: false, approvedTestUids: [] });
  try { return parseDemoConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
  catch { throw new Error('Invalid local demo configuration; server not started.'); }
}
function assertLocalServerEnvironment(env = process.env, isFile = file => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}) {
  if (Object.entries(env).some(([key, value]) => value && (key.includes('EMULATOR') || key.startsWith('CLOUDSDK_API_ENDPOINT_OVERRIDES_'))))
    throw new Error('Remove emulator/endpoint overrides before starting the local Firebase server.');
  if (['DEBUG', 'NODE_DEBUG', 'GRPC_TRACE', 'GOOGLE_SDK_NODE_LOGGING'].some(key => env[key]))
    throw new Error('Remove diagnostic logging settings before starting the local Firebase server.');
  if (['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'].some(key => env[key] && env[key] !== PROJECT))
    throw new Error('Conflicting Firebase project configuration.');
  const file = env.GOOGLE_APPLICATION_CREDENTIALS || (env.APPDATA && path.join(env.APPDATA, 'gcloud', 'application_default_credentials.json'));
  if (!file || !isFile(file)) throw new Error('Local ADC credential file is unavailable. Configure an existing approved server credential in this terminal; no Firebase request was made.');
  // Presence only, not proof of project authorization or credential validity.
}
module.exports = { PROJECT, CONFIG_PATH, parseDemoConfig, loadDemoConfig, assertLocalServerEnvironment };
