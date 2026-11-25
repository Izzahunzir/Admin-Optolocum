'use strict';
const { assertEmulatorEnvironment, createEmulatorServices } = require('./safety');
const { controlAdminAccess } = require('../admin_access');
const { deleteApp } = require('firebase-admin/app');
async function main() {
  assertEmulatorEnvironment();
  const [action, uid, ...extra] = process.argv.slice(2);
  if (extra.length || !['bootstrap', 'disable', 'remove-admin'].includes(action) || !uid) throw new Error('Usage: node emulator/admin_access.js bootstrap|disable|remove-admin UID');
  const { app, auth, db } = createEmulatorServices();
  try {
    const result = await controlAdminAccess({ auth, db, uid, action });
    console.log(`Administrator access ${result.state}; a fresh sign-in after the cutoff is required.`);
  } finally { await db.terminate(); await deleteApp(app); }
}
main().catch(() => { console.error('Administrator access operation failed. Inspect emulator state before retrying.'); process.exitCode = 1; });
