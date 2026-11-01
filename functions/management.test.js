"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { manageAccount, DELETE_WAIT_MS } = require('./management');

function fixture(options = {}) {
  const now = Date.now();
  const users = {
    admin: { disabled: false, customClaims: { admin: true } },
    target: { disabled: false, customClaims: { role: 'locum' }, tokensValidAfterTime: new Date(now - 2 * DELETE_WAIT_MS).toISOString() },
  };
  const mutations = [];
  let dependencies = false;
  let profileExists = true;
  const auth = {
    getUser: async uid => { if (!users[uid]) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); return structuredClone(users[uid]); },
    setCustomUserClaims: async (uid, claims) => { users[uid].customClaims = claims; mutations.push('claims'); },
    updateUser: async (uid, values) => { Object.assign(users[uid], values); mutations.push('update'); },
    revokeRefreshTokens: async uid => { users[uid].tokensValidAfterTime = new Date(now).toISOString(); mutations.push('revoke'); },
    deleteUser: async uid => { delete users[uid]; mutations.push('deleteAuth'); },
  };
  const db = {
    collection: name => ({
      doc: uid => ({ get: async () => ({ exists: profileExists }), listCollections: async () => options.nested ? [{}] : [], path: `${name}/${uid}` }),
      where: () => ({ limit: () => ({ get: async () => ({ empty: !dependencies }) }) }),
    }),
    batch: () => ({ delete: ref => mutations.push(ref.path), commit: async () => { if (options.cleanupFailure) throw new Error('private'); } }),
  };
  const run = data => manageAccount({ auth, db, actor: { uid: 'admin', admin: true, auth_time: now / 1000, ...options.actor }, data: { uid: 'target', kind: 'locum', ...data }, now });
  return { auth, users, mutations, run, now, setDependencies: value => { dependencies = value; }, setProfile: value => { profileExists = value; } };
}

test('disable and enable use Authentication, preserve claims, and revoke sessions', async () => {
  const f = fixture();
  await f.run({ action: 'setDisabled', disabled: true, expectedDisabled: false });
  assert.equal(f.users.target.disabled, true);
  assert.equal(f.users.target.customClaims.role, 'locum');
  assert.equal(typeof f.users.target.customClaims.accountDisabledAt, 'number');
  await f.run({ action: 'setDisabled', disabled: false, expectedDisabled: true });
  assert.equal(f.users.target.disabled, false);
  assert.equal(f.users.target.customClaims.accountDisabledAt, undefined);
  assert.equal(f.mutations.filter(x => x === 'revoke').length, 2);
});

test('self and admin targets cannot be managed', async () => {
  const f = fixture();
  await assert.rejects(f.run({ action: 'status', uid: 'admin' }), /own account/);
  f.users.target.customClaims.admin = true;
  await assert.rejects(f.run({ action: 'delete', confirmUid: 'target' }), /protected/);
  assert.deepEqual(f.mutations, []);
});

test('server rechecks current admin permissions and stale expected state', async () => {
  const f = fixture();
  await assert.rejects(f.run({ action: 'setDisabled', disabled: false, expectedDisabled: true }), /status changed/);
  f.users.admin.customClaims.admin = false;
  await assert.rejects(f.run({ action: 'status' }), /no longer valid/);
  assert.deepEqual(f.mutations, []);
});

test('delete requires typed confirmation, disabled state and server-established waiting period', async () => {
  const f = fixture();
  await assert.rejects(f.run({ action: 'delete', confirmUid: 'wrong' }), /confirmation/);
  await assert.rejects(f.run({ action: 'delete', confirmUid: 'target' }), /Disable this/);
  f.users.target.disabled = true;
  await assert.rejects(f.run({ action: 'delete', confirmUid: 'target' }), /61 minutes/);
  f.users.target.customClaims.accountDisabledAt = Math.floor(f.now / 1000);
  await assert.rejects(f.run({ action: 'delete', confirmUid: 'target' }), /61 minutes/);
  assert.deepEqual(f.mutations, []);
});

