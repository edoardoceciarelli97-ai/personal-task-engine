// Owner-only Sign in with ChatGPT integration for the standalone open-source chat.
// No credentials or inference endpoint is exposed to a proprietary parent app.
// OAuth must not start without truthful reviewed evidence of a published OSS app.
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {eligibility, begin, complete, refresh, catalog, PlanProvider} from './pte-core/siwc.mjs';
import {load, save, consumePending} from './pte-core/vault.mjs';

const MODEL='gpt-6.1-sol';
const MAX_PROMPT=4000;
const REQUEST_INSTRUCTIONS=[
  'Sei Sol Workplace, assistente AI indipendente dell’utente per analisi aziendali.',
  'Rispondi esclusivamente con un oggetto JSON con campi summary (stringa),',
  'risks (array di stringhe), actions (array di stringhe) e caveats (array di stringhe).',
  'Distingui rigorosamente i dati importati manualmente da dati Seller Central verificati.',
  'Non inventare vendite, prezzi, benchmark, permessi, aggiornamenti o azioni eseguite.',
  'Non affermare di aver eseguito interventi Amazon, non invocare strumenti esterni.',
].join(' ');

const publicEvidence=(e)=>{
  const required=['standalone','distribution','ownerApprovedLicense','license','sourceUrl','hostedOfficeBackend'];
  if(!e || typeof e!=='object' || Object.keys(e).some(k=>!([...required,'appName','ownerReviewedAt'].includes(k)))) return false;
  if(e.appName!=='Sol Workplace') return false;
  if(typeof e.sourceUrl!=='string'||!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/tree\/[A-Za-z0-9_.-]+)?\/?$/.test(e.sourceUrl)) return false;
  if(!e.ownerReviewedAt || !Number.isFinite(Date.parse(e.ownerReviewedAt)))return false;
  return eligibility(e).readyToRequestRegistration;
};
const redact=(g)=>g?{connected:true,scopeGranted:g.scopes?.includes('chatgpt.tokens.use.direct')===true,
    model:MODEL,subjectNotExposed:true,expiresAt:g.expiresAt}: {connected:false,scopeGranted:false,model:MODEL};
