'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createLocalDocumentStore, MAX_BYTES } = require('./local_document_store');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opt-doc-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-(?:\d+-)+\d+/)[0];
    execFileSync('icacls.exe', [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { encoding: 'utf8' });
  } else await fs.chmod(root, 0o700);
  return { root, store: await createLocalDocumentStore({ root }) };
}
const upload = (store, bytes, options = {}) => store.put({ uid: 'synthetic-user', submissionId: 'a'.repeat(40), name: 'file.pdf', contentType: 'application/pdf', stream: Readable.from([bytes]), ...options });
test('validates PDF, PNG, JPEG, hashes, immutable retries and reconciliation', async t => {
  const { root, store } = await fixture(t);
  const data = Buffer.from('%PDF-synthetic');
  const doc = await upload(store, data);
  assert.equal(doc.sha256, createHash('sha256').update(data).digest('hex'));
  assert.deepEqual(await upload(store, data), doc);
  await assert.rejects(upload(store, Buffer.from('%PDF-different')));
  const chunks = []; for await (const c of (await store.verify(doc)).createReadStream()) chunks.push(c);
  assert.deepEqual(Buffer.concat(chunks), data);
  for (const [type, name, content, id] of [['image/png', 'a.png', Buffer.from([137,80,78,71,13,10,26,10]), 'b'], ['image/jpeg', 'a.jpg', Buffer.from([255,216,255,1]), 'c']]) {
    const item = await upload(store, content, { submissionId: id.repeat(40), name, contentType: type });
    await store.verify(item);
  }
  const report = await store.reconcile([doc, { ...doc, path: `verification_documents/synthetic-user/${'d'.repeat(40)}/document` }]);
  assert.equal(report.orphaned.length, 2); assert.equal(report.missing.length, 1); assert.equal(report.invalid.length, 0); assert.equal(report.temporary.length, 0);
  assert.equal((await fs.readdir(root)).filter(n => /^[a-f0-9]{64}$/.test(n)).length, 3);
});
test('rejects traversal, invalid types, oversized and missing documents; cleans temporary files', async t => {
  const { root, store } = await fixture(t);
  await assert.rejects(upload(store, Buffer.from('%PDF-x'), { uid: '../x' }));
  await assert.rejects(upload(store, Buffer.from('invalid')));
  await assert.rejects(upload(store, Buffer.from('%PDF-x'), { name: '../x.pdf' }));
  await assert.rejects(upload(store, Buffer.alloc(MAX_BYTES + 1)));
  await assert.rejects(store.verify({ path: `verification_documents/synthetic-user/${'a'.repeat(40)}/document`, name: 'file.pdf', contentType: 'application/pdf', size: 5, sha256: '0'.repeat(64) }));
  assert.deepEqual((await fs.readdir(root)).filter(n => n.startsWith('.upload-')), []);
});
test('rejects repository root and concurrent conflicting writes', async t => {
  await assert.rejects(createLocalDocumentStore({ root: path.resolve(__dirname) }));
  const { store } = await fixture(t);
  const results = await Promise.allSettled([upload(store, Buffer.from('%PDF-one')), upload(store, Buffer.from('%PDF-two'))]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
});
test('detects file tampering and refuses unsafe Windows ACLs', async t => {
  const { root, store } = await fixture(t);
  const doc = await upload(store, Buffer.from('%PDF-original'));
  const id = (await fs.readdir(root)).find(n => /^[a-f0-9]{64}$/.test(n));
  await fs.writeFile(path.join(root, id), Buffer.from('%PDF-modified'));
  await assert.rejects(store.verify(doc));
  assert.deepEqual((await store.reconcile([doc])).invalid, [doc.path]);
  if (process.platform === 'win32') {
    execFileSync('icacls.exe', [root, '/grant', '*S-1-1-0:(OI)(CI)R'], { encoding: 'utf8' });
    await assert.rejects(createLocalDocumentStore({ root }), /ACL/);
  }
});
