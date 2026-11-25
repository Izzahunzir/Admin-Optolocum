'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { validateRoot } = require('./local_document_store');
const PORT = 8787;
function privateIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const n = ip.split('.').map(Number);
  return n[3] > 0 && n[3] < 255 && (n[0] === 10 || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 168));
}
function parseHttpsConfig(env = process.env, interfaces = os.networkInterfaces()) {
  const bind = env.OPT_HTTPS_BIND, host = env.OPT_HTTPS_HOST;
  if (!bind || !host || (bind === '127.0.0.1' ? host !== 'localhost' : (!privateIPv4(bind) || host !== bind))) throw new Error('Choose loopback localhost or one private LAN IPv4 address.');
  if (bind !== '127.0.0.1' && !Object.values(interfaces).flat().some(i => i && i.family === 'IPv4' && i.address === bind && !i.internal)) throw new Error('LAN bind address must belong to this laptop.');
  if (!env.OPT_TLS_ROOT || !path.isAbsolute(env.OPT_TLS_ROOT) || !/^[a-zA-Z0-9_-]+\.pfx$/.test(env.OPT_TLS_PFX || '') || typeof env.OPT_TLS_PASSPHRASE !== 'string' || env.OPT_TLS_PASSPHRASE.length < 12) throw new Error('Private TLS PFX and passphrase are required.');
  if (!['true', 'false'].includes(env.OPT_HTTPS_ALLOW_NATIVE)) throw new Error('Explicit native-client policy required.');
  const origins = (env.OPT_HTTPS_ORIGINS || '').split(',');
  if (!origins.length || origins.length > 4 || origins.some(origin => {
    try { const u = new URL(origin); return u.origin !== origin || !['http:', 'https:'].includes(u.protocol) || !['localhost', '127.0.0.1'].includes(u.hostname) || !u.port || u.username || u.password; } catch { return true; }
  }) || new Set(origins).size !== origins.length) throw new Error('Exact loopback browser origins with ports are required.');
  return Object.freeze({ bind, host, hosts: [`${host}:${PORT}`], origins, allowNative: env.OPT_HTTPS_ALLOW_NATIVE === 'true', root: env.OPT_TLS_ROOT, file: env.OPT_TLS_PFX, passphrase: env.OPT_TLS_PASSPHRASE });
}
async function loadTls(config) {
  const root = await validateRoot(config.root, [path.resolve(__dirname, '..', '..')]);
  for (let current = root; ; current = path.dirname(current)) {
    try { await fs.lstat(path.join(current, '.git')); throw new Error('TLS root is inside a repository.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (path.dirname(current) === current) break;
  }
  const file = path.join(root, config.file), info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 1024 * 1024) throw new Error('Invalid TLS key file.');
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:OPT_TLS_FILE; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($r in $acl.Access) { if ($r.AccessControlType -eq 'Allow') { $sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if ($sid -notin @($me,'S-1-5-18','S-1-5-32-544')) { exit 3 } } }";
    try { await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, OPT_TLS_FILE: file } }); }
    catch { throw new Error('TLS key file ACL is not private.'); }
  } else if ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('TLS key file permissions are not private.');
  const pfx = await fs.readFile(file), options = { pfx, passphrase: config.passphrase, minVersion: 'TLSv1.2' };
  const context = tls.createSecureContext(options); // Reject malformed PFX and wrong password before SDK initialization.
  const raw = context.context.getCertificate();
  if (!raw) throw new Error('TLS PFX has no server certificate.');
  const certificate = new X509Certificate(raw), now = Date.now();
  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo) || !(net.isIP(config.host) ? certificate.checkIP(config.host) : certificate.checkHost(config.host, { subject: 'never' }))) throw new Error('TLS certificate is expired or does not match the configured host SAN.');
  return options;
}
module.exports = { PORT, parseHttpsConfig, loadTls };