test('related records block deletion; an eligible account deletes both profile types', async () => {
  const f = fixture();
  f.users.target.disabled = true;
  f.users.target.customClaims.accountDisabledAt = Math.floor((f.now - 2 * DELETE_WAIT_MS) / 1000);
  f.setDependencies(true);
  await assert.rejects(f.run({ action: 'delete', confirmUid: 'target' }), /related job/);
  assert.deepEqual(f.mutations, []);
  f.setDependencies(false);
  await f.run({ action: 'delete', confirmUid: 'target' });
  assert.deepEqual(f.mutations, ['deleteAuth', 'locum_profiles/target', 'practice_owner_profiles/target']);
});

test('invalid target identifiers and missing profiles fail without writes', async () => {
  const f = fixture();
  await assert.rejects(f.run({ action: 'status', uid: '../target' }), /Invalid account ID/);
  f.setProfile(false);
  await assert.rejects(f.run({ action: 'status' }), /no longer exists/);
  assert.deepEqual(f.mutations, []);
});

test('both account kinds support transitions and reject duplicate retries', async () => {
  for (const kind of ['locum', 'practice_owner']) {
    const f = fixture();
    const request = { kind, action: 'setDisabled', disabled: true, expectedDisabled: false };
    await f.run(request);
    const count = f.mutations.length;
    await assert.rejects(f.run(request), /status changed/);
    assert.equal(f.mutations.length, count);
    await f.run({ kind, action: 'setDisabled', disabled: false, expectedDisabled: true });
    assert.equal(f.users.target.disabled, false);
  }
});

test('unauthorized, stale and malformed login times cannot mutate', async () => {
  for (const actor of [{ admin: false }, { auth_time: 0 }, { auth_time: NaN }, { auth_time: Infinity }, { auth_time: Date.now() / 1000 + 60 }]) {
    const f = fixture({ actor });
    await assert.rejects(f.run({ action: 'setDisabled', disabled: true, expectedDisabled: false }));
    assert.deepEqual(f.mutations, []);
  }
});

test('unexpected fields, invalid types and no-op transitions fail without writes', async () => {
  for (const request of [
    { action: 'status', confirmUid: 'target' },
    { action: 'setDisabled', disabled: 'true', expectedDisabled: false },
    { action: 'setDisabled', disabled: false, expectedDisabled: false },
    { action: 'delete', confirmUid: 'target', extra: true },
  ]) {
    const f = fixture();
    await assert.rejects(f.run(request));
    assert.deepEqual(f.mutations, []);
  }
});

test('partial Auth failures report uncertainty without automatic retries or leaked details', async () => {
  for (const method of ['setCustomUserClaims', 'updateUser', 'revokeRefreshTokens']) {
    const f = fixture();
    let calls = 0;
    f.auth[method] = async () => { calls++; throw new Error('private credential'); };
    await assert.rejects(f.run({ action: 'setDisabled', disabled: true, expectedDisabled: false }), error => error.code === 'internal' && /incomplete/.test(error.message) && !/private/.test(error.message));
    assert.equal(calls, 1);
  }
});

test('nested data blocks deletion; failed profile cleanup is not retried blindly', async () => {
  for (const options of [{ nested: true }, { cleanupFailure: true }]) {
    const f = fixture(options);
    f.users.target.disabled = true;
    f.users.target.customClaims.accountDisabledAt = Math.floor((f.now - 2 * DELETE_WAIT_MS) / 1000);
    await assert.rejects(f.run({ kind: 'practice_owner', action: 'delete', confirmUid: 'target' }), options.nested ? /nested/ : /cleanup failed/);
    if (options.nested) assert.deepEqual(f.mutations, []);
    else {
      assert.equal(f.users.target, undefined);
      await assert.rejects(f.run({ action: 'delete', confirmUid: 'target' }), error => error.code === 'auth/user-not-found');
    }
  }
});
