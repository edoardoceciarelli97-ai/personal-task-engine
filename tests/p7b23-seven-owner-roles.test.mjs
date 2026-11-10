import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {OwnerRoleChat,roleChatTestHelpers as h} from '../src/owner-role-chat.mjs';
import {createPair} from '../src/server.mjs';
const make=()=>h.ORDER.map((id,i)=>({id,mention:h.MENTIONS[i],name:'Specialista '+id,instructions:'Agisci solo nel tuo ruolo, segnala dati assenti, non spendere e non inventare. '.repeat(3),sourceSha256:'a'.repeat(64)}));
function setup(t,{connected=true,fail=false}={}){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'p7b23-roles-'));fs.chmodSync(dir,0o700);
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pack=path.join(dir,'pack.json');fs.writeFileSync(pack,JSON.stringify({version:'OWNER_WORKFORCE_FROZEN_P7B23',sourceBaselineSha256:'b'.repeat(64),roles:make()}),{mode:0o600});
 const requests=[];let running=false;
 const siwc={get running(){return running;},status:()=>({readyForInference:connected,eligibleAppDeclared:connected,scopeGranted:connected}),grant:async()=>{if(!connected)throw Error('NO_GRANT')},
  infer:async (job)=>{requests.push(job);running=true;await new Promise(r=>setTimeout(r,5));running=false;if(fail)throw Error('PROVIDER_UNCERTAIN');
   return {completed:true,observedModel:'gpt-6.1-sol',responseId:'resp_synthetic_'+requests.length,output:{summary:'Analisi di prova non verificata. '+job.text,risks:[],actions:['Chiedere dati'],caveats:[]}};
  }};
 return {dir,pack,siwc,requests,service:new OwnerRoleChat({stateDir:dir,packFile:pack,siwc})};
}
test('P7-B23 validates exactly seven frozen roles and private profile schema',async(t)=>{
 const z=setup(t),s=await z.service.init();assert.equal(s.status().roles.length,7);assert.equal(s.status().roles[0].mention,'DirettoreAI');
 assert.ok(!('instructions' in s.status().roles[0]));assert.equal(s.status().proprietaryOfficeBridge,false);
 const p=JSON.parse(fs.readFileSync(z.pack));p.roles[1].id='extra';assert.throws(()=>h.validatePack(p),/ROLE_ENTRY_NOT_FROZEN/);
});
test('P7-B23 local roles accept one owner-confirmed request with real receipt-shaped mock',async(t)=>{
 const z=setup(t),s=await z.service.init(),th=await s.open({market:'AE',roleId:'finance'});
 await assert.rejects(s.send({id:th.id,market:'AE',text:'Valuta margini',ownerConfirmed:false}),/OWNER_EXPLICIT_CONSENT_REQUIRED/);
 const out=await s.send({id:th.id,market:'AE',text:'Valuta margini e segnala dati mancanti',ownerConfirmed:true});
 assert.equal(out.state,'CLIENT_ATTESTED_RESPONSE');assert.equal(out.observedModel,'gpt-6.1-sol');
 const rec=s.read({id:th.id,market:'AE'});assert.equal(rec.messages.length,2);
 assert.equal(rec.messages[0].state,'OWNER_REQUEST_COMPLETED');assert.equal(rec.messages[1].state,'CLIENT_ATTESTED_RESPONSE');
 assert.equal(z.requests.length,1);assert.equal(z.requests[0].snapshot.currency,'AED');assert.ok(z.requests[0].profileInstructions.includes('non inventare'));
 assert.equal(fs.statSync(path.join(z.dir,'owner-role-conversations.json')).mode&0o077,0);
 assert.equal(JSON.stringify(rec).includes('resp_synthetic_1'),false);
});
test('P7-B23 market scopes and role selection reject cross-market and unknown roles',async(t)=>{
 const z=setup(t),s=await z.service.init(),th=await s.open({market:'IT',roleId:'ads'});
 assert.throws(()=>s.read({id:th.id,market:'AE'}),/THREAD_NOT_FOUND_OR_CROSS_MARKET/);
 assert.throws(()=>s.open({market:'AE',roleId:'unknown'}),/INVALID_MARKET_OR_ROLE/);
 await assert.rejects(s.send({id:th.id,market:'AE',text:'Test',ownerConfirmed:true}),/THREAD_NOT_FOUND_OR_CROSS_MARKET/);
 assert.equal(z.requests.length,0);
});
test('P7-B23 provider uncertainty is persisted, blocks duplicate and stays blocked after restart',async(t)=>{
 const z=setup(t,{fail:true}),s=await z.service.init(),th=await s.open({market:'IT',roleId:'director'});
 await assert.rejects(s.send({id:th.id,market:'IT',text:'Analizza un rischio',ownerConfirmed:true}),/PROVIDER_RESULT_UNCERTAIN_NO_RETRY/);
 assert.equal(s.read({id:th.id,market:'IT'}).locked,true);
 await assert.rejects(s.send({id:th.id,market:'IT',text:'Analizza un rischio',ownerConfirmed:true}),/UNCERTAIN_RESULT_NO_RETRY/);
 const reopen=await new OwnerRoleChat({stateDir:z.dir,packFile:z.pack,siwc:z.siwc}).init();
 assert.equal(reopen.read({id:th.id,market:'IT'}).locked,true);assert.equal(z.requests.length,1);
});
test('P7-B23 no grant blocks before reserving any model request',async(t)=>{
 const z=setup(t,{connected:false}),s=await z.service.init(),th=await s.open({market:'AE',roleId:'research'});
 await assert.rejects(s.send({id:th.id,market:'AE',text:'Analizza stock',ownerConfirmed:true}),/FIRST_PARTY_OAUTH_REQUIRED/);
 assert.equal(s.read({id:th.id,market:'AE'}).messages.length,0);
});
test('P7-B23 rejects world-readable pack and symlinked pack',async(t)=>{
 const z=setup(t);fs.chmodSync(z.pack,0o644);await assert.rejects(z.service.init(),/PRIVATE_ROLE_FILE_REQUIRED/);
 fs.chmodSync(z.pack,0o600);const symlink=path.join(z.dir,'pack-link.json');fs.symlinkSync(z.pack,symlink);
 await assert.rejects(new OwnerRoleChat({stateDir:z.dir,packFile:symlink,siwc:z.siwc}).init(),/PRIVATE_ROLE_FILE_REQUIRED/);
});
test('P7-B23 role chat remains local first-party, deny wrong Origin and missing nonce',async(t)=>{
 const z=setup(t),store=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'p7b23-http-'));fs.chmodSync(store,0o700);t.after(()=>fs.rmSync(store,{force:true,recursive:true}));
 const other=path.join(store,'roles.json');fs.copyFileSync(z.pack,other);fs.chmodSync(other,0o600);
 const pair=await createPair({stateDir:store,gateFile:null,officePort:35221,chatPort:35222,officeDemo:false,ownerRolePackFile:other});t.after(()=>pair.close());
 const base='http://127.0.0.1:35222';
 const view=await fetch(base+'/roles');assert.equal(view.status,200);assert.match(await view.text(),/sette specialisti AI/);
 const status=await (await fetch(base+'/api/roles/status')).json();assert.equal(status.roles.length,7);assert.equal(status.providerReady,false);
 const denied=await fetch(base+'/api/roles/new',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://malicious.example'},body:JSON.stringify({market:'IT',roleId:'ads'})});assert.equal(denied.status,403);
 const noNonce=await fetch(base+'/api/roles/new',{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify({market:'IT',roleId:'ads'})});assert.equal(noNonce.status,403);
 const forbidden=await fetch(base+'/api/roles/send',{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:'{}'});assert.equal(forbidden.status,403);
 const nonce=(await (await fetch(base+'/api/session')).json()).nonce;
 const created=await fetch(base+'/api/roles/new',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-Owner-Action':nonce},body:JSON.stringify({market:'IT',roleId:'ads'})});assert.equal(created.status,201);
 const thread=await created.json();assert.equal(thread.roleId,'ads');
 const post=await fetch(base+'/api/roles/send',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-Owner-Action':nonce},body:JSON.stringify({id:thread.id,market:'IT',text:'Cosa consigli?',ownerConfirmed:true})});assert.equal(post.status,422);assert.equal((await post.json()).error,'FIRST_PARTY_OAUTH_REQUIRED');
});
test('P7-B23 standalone role-specific direct SIWC request uses xhigh and includes private role instructions in model input only',async(t)=>{
 const z=setup(t),state=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'p7b23-e2e-'));fs.chmodSync(state,0o700);t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
 const file=path.join(state,'roles.json');fs.copyFileSync(z.pack,file);fs.chmodSync(file,0o600);
 const gate={standalone:true,distribution:'PUBLISHED_OPEN_SOURCE',ownerApprovedLicense:true,license:'MIT',sourceUrl:'https://github.com/fixture/sol-workplace',hostedOfficeBackend:false,appName:'Sol Workplace',ownerReviewedAt:'2026-11-10T00:00:00Z'};
 fs.writeFileSync(path.join(state,'evidence.json'),JSON.stringify(gate),{mode:0o600});
 const {save}=await import('../src/pte-core/vault.mjs');
 const secret='SIMULATED_NOT_REAL_BEARER';save(path.join(state,'siwc-credentials'),'grant',{clientId:'oaiapp_synthetic',subject:'fixture-owner',hostId:'urn:uuid:'+randomUUID(),scopes:['chatgpt.tokens.use.direct'],accessToken:secret,refreshToken:'not_real',expiresAt:Date.now()+3600000});
 const captured=[];
 const fetcher=async (url,opts={})=>{
   if(String(url).endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'gpt-6.1-sol',visibility:'list',display_name:'Sol'}]}),{status:200});
   if(String(url).endsWith('/responses')){
     captured.push(JSON.parse(opts.body));
     const output={summary:'Analisi specialistica sintetica; non verificata con Seller Central.',risks:[],actions:['Richiedere prove'],caveats:['Dati di prova']};
     const completion={type:'response.completed',response:{id:'resp_fixture_specialist',model:'gpt-6.1-sol',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(output)}]}]}};
     return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(output)})+'\n\n'+'data: '+JSON.stringify(completion)+'\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
   }
   throw Error('UNEXPECTED_FETCH');
 };
 const app=await createPair({stateDir:state,gateFile:path.join(state,'evidence.json'),siwcFetcher:fetcher,officePort:35331,chatPort:35332,officeDemo:false,ownerRolePackFile:file});t.after(()=>app.close());
 const base='http://127.0.0.1:35332',nonce=(await(await fetch(base+'/api/session')).json()).nonce;
 const headers={'Origin':base,'Content-Type':'application/json','X-Owner-Action':nonce};
 const created=await fetch(base+'/api/roles/new',{method:'POST',headers,body:JSON.stringify({market:'AE',roleId:'ads'})});assert.equal(created.status,201);const th=await created.json();
 const sent=await fetch(base+'/api/roles/send',{method:'POST',headers,body:JSON.stringify({id:th.id,market:'AE',text:'Verifica ACOS e limiti dei dati disponibili.',ownerConfirmed:true})});
 assert.equal(sent.status,200);const result=await sent.json();assert.equal(result.observedModel,'gpt-6.1-sol');assert.equal(captured.length,1);
 assert.equal(captured[0].reasoning.effort,'xhigh');assert.equal(captured[0].store,false);assert.deepEqual(captured[0].tools,[]);
 assert.ok(captured[0].instructions.includes('Agisci solo nel tuo ruolo'));assert.ok(captured[0].instructions.includes('Specialista ads'));
 const readable=await(await fetch(base+'/api/roles/thread?market=AE&id='+th.id)).text();assert.equal(readable.includes(secret),false);
 const noPublicPack=await fetch(base+'/roles.json');assert.equal(noPublicPack.status,404);
});
