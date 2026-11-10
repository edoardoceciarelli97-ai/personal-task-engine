import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createPair} from '../src/server.mjs';
const free=()=>new Promise((ok,bad)=>{const s=net.createServer();s.once('error',bad);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>ok(port));});});
test('P7-B9 HTTP readiness is visible and both login and inference remain locked',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'p7b9-'));let a=await free(),b=await free();while(a===b)b=await free();
 const p=await createPair({officePort:a,chatPort:b,stateDir:dir});
 try{
  const r=await fetch(p.chatOrigin+'/api/siwc/readiness');assert.equal(r.status,200);const g=await r.json();
  assert.equal(g.state,'BLOCKED_EXTERNAL_ADMISSION_AND_OWNER_CONSENT');
  assert.equal(g.canSendToSol,false);
  const html=await (await fetch(p.chatOrigin+'/')).text();assert.match(html,/p7b9-gate-status/);
  for(const route of ['/api/sol/send','/api/oauth/start']){
   const q=await fetch(p.chatOrigin+route,{method:'POST',headers:{Origin:p.chatOrigin,'content-type':'application/json'},body:'{}'});
   assert.equal(q.status,423);assert.equal((await q.json()).dispatched,false);
  }
 }finally{await p.close();await rm(dir,{recursive:true,force:true});}
});
