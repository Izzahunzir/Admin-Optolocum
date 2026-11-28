'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLocalApp}=require('./local_app');
test('session validation derives identity and fails closed', async t => {
  let user={disabled:false}, assignment={trustedAccountType:'locum'}, access={state:'active',validAfter:10}, token={uid:'user',auth_time:11}, tokenError=null;
  const auth={verifyIdToken:async (_,check)=>{assert.equal(check,true); if(tokenError) throw {code:tokenError}; return token;},getUser:async()=>user};
  const db={collection:name=>({doc:uid=>{assert.equal(uid,'user'); const value=name==='account_management'?assignment:access; return {get:async()=>({exists:!!value,data:()=>value})};}})};
  const transport={hosts:[],origins:['http://localhost:5174']}; const server=createLocalApp({auth,db,transport}).listen(0,'127.0.0.1'); t.after(()=>server.close()); await new Promise(r=>server.once('listening',r)); transport.hosts.push('127.0.0.1:'+server.address().port);
  const call=async body=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/session/validate`,{method:'POST',headers:{origin:'http://localhost:5174',authorization:'Bearer token','content-type':'application/json'},body:JSON.stringify(body)}); return [res.status,await res.json(),res.headers.get('cache-control')];};
  const preflight = await fetch(`http://127.0.0.1:${server.address().port}/api/session/validate`, { method:'OPTIONS', headers:{ origin:'http://localhost:5174', 'access-control-request-method':'POST', 'access-control-request-headers':'authorization,content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  const hostile = await fetch(`http://127.0.0.1:${server.address().port}/api/session/validate`, { method:'OPTIONS', headers:{ origin:'https://attacker.invalid', 'access-control-request-method':'POST' } });
  assert.equal(hostile.status, 403);
  assert.deepEqual(await call({accountType:'locum'}),[200,{data:{uid:'user',accountType:'locum',access:'active'}},'no-store']);
  assert.equal((await call({accountType:'practice_owner'}))[0],403);
  assignment={trustedAccountType:'practice_owner'}; assert.equal((await call({accountType:'practice_owner'}))[0],200);
  user={disabled:true}; assert.equal((await call({accountType:'practice_owner'}))[0],403); user={disabled:false};
  access=null; assert.equal((await call({accountType:'practice_owner'}))[0],403); access={state:'active',validAfter:11}; assert.equal((await call({accountType:'practice_owner'}))[0],403);
  access={state:'active',validAfter:10,operation:'block'}; assert.equal((await call({accountType:'practice_owner'}))[0],403);
  tokenError='auth/id-token-revoked'; assert.equal((await call({accountType:'practice_owner'}))[0],401); tokenError=null;
  assert.equal((await call({accountType:'practice_owner',uid:'other'}))[0],400);
});

