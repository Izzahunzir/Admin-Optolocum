"use strict";
const { assertEmulatorEnvironment, createEmulatorServices, PROJECT } = require('./safety');
const { manageAccount, ManagementError } = require('../management');
const { provisionAccount } = require('./provisioning');
const { createSerialExecutor } = require('../local_app');
const PORT = 18787;
const ORIGIN = 'http://localhost:5173';
function createEmulatorApp({ auth, db, clock = Date.now }) {
  assertEmulatorEnvironment();
  const express = require('express');
  const app = express();
  const serial = createSerialExecutor();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const reject = (res, status, code, message) => res.status(status).json({ error: { code, message } });
  app.use((req, res, next) => {
    assertEmulatorEnvironment();
    res.set('Cache-Control', 'no-store');
    const count = key => req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === key).length;
    if (count('host') !== 1 || req.headers.host !== `127.0.0.1:${PORT}` || count('authorization') > 1 || count('origin') > 1) return reject(res, 403, 'permission-denied', 'Invalid headers.');
    if (req.headers.origin !== undefined && req.headers.origin !== ORIGIN) return reject(res, 403, 'permission-denied', 'Invalid origin.');
    if (req.method === 'GET' && req.path === '/health') return res.json({ mode: 'emulator-only', projectId: PROJECT });
    if (req.headers.origin !== ORIGIN) return reject(res, 403, 'permission-denied', 'Approved origin required.');
    res.set('Access-Control-Allow-Origin', ORIGIN);
    res.vary('Origin');
    if (req.method === 'OPTIONS' && ['/api/accounts/manage', '/api/accounts/provision'].includes(req.path)) {
      const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      if (req.headers['access-control-request-method'] !== 'POST' || headers.some(x => !['authorization', 'content-type'].includes(x))) return reject(res, 403, 'permission-denied', 'Invalid preflight.');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return res.sendStatus(204);
    }
    next();
  });
  app.post(['/api/accounts/manage', '/api/accounts/provision'], express.json({ limit: '4kb', strict: true }), async (req, res) => {
    try {
      if (!req.is('application/json') || Object.keys(req.query).length || !req.body || Array.isArray(req.body)) return reject(res, 400, 'invalid-argument', 'Invalid request.');
      const bearer = req.headers.authorization;
      if (typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) return reject(res, 401, 'unauthenticated', 'Emulator token required.');
      const actor = await auth.verifyIdToken(bearer.slice(7), true);
      const handler = req.path === '/api/accounts/provision' ? provisionAccount : manageAccount;
      const data = await serial(() => handler({ auth, db, actor, data: req.body, now: clock() }));
      return res.json({ data });
    } catch (error) {
      if (error instanceof ManagementError) return reject(res, { 'permission-denied': 403, 'unauthenticated': 401, 'invalid-argument': 400, 'not-found': 404 }[error.code] || 409, error.code, error.message);
      if (error.code?.startsWith('auth/')) return reject(res, 401, 'unauthenticated', 'Invalid emulator session.');
      return reject(res, 503, 'unavailable', 'Emulator action could not be confirmed.');
    }
  });
  app.use((req, res) => reject(res, 404, 'not-found', 'Endpoint not found.'));
  app.use((error, req, res, next) => reject(res, 400, 'invalid-argument', 'Invalid request body.'));
  return app;
}
if (require.main === module) {
  try {
    const services = createEmulatorServices();
    const server = createEmulatorApp(services).listen(PORT, '127.0.0.1', () => console.log(`EMULATOR ONLY: http://127.0.0.1:${PORT}; ${PROJECT}`));
    server.on('error', () => { console.error('Emulator HTTP server failed to start.'); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createEmulatorApp, PORT };
