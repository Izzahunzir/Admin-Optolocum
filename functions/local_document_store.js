'use strict';
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const { createHash, createHmac, randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const types = { 'application/pdf': /\.pdf$/i, 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i };
function fail(message) { throw Object.assign(new Error(message), { code: 'failed-precondition' }); }
function logical(uid, id) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.trim() !== uid || /[\\/]/.test(uid) || !/^[a-f0-9]{40}$/.test(id || '')) fail('Invalid document identity.');
  return `verification_documents/${uid}/${id}/document`;
}
function validDocument(doc) {
  const m = /^verification_documents\/([^/]+)\/([a-f0-9]{40})\/document$/.exec(doc?.path || '');
  if (!m || logical(m[1], m[2]) !== doc.path || typeof doc.name !== 'string' || !doc.name || doc.name.length > 255 || /[\\/]/.test(doc.name) || !types[doc.contentType]?.test(doc.name) || !Number.isSafeInteger(doc.size) || doc.size < 1 || doc.size > MAX_BYTES || !/^[a-f0-9]{64}$/.test(doc.sha256 || '')) fail('Invalid document metadata.');
}
function fileType(bytes) {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return null;
}
async function validateRoot(root, forbiddenRoots) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('Private storage root must be absolute.');
  root = path.resolve(root);
  for (const forbidden of forbiddenRoots) {
    const relative = path.relative(path.resolve(forbidden), root);
    if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) fail('Private storage must be outside the repository and web roots.');
  }
  let part = path.parse(root).root;
  for (const component of root.slice(part.length).split(path.sep).filter(Boolean)) {
    part = path.join(part, component);
    const info = await fs.lstat(part);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('Private storage path contains a link or is not a directory.');
  }
  if (process.platform === 'win32') {
    // Require a protected DACL with no grants except the service user, SYSTEM,
    // and local Administrators. Do not silently change a user's directory ACL.
    const script = "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:OPT_DOCUMENT_ROOT; if (-not $acl.AreAccessRulesProtected) { exit 2 }; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($r in $acl.Access) { if ($r.AccessControlType -eq 'Allow') { $sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if ($sid -notin @($me,'S-1-5-18','S-1-5-32-544')) { exit 3 }; if (($r.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) -eq 0) { exit 5 } } }; if (-not ($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $me -and (($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) })) { exit 4 }";
    try { await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, OPT_DOCUMENT_ROOT: root } }); }
    catch (_) { fail('Private storage Windows ACL is not restricted to the service user, SYSTEM and Administrators.'); }
  } else {
    const info = await fs.stat(root);
    if ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) fail('Private storage must be owned by the service user with mode 0700.');
  }
  return root;
}
async function createLocalDocumentStore({ root, forbiddenRoots = [] }) {
  root = await validateRoot(root, [path.resolve(__dirname, '..', '..'), ...forbiddenRoots]);
  const keyPath = path.join(root, '.store-key');
  const tempKey = path.join(root, `.key-${randomBytes(24).toString('hex')}`);
  await fs.writeFile(tempKey, randomBytes(32), { flag: 'wx', mode: 0o600 });
  try { await fs.link(tempKey, keyPath); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  finally { await fs.unlink(tempKey); }
  const keyInfo = await fs.lstat(keyPath);
  if (!keyInfo.isFile() || keyInfo.isSymbolicLink()) fail('Invalid document store key.');
  const key = await fs.readFile(keyPath);
  if (key.length !== 32) fail('Invalid document store key.');
  const identifier = p => createHmac('sha256', key).update(p).digest('hex');
  async function verify(document) {
    validDocument(document);
    let bytes;
    try {
      const file = path.join(root, identifier(document.path));
      const entry = await fs.lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink()) fail('Invalid private document.');
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size !== document.size || info.size > MAX_BYTES) fail('Invalid private document size.');
        bytes = await handle.readFile();
      } finally { await handle.close(); }
    } catch (error) { if (error.code === 'failed-precondition') throw error; fail('Private document is missing or unreadable.'); }
    if (bytes.length !== document.size || createHash('sha256').update(bytes).digest('hex') !== document.sha256 || fileType(bytes) !== document.contentType) fail('Private document integrity check failed.');
    return { createReadStream: () => Readable.from([bytes]) };
  }
  async function put({ uid, submissionId, name, contentType, stream }) {
    const documentPath = logical(uid, submissionId);
    if (typeof name !== 'string' || !name || name.length > 255 || /[\\/]/.test(name) || !types[contentType]?.test(name) || !stream?.[Symbol.asyncIterator]) fail('Invalid document upload.');
    const temporary = path.join(root, `.upload-${randomBytes(24).toString('hex')}`);
    const handle = await fs.open(temporary, 'wx', 0o600);
    const hash = createHash('sha256'); let size = 0, prefix = Buffer.alloc(0);
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > MAX_BYTES) fail('Document exceeds size limit.');
        if (prefix.length < 8) prefix = Buffer.concat([prefix, bytes.subarray(0, 8 - prefix.length)]);
        hash.update(bytes); await handle.writeFile(bytes);
      }
      if (!size || fileType(prefix) !== contentType) fail('Invalid document signature.');
      await handle.sync(); await handle.close();
      const document = { path: documentPath, name, contentType, size, sha256: hash.digest('hex') };
      try { await fs.link(temporary, path.join(root, identifier(documentPath))); }
      catch (error) { if (error.code !== 'EEXIST') throw error; await verify(document); }
      return document;
    } finally { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
  }
  // Diagnostic only: pass the complete authoritative reference set; never delete.
  async function reconcile(documents) {
    const expected = new Map();
    for (const doc of documents) { validDocument(doc); expected.set(identifier(doc.path), doc); }
    const names = await fs.readdir(root), present = new Set(names.filter(n => /^[a-f0-9]{64}$/.test(n)));
    const missing = [], invalid = [];
    for (const [id, doc] of expected) {
      if (!present.has(id)) missing.push(doc.path);
      else { try { await verify(doc); } catch (_) { invalid.push(doc.path); } }
    }
    return { missing, invalid, orphaned: [...present].filter(id => !expected.has(id)), temporary: names.filter(n => /^\.(?:upload|key)-[a-f0-9]{48}$/.test(n)) };
  }
  return { put, verify, reconcile };
}
module.exports = { createLocalDocumentStore, MAX_BYTES };
