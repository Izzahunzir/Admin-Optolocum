"use strict";
const express = require('express');
const { manageAccount, ManagementError } = require('./management');

const HOST = '127.0.0.1';
const PORT = 8787;
const ORIGIN = 'http://localhost:5173';
const API_PATH = '/api/accounts/manage';

function createSerialExecutor() {
  let tail = Promise.resolve();
  let pending = 0;
  return task => {
    if (pending >= 32) return Promise.reject(Object.assign(new Error('Busy'), { code: 'resource-exhausted' }));
    pending++;
    const next = tail.then(task);
    tail = next.catch(() => {});
    return next.finally(() => { pending--; });
  };
}

function createLocalApp({ auth, db, manager = manageAccount }) {
  const app = express();
  const serialized = createSerialExecutor();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const reject = (res, status, code, message) => res.status(status).json({ error: { code, message } });
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const headerCount = key => req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === key).length;
    if (headerCount('host') !== 1 || req.headers.host !== `${HOST}:${PORT}`) return reject(res, 403, 'permission-denied', 'Invalid Host.');
    if (headerCount('authorization') > 1) return reject(res, 400, 'invalid-argument', 'Duplicate Authorization headers.');
    const origin = req.headers.origin;
    if (headerCount('origin') > 1 || (origin !== undefined && origin !== ORIGIN)) return reject(res, 403, 'permission-denied', 'Origin not allowed.');
    if (origin === ORIGIN) { res.set('Access-Control-Allow-Origin', ORIGIN); res.vary('Origin'); }
    if (req.method === 'GET' && req.path === '/health') return next();
    if (origin !== ORIGIN) return reject(res, 403, 'permission-denied', 'An approved browser origin is required.');
    if (req.method === 'OPTIONS') {
      const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      if (req.path !== API_PATH || req.headers['access-control-request-method'] !== 'POST' || headers.some(x => !['authorization', 'content-type'].includes(x))) return reject(res, 403, 'permission-denied', 'Preflight not allowed.');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return res.sendStatus(204);
    }
    next();
  });
  // Liveness only: this exposes no Firebase credentials, identities or account data.
  app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'read-only', mutationsEnabled: false }));
  app.post(API_PATH, (req, res, next) => {
    if (Object.keys(req.query).length) return reject(res, 400, 'invalid-argument', 'Query parameters are not allowed.');
    if (!req.is('application/json')) return reject(res, 415, 'invalid-argument', 'Content-Type must be application/json.');
    next();
  }, express.json({ limit: '4kb', strict: true }), async (req, res) => {
    try {
      const bearer = req.headers.authorization;
      if (typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) return reject(res, 401, 'unauthenticated', 'A Firebase ID token is required.');
      const actor = await auth.verifyIdToken(bearer.slice(7), true);
      if (actor.admin !== true) return reject(res, 403, 'permission-denied', 'Administrator access required.');
      const current = await auth.getUser(actor.uid);
      if (current.disabled || current.customClaims?.admin !== true) return reject(res, 403, 'permission-denied', 'Administrator authorization is no longer valid.');
      const data = req.body;
      const fields = new Set(['uid', 'kind', 'action', 'disabled', 'expectedDisabled', 'confirmUid']);
      if (!data || Array.isArray(data) || Object.keys(data).some(key => !fields.has(key)) ||
          typeof data.uid !== 'string' || !data.uid || data.uid.length > 128 || data.uid.includes('/') ||
          !['locum', 'practice_owner'].includes(data.kind) || !['status', 'setDisabled', 'delete'].includes(data.action) ||
          ('disabled' in data && typeof data.disabled !== 'boolean') ||
          ('expectedDisabled' in data && typeof data.expectedDisabled !== 'boolean') ||
          ('confirmUid' in data && typeof data.confirmUid !== 'string')) return reject(res, 400, 'invalid-argument', 'Invalid account request.');
      // Hard-coded Phase 1 gate: no environment flag can activate mutations.
      if (data.action !== 'status') return reject(res, 403, 'failed-precondition', 'Account changes are disabled in Phase 1 pending security and Firestore session-access verification.');
      if (Object.keys(data).some(key => !['uid', 'kind', 'action'].includes(key))) return reject(res, 400, 'invalid-argument', 'Unexpected status request fields.');
      const result = await serialized(() => manager({ auth, db, actor, data }));
      return res.json({ data: { disabled: result.disabled, mutationsEnabled: false } });
    } catch (error) {
      if (error instanceof ManagementError) {
        const status = { 'permission-denied': 403, 'unauthenticated': 401, 'not-found': 404, 'invalid-argument': 400 }[error.code] || 409;
        return reject(res, status, error.code, error.message);
      }
      if (['auth/id-token-revoked', 'auth/id-token-expired', 'auth/invalid-id-token', 'auth/argument-error', 'auth/user-disabled'].includes(error.code)) return reject(res, 401, 'unauthenticated', 'Please sign in again.');
      if (error.code === 'auth/user-not-found') return reject(res, 404, 'not-found', 'Authentication account not found.');
      if (['auth/insufficient-permission', 'permission-denied', 7].includes(error.code)) return reject(res, 403, 'permission-denied', 'The local server identity lacks required Firebase Authentication or Firestore read permissions.');
      if (error.code === 'resource-exhausted') return reject(res, 429, error.code, 'Server busy. Please retry.');
      return reject(res, 503, 'unavailable', 'Unable to verify Firebase account status. Check the local server credentials and connection.');
    }
  });
  app.use((req, res) => reject(res, 404, 'not-found', 'Endpoint not found.'));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return reject(res, 413, 'invalid-argument', 'Request too large.');
    if (error.type === 'entity.parse.failed') return reject(res, 400, 'invalid-argument', 'Invalid JSON.');
    return reject(res, 500, 'internal', 'Local request failed.');
  });
  return app;
}
module.exports = { createLocalApp, createSerialExecutor, HOST, PORT, ORIGIN, API_PATH };
