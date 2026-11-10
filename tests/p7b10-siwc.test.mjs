import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {SiwcRuntime,loadEligibility,testHelpers} from '../src/siwc-runtime.mjs';
import {save} from '../src/pte-core/vault.mjs';
const gate=()=>({standalone:true,distribution:'PUBLISHED_OPEN_SOURCE',ownerApprovedLicense:true,
 license:'MIT',sourceUrl:'https://github.com/sample/sol-workplace',hostedOfficeBackend:false,
 appName:'Sol Workplace',ownerReviewedAt:'2026-11-09T00:00:00Z'});
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p7b10-'));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir};
function make(t,ok=false,fetcher=undefined){const dir=temp(t),source=path.join(dir,'source.json');
 if(ok)fs.writeFileSync(source,JSON.stringify(gate()),{mode:0o600});
 return {dir,app:new SiwcRuntime({stateDir:dir,chatOrigin:'http://127.0.0.1:4278',gateFile:ok?source:null,fetcher})};}

test('default is DENY: unpublished source cannot start login or inference',async(t)=>{
 const {app}=make(t);assert.equal(app.status().eligibleAppDeclared,false);
 assert.throws(()=>app.startLogin(),/OSS_DISTRIBUTION_NOT_ESTABLISHED/);
 await assert.rejects(app.infer({text:'Test',ownerConfirmed:true}),/OSS_DISTRIBUTION_NOT_ESTABLISHED/);
});
test('generic private or unknown source is not described as published OSS',t=>{
 const dir=temp(t),f=path.join(dir,'gate.json');for(const v of [
 {...gate(),hostedOfficeBackend:true},
 {...gate(),sourceUrl:'https://office.example.com/private'},
 {...gate(),appName:'Amazon OS'},
 {...gate(),distribution:'PRIVATE'},
 {...gate(),ownerApprovedLicense:false},
 ]){fs.writeFileSync(f,JSON.stringify(v));assert.equal(loadEligibility(f).allowed,false);}
});
test('official first sign-in is for Sol Workplace with fresh PKCE and host identity, no token',t=>{
 const {app}=make(t,true);const a=app.startLogin();assert.equal(app.status().connected,false);
 const url=new URL(a.authorizationUrl);
 assert.equal(url.origin,'https://auth.openai.com');assert.equal(url.pathname,'/api/accounts/authorize');
 assert.equal(url.searchParams.get('agent_name_hint'),'Sol Workplace');
 assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');
 assert.ok(url.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
 assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:4278/auth/callback');
 assert.match(url.searchParams.get('ext_agent_host_id'),/^urn:uuid:/);
 assert.throws(()=>app.startLogin(),/OAUTH_ALREADY_PENDING/);
});
test('direct personal request, exact Sol xhigh, no fallback, no retry, fixture only',async(t)=>{
 let posts=0;let payload;
 const now=Date.now(),responseId='resp_synthetic_test';
 const out={summary:'Non sono disponibili dati Amazon verificati.',risks:[],actions:['Importare un report aggiornato'],caveats:['Solo dati manuali']};
 const textOut=JSON.stringify(out);
 const fetcher=async (url,opts={})=>{
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'gpt-6.1-sol',visibility:'list',display_name:'Sol'}]}),{status:200});
  if(String(url).endsWith('/responses')){
   posts++;payload=JSON.parse(opts.body);
   const completion={type:'response.completed',response:{id:responseId,status:'completed',model:'gpt-6.1-sol',
       output:[{type:'message',role:'assistant',content:[{type:'output_text',text:textOut}]}]}};
   const events=['data: '+JSON.stringify({type:'response.output_text.delta',delta:textOut}),'','data: '+JSON.stringify(completion),'',''].join('\n');
   return new Response(events,{status:200,headers:{'content-type':'text/event-stream'}});
  }
  throw Error('UNEXPECTED_NETWORK');
 };
 const {dir,app}=make(t,true,fetcher);
 save(path.join(dir,'siwc-credentials'),'grant',{clientId:'oaiapp_test',subject:'synthetic-owner',
  scopes:['chatgpt.tokens.use.direct'],accessToken:'synthetic-do-not-use',refreshToken:'synthetic-refresh',expiresAt:now+600000});
 assert.equal(app.status().readyForInference,true);
 await assert.rejects(app.infer({text:'Prova',ownerConfirmed:false}),/EXPLICIT_OWNER_MESSAGE_REQUIRED/);
 assert.equal(posts,0);
 const res=await app.infer({text:'Analizza questi dati.',snapshot:{market:'AE',verifiedWithAmazon:false},ownerConfirmed:true});
 assert.equal(posts,1);assert.equal(res.completed,true);assert.equal(res.observedModel,'gpt-6.1-sol');
 assert.equal(res.reasoningRequested,'xhigh');assert.equal(res.responseId,responseId);
 assert.deepEqual(res.output,out);assert.equal(payload.model,'gpt-6.1-sol');
 assert.deepEqual(payload.reasoning,{effort:'xhigh'});assert.deepEqual(payload.tools,[]);assert.equal(payload.store,false);assert.equal(payload.stream,true);
 assert.equal(JSON.stringify(res).includes('synthetic-do-not-use'),false);
});
test('malformed Sol response never becomes a claimed success',async(t)=>{
 let posts=0;
 const fetcher=async url=>{
 if(String(url).endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'gpt-6.1-sol',visibility:'list'}]}),{status:200});
 if(String(url).endsWith('/responses')){
 posts++;
 const bad={type:'response.completed',response:{id:'resp_synthetic_bad',status:'completed',model:'gpt-6.1-other',
  output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"summary":"ok","risks":[],"actions":[],"caveats":[]}'}]}]}};
 return new Response('data: '+JSON.stringify(bad)+'\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
 }
 throw Error('UNEXPECTED');
 };
 const {dir,app}=make(t,true,fetcher);
 save(path.join(dir,'siwc-credentials'),'grant',{clientId:'oaiapp_test',subject:'synthetic-owner',scopes:['chatgpt.tokens.use.direct'],
 accessToken:'synthetic',refreshToken:'synthetic',expiresAt:Date.now()+600000});
 await assert.rejects(app.infer({text:'Prova',ownerConfirmed:true}));assert.equal(posts,1);
});
test('output validator rejects missing arrays and unexpected fields',()=>{
 assert.throws(()=>testHelpers.safeOutput({summary:'ok'}));
 assert.throws(()=>testHelpers.safeOutput({summary:'ok',risks:[],actions:[],caveats:[],token:'no'}));
});

test('standalone source in a public source-only branch is eligible for owner review, not provider admission',()=>{
 const e={...gate(),sourceUrl:'https://github.com/edoardoceciarelli97-ai/personal-task-engine/tree/sol-workplace-oss'};
 assert.equal(testHelpers.publicEvidence(e),true);
 assert.equal(testHelpers.publicEvidence({...e,sourceUrl:'https://github.com/owner/repo/tree/branch/private'}),false);
});
