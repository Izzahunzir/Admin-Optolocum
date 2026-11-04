"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { manageJob } = require('./job_management');
const { parseDemoConfig, PROJECT } = require('./demo_config');
const base = { projectId: PROJECT, enableMutations: false, approvedTestUids: [] };
test('job gate defaults off, validates explicit IDs and never grants account mutations', () => {
  assert.equal(parseDemoConfig(base).allowsJob('job'), false);
  const policy = parseDemoConfig({ ...base, enableJobSoftDelete: true, approvedJobIds: ['job'] });
  assert.equal(policy.allowsJob('job'), true);
  assert.equal(policy.allowsJob('other'), false);
  assert.equal(policy.allowsOperation('job', 'locum', 'setDisabled'), false);
  for (const patch of [{enableJobSoftDelete: 'true'}, {enableJobSoftDelete: true}, {approvedJobIds: ['*']}, {approvedJobIds: ['job','job']}, {approvedJobIds: null}]) assert.throws(() => parseDemoConfig({...base,...patch}));
});
function fixture() {
  let job = { status: 'available', title: 'Preserve', clinicOwnerId: 'synthetic-owner', extra: { nested: true } }, writes = 0;
  const auth = { getUser: async () => ({ disabled: false, customClaims: { admin: true } }) };
  const db = { collection: name => { assert.equal(name,'job_postings'); return { doc: id => ({ id }) }; }, runTransaction: async callback => callback({ get: async () => ({exists: !!job, data: () => job}), update: (ref, patch) => { job={...job,...patch}; writes++; } }) };
  const actor={uid:'synthetic-admin',admin:true,auth_time:Date.now()/1000};
  const demoPolicy=parseDemoConfig({...base,enableJobSoftDelete:true,approvedJobIds:['job']});
  const run=(data={}, extra={})=>manageJob({auth,db,actor,demoPolicy,data:{jobId:'job',action:'softDelete',expectedStatus:'available',...data},...extra});
  return {run,auth,actor,db,demoPolicy,get job(){return job;}, get writes(){return writes;}, missing(){job=null;} };
}
test('soft delete updates only lifecycle fields and repeated deletion makes no write', async () => {
  const f=fixture(); assert.deepEqual(await f.run(),{status:'deleted',mutationsEnabled:false});
  assert.equal(f.job.title,'Preserve'); assert.deepEqual(f.job.extra,{nested:true}); assert.ok(f.job.deletedAt); assert.ok(f.job.updatedAt);
  await assert.rejects(f.run(),/already deleted/); assert.equal(f.writes,1);
});
test('authorization, recent login, gates, expected state and validation fail before writes', async () => {
  const f=fixture();
  for (const [data,extra] of [[{}, {actor:{...f.actor,admin:false}}], [{},{actor:{...f.actor,auth_time:0}}], [{},{actor:{...f.actor,auth_time:Infinity}}], [{},{actor:{...f.actor,auth_time:NaN}}], [{},{actor:{...f.actor,auth_time:Date.now()/1000+60}}], [{},{demoPolicy:null}], [{jobId:'other'},{}], [{expectedStatus:'closed'},{}], [{action:'delete'},{}], [{extra:true},{}], [{jobId:'../bad'},{}]]) await assert.rejects(f.run(data,extra));
  f.auth.getUser=async()=>({disabled:true,customClaims:{admin:true}}); await assert.rejects(f.run()); assert.equal(f.writes,0);
});
test('status is read-only and missing jobs cannot be created by deletion',async()=>{
  const f=fixture();
  const status=await manageJob({auth:f.auth,db:f.db,actor:f.actor,demoPolicy:f.demoPolicy,data:{jobId:'job',action:'status'}});
  assert.deepEqual(status,{status:'available',mutationsEnabled:true}); assert.equal(f.writes,0);
  const invalid=await f.run({action:'status',expectedStatus:undefined}).catch(e=>e); assert.equal(invalid.code,'invalid-argument');
  f.missing(); await assert.rejects(f.run(),{code:'not-found'}); assert.equal(f.writes,0);
});
