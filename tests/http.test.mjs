import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer as net} from 'node:net';
import http from 'node:http';
import {createPair} from '../src/server.mjs';
const sample={version:1,market:'AE',currency:'AED',asOf:'2026-11-09T09:00:00Z',items:[{sku:'TEST-1',units:10,stock:0,revenue:90,cost:130},{sku:'TEST-2',units:2,stock:3,revenue:55,cost:null}]};
const free=()=>new Promise((resolve,reject)=>{const s=net();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
async function fixture(cb){const dir=await mkdtemp(path.join(tmpdir(),'p7b5-'));const a=await free();let b=await free();while(a===b)b=await free();const p=await createPair({officePort:a,chatPort:b,stateDir:dir});try{return await cb({...p,dir,a,b})}finally{await p.close();await rm(dir,{recursive:true,force:true})}}
async function authorize(o){return (await fetch(o+'/api/session')).json()}
async function mutate(o,nonce,url,body,overrides={}){return fetch(o+url,{method:'POST',headers:{'Origin':o,'X-Owner-Action':nonce,'Content-Type':'application/json',...overrides},body:JSON.stringify(body)})}
test('two local origins, standalone chat and Office simulation',()=>fixture(async({officeOrigin,chatOrigin})=>{
  assert.notEqual(officeOrigin,chatOrigin);
  const office=await fetch(officeOrigin+'/');assert.equal(office.status,200);assert.match(await office.text(),new RegExp(`src="${chatOrigin.replaceAll('.','\\.')}\/"`));
  const child=await fetch(chatOrigin+'/');assert.equal(child.status,200);assert.match(await child.text(),/Sol Workplace/);
  assert.match(child.headers.get('content-security-policy'),/frame-ancestors http:\/\/127\.0\.0\.1:/);
  assert.equal(child.headers.get('access-control-allow-origin'),null);
}));
test('status makes no false model or entitlement claim',()=>fixture(async({chatOrigin})=>{
  const response=await fetch(chatOrigin+'/api/status');assert.equal(response.status,200);
  const s=await response.json();assert.equal(s.planConnected,false);assert.equal(s.liveInference,false);
  assert.equal(s.providerEligibility,'UNVERIFIED');assert.equal(s.extraApiBilling,false);
}));
test('provider and OAuth calls are hard-locked even with user input',()=>fixture(async({chatOrigin})=>{
  for(const endpoint of ['/api/sol/send','/api/oauth/start']){
    const r=await mutate(chatOrigin,'FAKE',endpoint,{model:'gpt-6.1-sol',prompt:'hello'});
    assert.equal(r.status,423);const body=await r.json();assert.equal(body.dispatched,false);assert.equal(body.paidApiFallback,false);
  }
}));
test('CSRF/origin and missing nonce protect every mutation',()=>fixture(async({chatOrigin})=>{
  const {nonce}=await authorize(chatOrigin);
  assert.equal((await mutate(chatOrigin,'FAKE','/api/messages',{text:'TEST'})).status,403);
  assert.equal((await mutate(chatOrigin,nonce,'/api/messages',{text:'TEST'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await mutate(chatOrigin,nonce,'/api/messages',{text:'TEST'})).status,201);
}));
test('draft persisted and not presented as an AI response',()=>fixture(async({chatOrigin,dir})=>{
  const {nonce}=await authorize(chatOrigin);
  const sent=await mutate(chatOrigin,nonce,'/api/messages',{text:'Analizza Amazon UAE'});assert.equal(sent.status,201);
  const obj=await sent.json();assert.equal(obj.state,'DRAFT_NOT_SENT');assert.equal(obj.role,'owner');
  const data=await fetch(chatOrigin+'/api/data').then(r=>r.json());assert.equal(data.messages.length,1);
  assert.equal(data.messages[0].text,'Analizza Amazon UAE');
  const file=path.join(dir,'workspace.json');const stats=await stat(file);assert.equal(stats.mode&0o077,0);
  assert.equal((await readFile(file,'utf8')).includes('gpt_6_live'),false);
}));
test('manual snapshot and deterministic local-only checks with traceability',()=>fixture(async({chatOrigin})=>{
  const {nonce}=await authorize(chatOrigin);
  const imported=await mutate(chatOrigin,nonce,'/api/snapshots',sample);assert.equal(imported.status,201);
  const meta=await imported.json();assert.equal(meta.count,2);assert.equal(meta.verifiedWithAmazon,false);
  const scan=await mutate(chatOrigin,nonce,'/api/check-local',{snapshotId:meta.id});assert.equal(scan.status,200);
  const result=await scan.json();assert.equal(result.kind,'LOCAL_DETERMINISTIC_NOT_SOL');
  assert.equal(result.summary.high,2);assert.equal(result.summary.requiresData,1);
  assert.ok(result.cards.every(c=>c.evidence.snapshotId===meta.id));
  const data=await fetch(chatOrigin+'/api/data').then(r=>r.json());assert.equal(data.cards.length,4);
}));
test('repeat local evaluation does not duplicate cards',()=>fixture(async({chatOrigin})=>{
  const {nonce}=await authorize(chatOrigin);
  const m=await (await mutate(chatOrigin,nonce,'/api/snapshots',sample)).json();
  await mutate(chatOrigin,nonce,'/api/check-local',{snapshotId:m.id});
  await mutate(chatOrigin,nonce,'/api/check-local',{snapshotId:m.id});
  const data=await fetch(chatOrigin+'/api/data').then(r=>r.json());assert.equal(data.cards.length,4);
}));
test('unknown fields, invalid currency and sensitive tokens rejected',()=>fixture(async({chatOrigin})=>{
  const {nonce}=await authorize(chatOrigin);
  for(const body of [{...sample,accessToken:'SENSITIVE_TEST'}, {...sample,currency:'USD'}, {...sample,items:[{...sample.items[0],email:'x@y.z'}]}]){
    assert.equal((await mutate(chatOrigin,nonce,'/api/snapshots',body)).status,422);
  }
  const data=await fetch(chatOrigin+'/api/data').then(r=>r.json());assert.equal(data.snapshots.length,0);
}));
test('unknown endpoints, CORS and disallowed HTTP methods are rejected',()=>fixture(async({chatOrigin})=>{
  for(const ep of ['/api/relay','/api/proxy','/api/token','/api/amazon','/api/completions'])
    assert.equal((await fetch(chatOrigin+ep)).status,404);
  assert.equal((await fetch(chatOrigin+'/api/session',{method:'OPTIONS'})).status,403);
  assert.equal((await fetch(chatOrigin+'/',{method:'DELETE'})).status,405);
}));
test('Host-header injection rejected at listener',()=>fixture(async({chatOrigin})=>{
  const u=new URL(chatOrigin);
  const status=await new Promise((resolve,reject)=>{
    const q=http.request({hostname:u.hostname,port:u.port,path:'/',headers:{Host:'malicious.example'}},res=>{res.resume();resolve(res.statusCode)});
    q.on('error',reject);q.end();
  });assert.equal(status,421);
}));
test('no implicit network bind or unsafe data directory',async()=>{
  await assert.rejects(createPair({officePort:4277,chatPort:4277,stateDir:'/tmp/should-not-matter'}),/INVALID_OR_EQUAL_PORT/);
  await assert.rejects(createPair({officePort:4277,chatPort:4278,stateDir:'relative/path'}),/EXPLICIT_ABSOLUTE_STATE_DIRECTORY_REQUIRED/);
});
test('on-disk drafts survive server restart with same private state',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'p7b5-restart-'));
  let a=await free(),b=await free();while(a===b)b=await free();
  const args={officePort:a,chatPort:b,stateDir:dir};
  let p=await createPair(args);
  try{
    const nonce=(await authorize(p.chatOrigin)).nonce;
    assert.equal((await mutate(p.chatOrigin,nonce,'/api/messages',{text:'Persisti come bozza, non inviare.'})).status,201);
    await p.close();p=null;
    const r=await createPair(args);p=r;
    const data=await fetch(r.chatOrigin+'/api/data').then(x=>x.json());
    assert.equal(data.messages.length,1);assert.equal(data.messages[0].state,'DRAFT_NOT_SENT');
  }finally{if(p)await p.close();await rm(dir,{recursive:true,force:true});}
});
test('non-JSON mutation request cannot save a draft',()=>fixture(async({chatOrigin})=>{
  const nonce=(await authorize(chatOrigin)).nonce;
  const r=await mutate(chatOrigin,nonce,'/api/messages',{text:'test'},{'Content-Type':'text/plain'});
  assert.equal(r.status,415);
  const data=await fetch(chatOrigin+'/api/data').then(x=>x.json());assert.equal(data.messages.length,0);
}));
test('error responses never echo the forbidden input',()=>fixture(async({chatOrigin})=>{
  const nonce=(await authorize(chatOrigin)).nonce;
  const secret='MY-SYNTHETIC-EXAMPLE-SECRET';
  const r=await mutate(chatOrigin,nonce,'/api/snapshots',{...sample,authorization:secret});
  assert.equal(r.status,422);assert.ok(!(await r.text()).includes(secret));
}));
