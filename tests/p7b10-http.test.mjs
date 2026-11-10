import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createPair} from '../src/server.mjs';
import {save} from '../src/pte-core/vault.mjs';
async function freePort(){return await new Promise((ok,bad)=>{const server=net.createServer();server.once('error',bad);server.listen(0,'127.0.0.1',()=>{const v=server.address().port;server.close(()=>ok(v));});});}
const fixtureGate={standalone:true,distribution:'PUBLISHED_OPEN_SOURCE',ownerApprovedLicense:true,
 license:'MIT',sourceUrl:'https://github.com/synthetic-fixture/sol-workplace',hostedOfficeBackend:false,
 appName:'Sol Workplace',ownerReviewedAt:'2026-11-09T00:00:00Z'};
async function setup(t,fetcher){const dir=await mkdtemp(path.join(tmpdir(),'p7b10-http-'));
 t.after(async()=>rm(dir,{recursive:true,force:true}));
 const gate=path.join(dir,'test-evidence.json');await writeFile(gate,JSON.stringify(fixtureGate),{mode:0o600});
 let a=await freePort(),b=await freePort();while(a===b)b=await freePort();
 const app=await createPair({officePort:a,chatPort:b,stateDir:dir,gateFile:gate,siwcFetcher:fetcher??fetch});
 t.after(async()=>{await app.close()});return {dir,app};
}
async function owner(app,route,body,origin=app.chatOrigin,nonce=null){
 const n=nonce || (await (await fetch(app.chatOrigin+'/api/session')).json()).nonce;
 return fetch(app.chatOrigin+route,{method:'POST',headers:{'content-type':'application/json',Origin:origin,'x-owner-action':n},body:JSON.stringify(body)});
}
test('login is opened only after explicit standalone owner gesture, not through Office',async t=>{
 const {app}=await setup(t);
 let r=await fetch(app.chatOrigin+'/api/siwc/readiness');assert.equal(r.status,200);
 const status=await r.json();assert.equal(status.planConnected,false);assert.equal(status.canStartOAuth,true);
 r=await owner(app,'/api/oauth/start',{},'https://hostile.example');assert.equal(r.status,403);
 r=await owner(app,'/api/oauth/start',{});assert.equal(r.status,200);
 const u=new URL((await r.json()).authorizationUrl);
 assert.equal(u.origin,'https://auth.openai.com');assert.equal(u.searchParams.get('agent_name_hint'),'Sol Workplace');
 r=await fetch(app.chatOrigin+'/auth/callback?state=wrong&code=synthetic&client_id=oaiapp_synthetic');
 assert.equal(r.status,400);
 const st=await (await fetch(app.chatOrigin+'/api/siwc/owner-state')).json();assert.equal(st.connected,false);
 const blocked=await owner(app,'/api/sol/send',{text:'Prova',snapshotId:'',ownerConfirmed:true});
 assert.equal(blocked.status,423);assert.equal((await blocked.json()).paidApiFallback,false);
});
test('one direct standalone UI request persists synthetic model evidence without tokens',async t=>{
 let posts=0;const output={summary:'Report fittizio, non Seller Central.',risks:[],actions:['Confronta report reali'],caveats:['Dati manuali']};
 const payloads=[];
 const fetcher=async (url,req={})=>{
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'gpt-6.1-sol',display_name:'Sol',visibility:'list'}]}),{status:200});
  if(String(url).endsWith('/responses')){
   posts++;payloads.push(JSON.parse(req.body));
   const completion={type:'response.completed',response:{id:'resp_synthetic_ui',status:'completed',model:'gpt-6.1-sol',
    output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(output)}]}]}};
   return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(output)})+'\n\n'+
     'data: '+JSON.stringify(completion)+'\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
  }
  throw Error('UNEXPECTED_URL');
 };
 const {dir,app}=await setup(t,fetcher);
 save(path.join(dir,'siwc-credentials'),'grant',{clientId:'oaiapp_synthetic',subject:'synthetic-owner',
  scopes:['chatgpt.tokens.use.direct'],accessToken:'SYNTHETIC_SECRET_DO_NOT_DISCLOSE',refreshToken:'fake',expiresAt:Date.now()+3600000});
 let r=await owner(app,'/api/sol/send',{text:'Prova',snapshotId:'',ownerConfirmed:false});assert.equal(r.status,422);assert.equal(posts,0);
 r=await owner(app,'/api/sol/send',{text:'Analizza senza inventare.',snapshotId:'',ownerConfirmed:true});
 assert.equal(r.status,200);const result=await r.json();assert.equal(result.state,'SOL_RESPONSE_ATTESTED');assert.equal(posts,1);
 assert.equal(payloads[0].model,'gpt-6.1-sol');assert.deepEqual(payloads[0].reasoning,{effort:'xhigh'});
 const stored=await (await fetch(app.chatOrigin+'/api/data')).json();assert.equal(stored.messages.length,2);
 assert.equal(stored.messages[1].observedModel,'gpt-6.1-sol');assert.equal(stored.messages[1].text,output.summary);
 assert.equal(JSON.stringify(stored).includes('SYNTHETIC_SECRET_DO_NOT_DISCLOSE'),false);
 const status=await(await fetch(app.chatOrigin+'/api/status')).json();assert.equal(status.liveInference,true);
});
