// P7-B23: standalone first-party conversations by locally installed owner-reviewed professional profiles.
// This is NOT a backend interface for Amazon OS and never exports its SIWC credentials.
import path from 'node:path';
import {lstat,readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
const ORDER=['director','research','listing','ads','operations','finance','compliance'];
const MENTIONS=['DirettoreAI','AgenteAnalisi','AgenteCommerciale','AgenteAds','AgenteOperations','AgenteFinance','AgenteCompliance'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const err=code=>{throw Error(code);};
const validMarket=x=>['IT','AE'].includes(x);
const ID=/^[a-f0-9]{8}-[a-f0-9-]{27,40}$/i;
const safeText=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
const safeFiles=async(file,max)=>{
  const parent=await lstat(path.dirname(file));
  if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)!==0)err('PRIVATE_ROLE_PARENT_REQUIRED');
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||info.size>max)err('PRIVATE_ROLE_FILE_REQUIRED');
  return readFile(file,'utf8');
};
function validatePack(p){
  if(!obj(p)||p.version!=='OWNER_WORKFORCE_FROZEN_P7B23'||!Array.isArray(p.roles)||p.roles.length!==7)err('ROLES_PACK_INVALID');
  if(Object.keys(p).sort().join(',')!=='roles,sourceBaselineSha256,version'|| !/^[a-f0-9]{64}$/.test(p.sourceBaselineSha256))err('ROLES_PACK_SCHEMA');
  p.roles.forEach((r,i)=>{
    if(!obj(r)||Object.keys(r).sort().join(',')!=='id,instructions,mention,name,sourceSha256')err('ROLE_ENTRY_SCHEMA');
    if(r.id!==ORDER[i]||r.mention!==MENTIONS[i]||!safeText(r.name,100)||!safeText(r.instructions,6000)||!/^[a-f0-9]{64}$/.test(r.sourceSha256))err('ROLE_ENTRY_NOT_FROZEN');
  });
  return p;
}
const empty=()=>({version:1,threads:[]});
export class OwnerRoleChat {
  constructor({stateDir,packFile,siwc}={}){
    if(!path.isAbsolute(stateDir||'')||!path.isAbsolute(packFile||''))err('LOCAL_ABSOLUTE_ROLE_PATHS_REQUIRED');
    if(!siwc||typeof siwc.infer!=='function'||typeof siwc.status!=='function')err('FIRST_PARTY_SIWC_REQUIRED');
    this.stateDir=stateDir;this.packFile=packFile;this.siwc=siwc;
    this.file=path.join(stateDir,'owner-role-conversations.json');this.pack=null;this.data=empty();
    this.sending=false;this.refreshing=false;this.queue=Promise.resolve();
  }
  async init(){
    const sd=await lstat(this.stateDir);if(!sd.isDirectory()||sd.isSymbolicLink()||(sd.mode&0o077)!==0)err('PRIVATE_STATE_DIR_REQUIRED');
    this.pack=validatePack(JSON.parse(await safeFiles(this.packFile,100000)));
    try{
      this.data=JSON.parse(await safeFiles(this.file,2000000));
      if(!obj(this.data)||this.data.version!==1||!Array.isArray(this.data.threads)||this.data.threads.length>80)err('BAD_ROLE_CHAT_STATE');
      for(const thread of this.data.threads){
        if(!obj(thread)||!ID.test(thread.id)||!validMarket(thread.market)||!ORDER.includes(thread.roleId)||!Array.isArray(thread.messages)||thread.messages.length>120)err('BAD_ROLE_CHAT_THREAD');
        for(const m of thread.messages)if(!obj(m)||!ID.test(m.id)||!['owner','assistant'].includes(m.actor)||!safeText(m.text,16000)||typeof m.state!=='string'||!/^[A-Z_]{3,50}$/.test(m.state))err('BAD_ROLE_CHAT_MESSAGE');
        if(thread.messages.some(x=>x.state==='PROVIDER_RESERVED_UNCERTAIN')){thread.locked=true;thread.status='BLOCKED_UNCERTAIN_AFTER_RESTART';}
      }
      await this.persist();
    }catch(e){if(e.code!=='ENOENT')throw e;}
    return this;
  }
  async persist(){
    const snapshot=JSON.stringify(this.data);
    const action=this.queue.then(async()=>{
      const tmp=path.join(this.stateDir,`.role-${randomBytes(12).toString('hex')}.tmp`);
      await writeFile(tmp,snapshot,{mode:0o600,flag:'wx'});
      await rename(tmp,this.file);
    });this.queue=action.catch(()=>{});return action;
  }
  status(){return {version:'P7-B23',mode:'FIRST_PARTY_STANDALONE_ONLY',roles:this.pack.roles.map(r=>({id:r.id,name:r.name,mention:r.mention,liveCertified:false,training:'PREPARED_NOT_INDEPENDENTLY_CERTIFIED'})),
    modelRequested:'gpt-6.1-sol',reasoningRequested:'xhigh',providerReady:this.siwc.status().readyForInference===true,
    ownerConsentPerMessage:true,proprietaryOfficeBridge:false,amazonDataConnected:false,amazonWrites:false,paidApiFallback:false};}
  async refreshOnly(){if(this.sending||this.refreshing||this.siwc.running)err('OTHER_MODEL_REQUEST_ACTIVE');this.refreshing=true;try{await this.siwc.grant();return this.status();}finally{this.refreshing=false;}}
  list({market}={}){if(!validMarket(market))err('INVALID_MARKET');return {market,threads:this.data.threads.filter(t=>t.market===market).map(t=>({id:t.id,roleId:t.roleId,status:t.status||'READY',locked:!!t.locked,messageCount:t.messages.length,createdAt:t.createdAt})).reverse()};}
  open({market,roleId}={}){
    if(!validMarket(market)||!ORDER.includes(roleId))err('INVALID_MARKET_OR_ROLE');
    if(this.data.threads.length>=80)err('THREAD_CAP_REACHED');
    const thread={id:randomUUID(),market,roleId,status:'READY',createdAt:new Date().toISOString(),messages:[],locked:false};
    this.data.threads.push(thread);return this.persist().then(()=>({id:thread.id,market,roleId,status:thread.status}));
  }
  find(id,market){if(!ID.test(id)||!validMarket(market))err('INVALID_THREAD_OR_MARKET');const t=this.data.threads.find(x=>x.id===id&&x.market===market);if(!t)err('THREAD_NOT_FOUND_OR_CROSS_MARKET');return t;}
  read({id,market}={}){const t=this.find(id,market);return {id:t.id,market:t.market,roleId:t.roleId,status:t.status,locked:!!t.locked,
    messages:t.messages.map(m=>({...m,responseId:m.responseId?m.responseId.slice(0,10)+'…':null})),providerAttestationByClientOnly:true};}
  async send({id,market,text,ownerConfirmed}={}){
    if(!ownerConfirmed)err('OWNER_EXPLICIT_CONSENT_REQUIRED');
    if(this.sending||this.refreshing||this.siwc.running)err('OTHER_MODEL_REQUEST_ACTIVE');
    const t=this.find(id,market);
    if(t.locked||t.status==='BLOCKED_UNCERTAIN_AFTER_RESTART')err('UNCERTAIN_RESULT_NO_RETRY');
    if(!safeText(text,3500))err('INVALID_ROLE_MESSAGE');
    if(t.messages.length>=118)err('THREAD_MESSAGE_CAP_REACHED');
    if(!this.siwc.status().eligibleAppDeclared||!this.siwc.status().scopeGranted)err('FIRST_PARTY_OAUTH_REQUIRED');
    this.sending=true;
    try{
      // Refresh without AI through this same app. No request reserved until grant ready.
      await this.siwc.grant();
      if(!this.siwc.status().readyForInference)err('FIRST_PARTY_SIWC_NOT_READY');
      const profile=this.pack.roles.find(r=>r.id===t.roleId);
      const preceding=t.messages.filter(m=>m.state==='CLIENT_ATTESTED_RESPONSE'||m.state==='OWNER_REQUEST_COMPLETED').slice(-8)
        .map(m=>({actor:m.actor,text:m.text.slice(0,1600),trust:'LOCAL_CONVERSATION_UNVERIFIED_AMAZON_DATA'}));
      const request={id:randomUUID(),actor:'owner',text:text.trim(),state:'PROVIDER_RESERVED_UNCERTAIN',at:new Date().toISOString()};
      t.messages.push(request);t.status='REQUEST_RESERVED_UNCERTAIN';
      await this.persist();
      try{
        const result=await this.siwc.infer({text:text.trim(),snapshot:{market,currency:market==='IT'?'EUR':'AED',provenance:'OWNER_LOCAL_UNVERIFIED',previousTurns:preceding},
          ownerConfirmed:true,source:'OWNER_DIRECT_STANDALONE_UI',profileInstructions:profile.instructions,profileName:profile.name});
        if(result?.completed!==true||result.observedModel!=='gpt-6.1-sol'||!/^resp_[A-Za-z0-9_-]{1,200}$/.test(result.responseId||'')||!safeText(result.output?.summary,12000))err('NO_AUTHENTIC_CLIENT_ATTESTATION');
        request.state='OWNER_REQUEST_COMPLETED';const assistant={id:randomUUID(),actor:'assistant',state:'CLIENT_ATTESTED_RESPONSE',
          text:result.output.summary,output:result.output,responseId:result.responseId,observedModel:result.observedModel,
          reasoningRequested:'xhigh',reasoningIndependentlyVerified:false,at:new Date().toISOString()};
        t.messages.push(assistant);t.status='READY';
        await this.persist();
        return {threadId:t.id,market,roleId:t.roleId,state:'CLIENT_ATTESTED_RESPONSE',observedModel:assistant.observedModel,
          responseIdRedacted:assistant.responseId.slice(0,10)+'…',output:assistant.output,independentlyCertified:false,amazonWrites:0};
      }catch{
        t.locked=true;t.status='BLOCKED_UNCERTAIN_NO_RETRY';await this.persist();err('PROVIDER_RESULT_UNCERTAIN_NO_RETRY');
      }
    }finally{this.sending=false;}
  }
}
export const roleChatTestHelpers={validatePack,ORDER,MENTIONS,sha};
