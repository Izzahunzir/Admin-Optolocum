"use strict";
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const { PROJECT, AUTH_HOST, FIRESTORE_HOST, assertEmulatorEnvironment } = require('./safety');
const mode = process.argv[2];
if (!['start', 'test', 'rules'].includes(mode)) throw new Error('Use launch.js start, test or rules.');
// Never inherit a production project or a credential file into child processes.
const env = { ...process.env, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT, GCP_PROJECT: PROJECT,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST, FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST,
  XDG_CONFIG_HOME: path.join(__dirname, '.runtime', 'config'),
  FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', CI: 'true' };
assertEmulatorEnvironment(env);
delete env.DEBUG; // Avoid CLI debug dumps of inherited environment variables.
const args = [mode !== 'start' ? 'emulators:exec' : 'emulators:start', '--only', 'auth,firestore', '--project', PROJECT,
  '--config', path.join(__dirname, 'firebase.json')];
if (mode === 'test') args.push('node --test emulator/integration.test.js');
if (mode === 'rules') args.push('node --test emulator/access/rules.test.js');
// Invoke the CLI JS directly: preserve the test command as one argument without a shell.
const shim = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which',
  [process.platform === 'win32' ? 'firebase.cmd' : 'firebase'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
const cli = process.platform === 'win32'
  ? path.join(path.dirname(shim), 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')
  : require('node:fs').realpathSync(shim);
const child = spawn(process.execPath, [cli, ...args], {
  cwd: path.dirname(__dirname), env, stdio: 'inherit', windowsHide: true,
});
child.on('error', () => { console.error('Firebase CLI could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
