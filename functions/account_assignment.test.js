'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assignAccountType } = require('./account_assignment');

test('admin provisions either type once; changes, non-admins and disabled targets are rejected', async () => {
  const docs = new Map();
  const users = new Map([['admin', { customClaims: { admin: true } }], ['user', { customClaims: {} }], ['other', { customClaims: {} }], ['disabled', { disabled: true }]]);
  const auth = { getUser: async uid => { if (!users.has(uid)) throw Error(); return users.get(uid); } };
  const db = { collection: name => ({ doc: uid => ({ uid: `${name}/${uid}` }) }), runTransaction: async fn => fn({
    get: async ref => ({ exists: docs.has(ref.uid), data: () => docs.get(ref.uid) }),
    set: (ref, data) => docs.set(ref.uid, { ...docs.get(ref.uid), ...data }),
  }) };
  const actor = { uid: 'admin', admin: true, auth_time: Date.now() / 1000 };
  const args = { auth, db, actor, uid: 'user', accountType: 'locum', evidenceReference: 'case-1' };
  assert.equal((await assignAccountType(args)).alreadyAssigned, false);
  assert.equal((await assignAccountType(args)).alreadyAssigned, true);
  await assert.rejects(assignAccountType({ ...args, accountType: 'practice_owner' }), { code: 'failed-precondition' });
  await assignAccountType({ ...args, uid: 'other', accountType: 'practice_owner' });
  await assert.rejects(assignAccountType({ ...args, uid: 'disabled' }), { code: 'failed-precondition' });
  await assert.rejects(assignAccountType({ ...args, actor: { ...actor, admin: false } }), { code: 'permission-denied' });
  assert.equal(docs.get('account_management/user').trustedAccountType, 'locum');
  assert.equal(docs.get('account_management/other').trustedAccountType, 'practice_owner');
  assert.equal(docs.get('account_management/user').verificationStatus, undefined);
  assert.equal(docs.get('account_access/user').state, 'active');
});
