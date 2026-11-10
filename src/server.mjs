import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import {openStore,validateSnapshot,generateLocalCards,stampDraft,sampleCardSummary} from './core.mjs';
import {getP7B9Readiness} from './p7b9-provider-contract.mjs';
import {SiwcRuntime} from './siwc-runtime.mjs';
const root=path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const listen=(s,port)=>new Promise((ok,bad)=>{s.once('error',bad);s.listen(port,'127.0.0.1',()=>ok(s.address().port));});
const validPort=x=>Number.isSafeInteger(x)&&x>=1024&&x<=65535;
const limitBody=async(req,max=40000)=>{
  let size=0;const chunks=[];
  for await(const c of req){size+=c.length;if(size>max)throw Error('BODY_TOO_LARGE');chunks.push(c);}
  const str=Buffer.concat(chunks).toString('utf8');return JSON.parse(str);
};
export async function createPair({officePort=4277,chatPort=4278,stateDir,gateFile=null,siwcFetcher=fetch,officeDemo=true}={}) {
  if(!validPort(officePort)||!validPort(chatPort)||officePort===chatPort)throw Error('INVALID_OR_EQUAL_PORT');
  if(!stateDir||!path.isAbsolute(stateDir))throw Error('EXPLICIT_ABSOLUTE_STATE_DIRECTORY_REQUIRED');
  const store=await openStore(stateDir);
  const officeOrigin=`http://127.0.0.1:${officePort}`, chatOrigin=`http://127.0.0.1:${chatPort}`;
  const siwc=new SiwcRuntime({stateDir,chatOrigin,gateFile,fetcher:siwcFetcher});
  const secret=randomBytes(32).toString('hex');
  const handler=(office)=>http.createServer(async(req,res)=>{
    const currentOrigin=office?officeOrigin:chatOrigin;
    const expectedHost=`127.0.0.1:${office?officePort:chatPort}`;
    const headers={
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':office?'same-origin':'cross-origin',
      'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
      'Content-Security-Policy':office
        ? `default-src 'none'; style-src 'self'; frame-src ${chatOrigin}; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
        : `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${officeOrigin} http://127.0.0.1:4322; base-uri 'none'; form-action 'none'; object-src 'none'`
    };
    if(office)headers['X-Frame-Options']='DENY';
    const answer=(status,body,contentType='application/json; charset=utf-8')=>{
      res.writeHead(status,{...headers,'Content-Type':contentType});
      res.end(req.method==='HEAD'?'':body);
    };
    const j=(code,obj)=>answer(code,JSON.stringify(obj));
    if(req.headers.host!==expectedHost)return j(421,{error:'HOST_NOT_ALLOWED'});
    const u=new URL(req.url,currentOrigin);
    if(req.method==='OPTIONS')return j(403,{error:'CORS_NOT_ALLOWED'});
    if(!office && u.pathname==='/auth/callback' && req.method==='GET'){
      if(!siwc.gate.allowed)return j(404,{error:'OSS_NOT_PUBLISHED'});
      try{
        if(u.searchParams.getAll('state').length!==1)throw Error('INVALID_CALLBACK');
        await siwc.completeLogin(Object.fromEntries(u.searchParams.entries()));
        // Never reflect the OAuth code in HTML, URLs, or logs.
        res.writeHead(303,{...headers,Location:'/?siwc=connected','Content-Type':'text/plain; charset=utf-8'});
        return res.end('Authorization processed. Open your standalone chat.');
      }catch{return answer(400,'Personal authorization did not complete. No inference started.','text/plain; charset=utf-8');}
    }
    if(!office && u.pathname==='/api/siwc/owner-state' && req.method==='GET')return j(200,siwc.status());
    if(!office && u.pathname==='/api/siwc/readiness' && req.method==='GET'){
      const base=getP7B9Readiness(),status=siwc.status();
      return j(200,status.eligibleAppDeclared?{
        ...base,version:'P7-B10',app:'Sol Workplace (standalone OSS)',
        state:status.connected?'OWNER_GRANT_PRESENT_NOT_LIVE_PROOF':'ELIGIBILITY_SELF_DECLARED_AWAIT_OWNER_OAUTH',
        independentAppPublished:true,providerEligibility:'OWNER_DECLARED_NOT_PROVIDER_CERTIFIED',
        ownAppOauth:status.connected?'GRANT_PRESENT':'AWAITING_OWNER',planConnected:status.connected,
        canStartOAuth:true,canSendToSol:status.readyForInference,
        xhighActual:'NOT_ATTESTED_BY_REQUEST_YET',
      }:base);
    }

    if(!office && u.pathname==='/api/status' && req.method==='GET'){
      const auth=siwc.status(),v=await store.view();
      const hasReal=v.messages.some(m=>m.state==='SOL_RESPONSE_ATTESTED' && m.observedModel==='gpt-6.1-sol');
      return j(200,{app:'Sol Workplace OSS',independent:true,
        planConnected:auth.connected,model:'gpt-6.1-sol',xhighRequested:true,liveInference:hasReal,
        ownerOnlyLocal:true,providerEligibility:auth.eligibleAppDeclared?auth.reason:'UNVERIFIED',
        authorizedForProprietaryOffice:false,extraApiBilling:false});
    }
    if(!office && u.pathname==='/api/session' && req.method==='GET')return j(200,{nonce:secret,session:'LOCAL_EPHEMERAL',expiresOnRestart:true});
    if(!office && u.pathname==='/api/data' && req.method==='GET') {
      const d=await store.view();
      return j(200,{messages:d.messages.slice(-100),snapshots:d.snapshots.map(s=>({id:s.id,market:s.market,currency:s.currency,asOf:s.asOf,count:s.items.length,verifiedWithAmazon:false})),cards:d.cards.slice(-200)});
    }
    if(!office && u.pathname.startsWith('/api/') && req.method==='POST') {
      if(!siwc.gate.allowed && (u.pathname==='/api/sol/send'||u.pathname==='/api/oauth/start'))
        return j(423,{error:'SIWC_APP_ELIGIBILITY_AND_OWNER_OAUTH_NOT_VERIFIED',dispatched:false,paidApiFallback:false});
      if(req.headers.origin!==chatOrigin||req.headers['x-owner-action']!==secret)return j(403,{error:'LOCAL_OWNER_ACTION_REQUIRED'});
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return j(415,{error:'JSON_REQUIRED'});
      let input;
      try{input=await limitBody(req);}catch(e){return j(e.message==='BODY_TOO_LARGE'?413:400,{error:'INVALID_JSON_OR_TOO_LARGE'});}
      try{
        if(u.pathname==='/api/oauth/start'){
          if(!input||Object.keys(input).length!==0)return j(422,{error:'OWNER_INITIATED_EMPTY_LOGIN_ACTION_REQUIRED'});
          const grant=siwc.startLogin();
          return j(200,{authorizationUrl:grant.authorizationUrl,expiresAt:grant.expiresAt,
            realLoginNotYetCompleted:true,extraApiBilling:false});
        }
        if(u.pathname==='/api/sol/send'){
          if(!siwc.status().readyForInference)return j(423,{error:'PERSONAL_SIWC_GRANT_REQUIRED',dispatched:false,paidApiFallback:false});
          if(!input||!['text','snapshotId','ownerConfirmed'].every(k=>k in input)||
            Object.keys(input).length!==3||input.ownerConfirmed!==true||
            typeof input.text!=='string'||input.text.trim().length<1||input.text.trim().length>4000||
            typeof input.snapshotId!=='string'||input.snapshotId.length>100)
            return j(422,{error:'EXPLICIT_OWNER_REQUEST_REQUIRED',dispatched:false});
          const snapshotId=input.snapshotId;
          const data=await store.view();
          const snapshot=snapshotId?data.snapshots.find(x=>x.id===snapshotId):null;
          if(snapshotId&&!snapshot)return j(404,{error:'SNAPSHOT_NOT_FOUND',dispatched:false});
          if(siwc.running)return j(409,{error:'ONE_REQUEST_AT_A_TIME'});
          const attemptId=randomUUID();
          await store.mutate(s=>{s.messages.push({id:attemptId,role:'owner',state:'SOL_REQUEST_RESERVED',
            text:input.text.trim(),at:new Date().toISOString()});s.messages=s.messages.slice(-200)});
          try{
            const result=await siwc.infer({text:input.text,snapshot:snapshot??null,ownerConfirmed:true});
            await store.mutate(s=>{
              const m=s.messages.find(x=>x.id===attemptId);if(m)m.state='SOL_REQUEST_COMPLETED';
              s.messages.push({id:randomUUID(),at:new Date().toISOString(),role:'assistant',
                state:'SOL_RESPONSE_ATTESTED',observedModel:result.observedModel,responseId:result.responseId,
                text:result.output.summary,output:result.output});s.messages=s.messages.slice(-200);
            });
            return j(200,{state:'SOL_RESPONSE_ATTESTED',observedModel:result.observedModel,
              responseId:result.responseId,summary:result.output.summary,extraApiBilling:false});
          }catch{
            await store.mutate(s=>{
              const m=s.messages.find(x=>x.id===attemptId);if(m)m.state='SOL_REQUEST_UNCERTAIN_NO_RETRY';
            });
            return j(503,{error:'PROVIDER_RESULT_UNCERTAIN_NO_RETRY',automaticRetry:false,paidApiFallback:false});
          }
        }
        if(u.pathname==='/api/messages'){
          if(!input||Object.keys(input).length!==1||typeof input.text!=='string')return j(422,{error:'DRAFT_ONLY'});
          const draft=stampDraft(input.text);
          const saved=await store.mutate(s=>{s.messages.push(draft);s.messages=s.messages.slice(-200);return draft});
          return j(201,saved);
        }
        if(u.pathname==='/api/snapshots'){
          const data=validateSnapshot(input);
          const saved=await store.mutate(s=>{
            const row={...data,id:randomUUID(),importedAt:new Date().toISOString()};
            s.snapshots.push(row);s.snapshots=s.snapshots.slice(-30);
            return {id:row.id,market:row.market,currency:row.currency,asOf:row.asOf,count:row.items.length,verifiedWithAmazon:false};
          });
          return j(201,saved);
        }
        if(u.pathname==='/api/check-local'){
          if(!input||Object.keys(input).length!==1||typeof input.snapshotId!=='string')return j(422,{error:'SNAPSHOT_ID_REQUIRED'});
          const result=await store.mutate(s=>{
            const snap=s.snapshots.find(x=>x.id===input.snapshotId);
            if(!snap)throw Error('SNAPSHOT_NOT_FOUND');
            const cards=generateLocalCards(snap);
            s.cards=s.cards.filter(x=>x.evidence.snapshotId!==snap.id).concat(cards).slice(-200);
            return {kind:'LOCAL_DETERMINISTIC_NOT_SOL',summary:sampleCardSummary(cards),cards};
          });
          return j(200,result);
        }
        return j(404,{error:'UNKNOWN_API_ROUTE'});
      }catch(e){return j(e.message==='SNAPSHOT_NOT_FOUND'?404:422,{error:/^[A-Z_]+$/.test(e.message)?e.message:'VALIDATION_FAILED'});}
    }
    if(u.pathname.startsWith('/api/'))return j(404,{error:'UNKNOWN_API_ROUTE'});
    if(!['GET','HEAD'].includes(req.method))return j(405,{error:'METHOD_NOT_ALLOWED'});
    const routes=office?{'/':'office-simulation/index.html','/office.css':'office-simulation/style.css'}:{'/':'public/index.html','/app.js':'public/app.js','/style.css':'public/style.css'};
    const relative=routes[u.pathname];if(!relative)return answer(404,'Not Found','text/plain; charset=utf-8');
    try{
      let content=await fs.readFile(path.join(root,relative),'utf8');
      if(relative.endsWith('.html'))content=content.replaceAll('%%CHAT_ORIGIN%%',chatOrigin);
      return answer(200,content,mime[path.extname(relative)]);
    }catch{return answer(500,'Unavailable','text/plain; charset=utf-8');}
  });
  const o=officeDemo?handler(true):null,c=handler(false);
  try{await listen(c,chatPort);if(o)await listen(o,officePort);}catch(e){if(o)o.close();c.close();throw e;}
  return {officeOrigin:officeDemo?officeOrigin:null,chatOrigin,
    close:()=>Promise.all([...(o?[new Promise(r=>o.close(r))]:[]),new Promise(r=>c.close(r))])};
}
