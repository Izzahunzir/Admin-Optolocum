'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createLocalApp } = require('./local_app');
test('real preparation rejects insecure transport before reaching any endpoint', async t => {
  let calls = 0;
  const auth = { verifyIdToken: async () => { calls++; throw Error('must not reach Auth'); } };
  const app = createLocalApp({ auth, db: {}, realPreparationOnly: true,
    demoPolicy: { accountMutationsEnabled: true, jobSoftDeleteEnabled: true } });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  for (const path of ['/api/accounts/manage', '/api/jobs/soft-delete', '/api/verification/review', '/api/enrollment', '/api/applicant/draft']) {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method: 'POST',
        headers: { host: '127.0.0.1:8787', origin: 'http://localhost:5174', 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(status, 403, `${path}: ${status}`);
  }
  assert.equal(calls, 0);
});