export function loadEligibility(file){
  if(!file) return {allowed:false,reason:'UNPUBLISHED_OR_UNREVIEWED_OSS',evidence:null};
  try{
    const e=JSON.parse(readFileSync(file,'utf8'));
    return publicEvidence(e)?{allowed:true,reason:'SELF_DECLARED_PUBLISHED_OSS_NOT_PROVIDER_ATTESTED',evidence:e}:
      {allowed:false,reason:'INVALID_PUBLISHED_OSS_EVIDENCE',evidence:null};
  }catch{return {allowed:false,reason:'EVIDENCE_FILE_NOT_READABLE',evidence:null};}
}
function safeOutput(value){
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error('INVALID_SOL_JSON_OBJECT');
  const fields=['summary','risks','actions','caveats'];
  if(Object.keys(value).some(k=>!fields.includes(k)))throw Error('SOL_OUTPUT_SCHEMA');
  if(typeof value.summary!=='string'||value.summary.length>12000)throw Error('SOL_SUMMARY_INVALID');
  for(const k of fields.slice(1)){
    if(!Array.isArray(value[k])||value[k].length>20||value[k].some(x=>typeof x!=='string'||x.length>2500))throw Error('SOL_OUTPUT_SCHEMA');
  }
  return value;
}
function validPrompt(text){return typeof text==='string'&&text.trim().length>0&&text.trim().length<=MAX_PROMPT;}
export class SiwcRuntime {
  constructor({stateDir,chatOrigin,gateFile=null,fetcher=fetch}={}){
    if(!stateDir||!path.isAbsolute(stateDir))throw Error('SIWC_ABSOLUTE_OWNER_DIR_REQUIRED');
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(chatOrigin||''))throw Error('LOCAL_USER_RUNTIME_REQUIRED');
    this.root=path.join(stateDir,'siwc-credentials');
    this.chatOrigin=chatOrigin;
    this.fetcher=fetcher;
    this.gate=loadEligibility(gateFile);
    this.running=false;
  }
  status(){
    // Do not expose identifiers or tokens from protected storage.
    if(!this.gate.allowed)return {eligibleAppDeclared:false,reason:this.gate.reason,...redact(null),readyForInference:false};
    const grant=load(this.root,'grant');
    const redacted=redact(grant);
    return {eligibleAppDeclared:true,reason:this.gate.reason,...redacted,
      readyForInference:redacted.scopeGranted && Number.isFinite(grant.expiresAt) && grant.expiresAt>Date.now()+60_000};
  }
  startLogin(){
    if(!this.gate.allowed)throw Error('OSS_DISTRIBUTION_NOT_ESTABLISHED');
    const ongoing=load(this.root,'pending');
    if(ongoing?.expiresAt>Date.now())throw Error('OAUTH_ALREADY_PENDING');
    // Any expired pending file must be discarded before a new login attempt.
    if(ongoing) {const {remove}=this._vaultHelpers();remove(this.root,'pending');}
    let host=load(this.root,'host');
    if(!host){host={id:'urn:uuid:'+randomUUID()};save(this.root,'host',host);}
    const previous=load(this.root,'grant');
    const {url,attempt}=begin({evidence:this.gate.evidence,hostId:host.id,
      redirectUri:this.chatOrigin+'/auth/callback',previous});
    save(this.root,'pending',attempt);
    return {authorizationUrl:url,expiresAt:attempt.expiresAt};
  }
  _vaultHelpers(){return {remove:(root,name)=>{ // import is static below; wrapper is only for expired attempts
    return clearExpiredPending(root,name);
  }};}
  async completeLogin(params){
    if(!this.gate.allowed)throw Error('OSS_DISTRIBUTION_NOT_ESTABLISHED');
    const pending=consumePending(this.root,params.state);
    const grant=await complete(pending,params,this.fetcher);
    save(this.root,'grant',grant);
    return {connected:true,scopeGranted:grant.scopes.includes('chatgpt.tokens.use.direct')};
  }
  async grant(){
    if(!this.gate.allowed)throw Error('OSS_DISTRIBUTION_NOT_ESTABLISHED');
    let g=load(this.root,'grant');
    if(!g || !g.scopes?.includes('chatgpt.tokens.use.direct'))throw Error('PERSONAL_GRANT_REQUIRED');
    if(g.expiresAt<=Date.now()+60_000){g=await refresh(g,this.fetcher);save(this.root,'grant',g);}
    return g;
  }
  async models(){const g=await this.grant();return {models:await catalog(g,this.fetcher),
     quotaRemaining:'NOT_EXPOSED_BY_PROVIDER'};}
  async infer({text,snapshot=null,ownerConfirmed=false,source='OWNER_DIRECT_STANDALONE_UI'}={}){
    if(!this.gate.allowed)throw Error('OSS_DISTRIBUTION_NOT_ESTABLISHED');
    if(this.running)throw Error('SINGLE_ACTIVE_REQUEST_ONLY');
    if(!ownerConfirmed || !validPrompt(text))throw Error('EXPLICIT_OWNER_MESSAGE_REQUIRED');
    if(!['OWNER_DIRECT_STANDALONE_UI','OWNER_SELECTED_LOCAL_MCP_TASK'].includes(source))throw Error('UNTRUSTED_REQUEST_ORIGIN');
    if(snapshot!==null && (typeof snapshot!=='object'||Array.isArray(snapshot)||JSON.stringify(snapshot).length>45000))throw Error('INVALID_OWNER_SNAPSHOT');
    this.running=true;
    try{
      const g=await this.grant();
      const provider=new PlanProvider(g,this.fetcher);
      const result=await provider.infer({model:MODEL,role:'Sol Workplace Owner Analyst',version:'p7b10-v1',
        instructions:REQUEST_INSTRUCTIONS,input:{prompt:text.trim(),manualSnapshot:snapshot,
        source,amazonDataVerified:false},documents:[],memory:[]},
        {expiresAt:Math.min(Date.now()+90_000,g.expiresAt)});
      if(result.completed!==true||result.requestedModel!==MODEL||result.observedModel!==MODEL||
        !/^resp_[A-Za-z0-9_-]{1,200}$/.test(result.id||''))throw Error('SOL_RESPONSE_NOT_ATTESTED');
      const output=safeOutput(JSON.parse(result.text));
      return {completed:true,observedModel:MODEL,reasoningRequested:'xhigh',responseId:result.id,
        output,usage:result.usage??null,origin:'PERSONAL_SIWC_DIRECT_STANDALONE'};
    }finally{this.running=false;}
  }
}
// The static import is resolved outside the class to avoid external dependencies.
import {remove as clearExpiredPending} from './pte-core/vault.mjs';
export const testHelpers={publicEvidence,validPrompt,safeOutput};
