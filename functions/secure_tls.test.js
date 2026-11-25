'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { parseHttpsConfig, loadTls } = require('./secure_tls');
const { createLocalApp } = require('./local_app');
const base = { OPT_HTTPS_BIND: '127.0.0.1', OPT_HTTPS_HOST: 'localhost', OPT_TLS_ROOT: path.resolve('private'), OPT_TLS_PFX: 'server.pfx', OPT_TLS_PASSPHRASE: 'synthetic-password', OPT_HTTPS_ALLOW_NATIVE: 'false', OPT_HTTPS_ORIGINS: 'http://localhost:5174,http://localhost:5175' };
test('HTTPS configuration rejects wildcards, untrusted binds and invalid origin policies', () => {
  assert.deepEqual(parseHttpsConfig(base).hosts, ['localhost:8787']);
  for (const bad of [{ OPT_TLS_PFX: '' }, { OPT_TLS_PASSPHRASE: '' }, { OPT_HTTPS_BIND: '0.0.0.0' },
    { OPT_HTTPS_BIND: '8.8.8.8', OPT_HTTPS_HOST: '8.8.8.8' }, { OPT_HTTPS_HOST: 'other' },
    { OPT_HTTPS_ORIGINS: '*' }, { OPT_HTTPS_ORIGINS: 'https://attacker.invalid:443' }, { OPT_HTTPS_ALLOW_NATIVE: '' }]) assert.throws(() => parseHttpsConfig({ ...base, ...bad }));
  const lan = { ...base, OPT_HTTPS_BIND: '192.168.1.20', OPT_HTTPS_HOST: '192.168.1.20' };
  assert.throws(() => parseHttpsConfig(lan, {}));
  assert.equal(parseHttpsConfig(lan, { lan: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] }).bind, '192.168.1.20');
});
test('HTTPS listener validates TLS, origin, authorization and mutation gates', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opt-tls-test-'));
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-(?:\d+-)+\d+/)[0];
    execFileSync('icacls.exe', [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`]);
  } else await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
  const key = path.join(root, 'key.pem'), cert = path.join(root, 'cert.pem'), pfx = path.join(root, 'server.pfx');
  const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore', env });
  execFileSync(openssl, ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', pfx, '-passout', 'pass:synthetic-password'], { stdio: 'ignore', env });
  execFileSync(openssl, ['pkcs12', '-export', '-nokeys', '-in', cert, '-out', path.join(root, 'no-key.pfx'), '-passout', 'pass:synthetic-password'], { stdio: 'ignore', env });
  const config = parseHttpsConfig({ ...base, OPT_TLS_ROOT: root });
  await assert.rejects(loadTls({ ...config, file: 'missing.pfx' }));
  await assert.rejects(loadTls({ ...config, passphrase: 'incorrect-password' }));
  await assert.rejects(loadTls({ ...config, host: '192.168.1.20' }));
  await assert.rejects(loadTls({ ...config, file: 'no-key.pfx' }));
  const options = await loadTls(config);
  let tokenChecks = 0, disabled = false, accessState = 'active';
  const auth = { verifyIdToken: async (_, revoked) => { tokenChecks++; assert.equal(revoked, true); return { uid: 'admin', admin: true, auth_time: 20 }; },
    getUser: async () => ({ disabled, customClaims: { admin: true } }) };
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ state: accessState, validAfter: 10 }) }) }) }) };
  const verificationManager = { listPendingVerificationSubmissions: async () => ({ items: [] }) };
  const app = createLocalApp({ auth, db, verificationManager, realPreparationOnly: true, transport: config, demoPolicy: { accountMutationsEnabled: true, jobSoftDeleteEnabled: true } });
  const server = https.createServer(options, app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const ca = await fs.readFile(cert);
  const request = (route, origin, authorization) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: server.address().port, servername: 'localhost', ca, path: route, method: 'POST',
      headers: { host: 'localhost:8787', ...(origin ? { origin } : {}), ...(authorization ? { authorization } : {}), 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(await request('/api/verification/queue', 'http://evil.invalid:5174', 'Bearer test'), 403);
  assert.equal(await request('/api/verification/queue', undefined, 'Bearer test'), 403);
  assert.equal(await request('/api/verification/queue', 'http://localhost:5174'), 401);
  assert.equal(await request('/api/verification/queue', 'http://localhost:5174', 'Bearer test'), 200);
  disabled = true;
  assert.equal(await request('/api/verification/queue', 'http://localhost:5174', 'Bearer test'), 403);
  disabled = false; accessState = 'disabled';
  assert.equal(await request('/api/verification/queue', 'http://localhost:5174', 'Bearer test'), 403);
  accessState = 'active';
  assert.equal(await request('/api/verification/review', 'http://localhost:5175', 'Bearer test'), 503);
  assert.equal(await request('/api/enrollment', 'http://localhost:5174', 'Bearer test'), 404);
  assert.equal(tokenChecks, 3);
  await assert.rejects(new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: server.address().port, servername: 'localhost', path: '/health' }, resolve);
    req.on('error', reject);
  }));
  const nativeApp = createLocalApp({ auth, db, verificationManager, realPreparationOnly: true, transport: { ...config, allowNative: true } });
  const nativeServer = https.createServer(options, nativeApp);
  await new Promise(resolve => nativeServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => nativeServer.close(resolve)));
  const nativeStatus = await new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: nativeServer.address().port, servername: 'localhost', ca, path: '/api/verification/queue', method: 'POST',
      headers: { host: 'localhost:8787', authorization: 'Bearer test', 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(nativeStatus, 200);
});
