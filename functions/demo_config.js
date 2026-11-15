"use strict";
const fs = require('node:fs');
const path = require('node:path');
const PROJECT = 'optolocum-f314e';
const CONFIG_PATH = path.join(__dirname, '.demo-local.json');
const KEYS = new Set(['projectId', 'enableAccountMutations', 'enableJobSoftDelete']);

function parseDemoConfig(value) {
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !KEYS.has(key)) ||
      value.projectId !== PROJECT ||
      ('enableAccountMutations' in value && typeof value.enableAccountMutations !== 'boolean') ||
      ('enableJobSoftDelete' in value && typeof value.enableJobSoftDelete !== 'boolean')) {
    throw new Error('Invalid local demo configuration. Use the exact project and independent boolean mutation gates.');
  }
  const accountMutationsEnabled = value.enableAccountMutations === true;
  const jobSoftDeleteEnabled = value.enableJobSoftDelete === true;
  return Object.freeze({
    accountMutationsEnabled,
    jobSoftDeleteEnabled,
  });
}

function loadDemoConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return parseDemoConfig({ projectId: PROJECT });
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
