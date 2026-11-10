// P7-B21: first-party, local-only, explicitly owner-authorized assessment session.
// No Amazon OS RPC, no general model endpoint, no scheduler, no retry and no certification claim.
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {lstat,readFile,writeFile,rename,mkdir} from 'node:fs/promises';
const PIN='698e7c336f81215853d19f5f940e04b6e8cbdc609b39fb4252fff05ca097578c';
const LEVELS=['simple','intermediate','complex','critical'];
const ROLES=['director','research','listing','ads','operations','finance','compliance'];
const MODEL='gpt-6.1-sol';
const sha=x=>createHash('sha256').update(x).digest('hex');
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fresh=()=>({version:1,status:'NOT_STARTED',runId:null,authorizedAt:null,finishedAt:null,activeExamId:null,stopRequested:false,results:[],reason:null});
const err=code=>{throw Error(code)};
const examOrder=ROLES.flatMap(role=>LEVELS.map(level=>`${role}-${level}`));
function validatePack(payload){
  if(!isObj(payload)||payload.version!=='P7B19-FROZEN-28'||payload.contentSha256!==PIN||!Array.isArray(payload.exams)||payload.exams.length!==28)err('OWNER_EXAM_PACK_INVALID');
  if(sha(JSON.stringify(payload.exams))!==PIN)err('OWNER_EXAM_PACK_DIGEST_MISMATCH');
  for(let i=0;i<28;i++){
    const e=payload.exams[i],id=examOrder[i];
    if(!isObj(e)||Object.keys(e).sort().join(',')!=='difficulty,id,market,prompt,promptSha256,roleId')err('OWNER_EXAM_KEYS_INVALID');
    if(e.id!==id||e.roleId!==id.split('-')[0]||e.difficulty!==id.split('-')[1]||!['IT','AE'].includes(e.market))err('OWNER_EXAM_ORDER_INVALID');
    if(typeof e.prompt!=='string'||e.prompt.length<100||e.prompt.length>4000||!e.prompt.includes(`[[AMAZON_OS_EXAM_P7B19:${id}]]`)||sha(e.prompt)!==e.promptSha256)err('OWNER_EXAM_TEXT_INVALID');
  }
  return payload.exams;
}
const validResponse=r=>isObj(r)&&r.completed===true&&r.observedModel===MODEL&&r.reasoningRequested==='xhigh'&&
    /^resp_[A-Za-z0-9_-]{1,200}$/.test(r.responseId||'')&&isObj(r.output)&&
    typeof r.output.summary==='string'&&['risks','actions','caveats'].every(k=>Array.isArray(r.output[k]));
const noTokenObject=x=>{
  const s=JSON.stringify(x);
  return !/"(?:accessToken|refreshToken|clientSecret|idToken|authorization|apiKey)"\s*:/i.test(s);
};
export class OwnerExamSession {
  constructor({stateDir,packFile,siwc,waitMs=10000}={}){
    if(!path.isAbsolute(stateDir||'')||!path.isAbsolute(packFile||''))err('EXPLICIT_OWNER_LOCAL_PATHS_REQUIRED');
    if(!siwc||typeof siwc.infer!=='function'||typeof siwc.status!=='function')err('DIRECT_SIWC_RUNTIME_REQUIRED');
    if(!Number.isInteger(waitMs)||waitMs<0||waitMs>60000)err('INVALID_BETWEEN_EXAM_DELAY');
    this.stateDir=stateDir;this.packFile=packFile;this.siwc=siwc;this.waitMs=waitMs;
    this.file=path.join(stateDir,'owner-exam-session.json');this.state=fresh();this.exams=[];
    this.workerActive=false;this.starting=false;this.pauseRequested=false;this.lastError=null;this.writeQueue=Promise.resolve();
  }
  async init(){
    const dir=await lstat(this.stateDir);if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0)err('PRIVATE_STATE_REQUIRED');
    const packDir=await lstat(path.dirname(this.packFile));if(!packDir.isDirectory()||packDir.isSymbolicLink()||(packDir.mode&0o077)!==0)err('PRIVATE_PACK_DIRECTORY_REQUIRED');
    const st=await lstat(this.packFile);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>150_000)err('PRIVATE_PACK_FILE_REQUIRED');
    const payload=JSON.parse(await readFile(this.packFile,'utf8'));this.exams=validatePack(payload);
    try{
      const old=await lstat(this.file);
      if(!old.isFile()||old.isSymbolicLink()||(old.mode&0o077)!==0||old.size>1_000_000)err('UNSAFE_EXAM_STATE_FILE');
      this.state=JSON.parse(await readFile(this.file,'utf8'));
      if(!isObj(this.state)||this.state.version!==1||!Array.isArray(this.state.results)||this.state.results.length>28||
         this.state.results.some(r=>!examOrder.includes(r.id))||!noTokenObject(this.state))err('INVALID_EXAM_SESSION_STATE');
    }catch(e){if(e.code!=='ENOENT')throw e;}
    // A crash during a reserved request is uncertain; no automatic recovery/retry.
    if(['RUNNING','STOP_REQUESTED'].includes(this.state.status)){
      this.state.status=this.state.activeExamId?'BLOCKED_UNCERTAIN_AFTER_RESTART':'PAUSED_AFTER_RESTART';
      this.state.reason=this.state.activeExamId?'PREVIOUS_PROVIDER_RESULT_UNKNOWN_NO_RETRY':'NO_AUTOMATIC_RESUME';
      await this.persist();
    }
    return this;
  }
  async persist(){
    const snapshot=JSON.stringify(this.state);
    const task=this.writeQueue.then(async()=>{
      const tmp=path.join(this.stateDir,`.exam-${randomBytes(8).toString('hex')}.tmp`);
      await writeFile(tmp,snapshot,{flag:'wx',mode:0o600});
      await rename(tmp,this.file);
    });
    this.writeQueue=task.catch(()=>{});return task;
  }
  publicStatus(){
    const finished=this.state.results.filter(r=>r.status==='CLIENT_ATTESTED_AWAITING_REVIEW');
    return {suite:'P7-B19-FROZEN-28',packDigest:PIN,packLoaded:this.exams.length===28,
      model:MODEL,reasoningRequested:'xhigh',providerGrade:'NOT_ATTESTED',
      state:this.state.status,reason:this.state.reason,runId:this.state.runId,
      authorizedAt:this.state.authorizedAt,finishedAt:this.state.finishedAt,
      activeExamId:this.state.activeExamId,stopRequested:this.pauseRequested||this.state.stopRequested,
      total:28,completed:finished.length,pending:28-finished.length,
      rolesCertified:0,operationallyEnabled:0,
      results:this.state.results.map(r=>({id:r.id,roleId:r.roleId,status:r.status,observedModel:r.observedModel||null,
        recordedAt:r.recordedAt||null,responseIdRedacted:r.responseId?r.responseId.slice(0,9)+'…':null})),
      noPaidApi:true,noAutomaticRetries:true,noAmazonChanges:true,firstPartyStandaloneOnly:true};
  }
  promptPreview(){return this.exams.map(x=>({id:x.id,roleId:x.roleId,difficulty:x.difficulty,market:x.market,
    prompt:x.prompt,promptSha256:x.promptSha256}));}
  report(){
    const attempts=this.state.results.filter(r=>r.status==='CLIENT_ATTESTED_AWAITING_REVIEW').map(r=>({
      examId:r.id,roleId:r.roleId,market:r.market,difficulty:r.difficulty,
      expectedModel:MODEL,observedModel:r.observedModel,responseId:r.responseId,
      ownerRequestAt:r.reservedAt,responseAt:r.recordedAt,
      ownerPromptSha256:this.exams.find(e=>e.id===r.id)?.promptSha256,
      answer:r.answer,answerSha256:r.answerSha256,
      source:'OWNER_LOCAL_SOL_WORKPLACE_EXAM_SESSION',status:'CLIENT_ATTESTED_AWAITING_INDEPENDENT_REVIEW',
      providerSignatureVerified:false,independentOpenAIVerification:false,
      xhighRequestedByExistingClientContract:true,xhighObservedInReceipt:false,
      certified:false,hasAccessToSellerCentral:false
    }));
    return {version:'P7-B19-EXAM-RECEIPTS-V1',
      kind:'SOL_WORKPLACE_OWNER_CLIENT_ATTESTED_EXAMS_NOT_OPENAI_SIGNED',suite:'P7-B19-FROZEN-28',
      generatedAt:new Date().toISOString(),packDigest:PIN,runId:this.state.runId,status:this.state.status,
      expectedModel:MODEL,reasoningRequested:'xhigh',reasoningObservedIndependently:false,
      verifiedClientPairs:attempts.length,expectedExams:28,
      pendingExams:this.exams.filter(e=>!attempts.some(a=>a.examId===e.id)).map(e=>e.id),attempts,
      passedEvaluations:0,certifiedRoles:0,independentProviderVerification:false,
      userMustReviewBeforeSharing:true,noTokenExport:true};
  }
  async authorize({confirmation,packDigest,maxRequests}={}){
    if(this.starting||this.workerActive||this.siwc.running)err('ANOTHER_SOL_OPERATION_ACTIVE');
    this.starting=true;
    try{
      if(confirmation!=='AUTORIZZO 28 ESAMI'||packDigest!==PIN||maxRequests!==28)err('EXACT_OWNER_SESSION_CONSENT_REQUIRED');
      if(!this.exams.length)err('EXAMS_NOT_INSTALLED');
      if(!['NOT_STARTED','PAUSED_BY_OWNER','PAUSED_AFTER_RESTART','PAUSED_BY_OTHER_REQUEST','BLOCKED_BEFORE_DISPATCH'].includes(this.state.status))err('SESSION_ALREADY_USED_OR_BLOCKED');
      if(this.state.status!=='NOT_STARTED'&&!this.state.runId)err('INVALID_RESUME_STATE');
      if(this.siwc.status().eligibleAppDeclared!==true||this.siwc.status().scopeGranted!==true)err('OWNER_SIWC_GRANT_REQUIRED');
      // Refresh is handled ONLY by the same SIWC app. If the refresh fails: zero new inference.
      await this.siwc.grant();
      if(!this.siwc.status().readyForInference)err('OWNER_SIWC_NOT_READY');
      if(this.state.status==='NOT_STARTED'){this.state=fresh();this.state.runId=randomUUID();this.state.authorizedAt=new Date().toISOString();}
      this.pauseRequested=false;this.state.stopRequested=false;this.state.status='RUNNING';this.state.reason=null;
      await this.persist();
      this.workerActive=true;
      queueMicrotask(()=>{this._work().catch(async()=>{
        this.state.status='BLOCKED_UNCERTAIN';this.state.reason='INTERNAL_ASSESSMENT_WORKER_ERROR_NO_RETRY';
        await this.persist().catch(()=>{});this.workerActive=false;
      });});
      return this.publicStatus();
    }finally{this.starting=false;}
  }
  async stop(){
    if(!this.workerActive||!['RUNNING','STOP_REQUESTED'].includes(this.state.status))err('NO_RUNNING_SESSION');
    this.pauseRequested=true;this.state.stopRequested=true;this.state.status='STOP_REQUESTED';
    await this.persist();return this.publicStatus();
  }
  async _work(){
    try{
      const seen=new Set(this.state.results.map(r=>r.id));
      for(const exam of this.exams){
        if(seen.has(exam.id))continue;
        if(this.pauseRequested){this.state.status='PAUSED_BY_OWNER';this.state.activeExamId=null;await this.persist();return;}
        if(this.siwc.running){this.state.status='PAUSED_BY_OTHER_REQUEST';this.state.reason='SIWC_SINGLE_ACTIVE_REQUEST_ONLY';await this.persist();return;}
        // Ensure each item is recorded BEFORE even attempting a provider request.
        try{await this.siwc.grant();if(!this.siwc.status().readyForInference)err('OWNER_SIWC_NOT_READY');}
        catch{this.state.status='BLOCKED_BEFORE_DISPATCH';this.state.reason='OWNER_SIWC_REFRESH_OR_GRANT_FAILED';await this.persist();return;}
        if(this.pauseRequested){this.state.status='PAUSED_BY_OWNER';await this.persist();return;}
        this.state.activeExamId=exam.id;this.state.status='RUNNING';
        this.state.results.push({id:exam.id,roleId:exam.roleId,market:exam.market,difficulty:exam.difficulty,
          status:'RESERVED_PROVIDER_RESULT_UNKNOWN',reservedAt:new Date().toISOString()});
        await this.persist();
        try{
          const result=await this.siwc.infer({text:exam.prompt,ownerConfirmed:true,source:'OWNER_DIRECT_STANDALONE_UI'});
          if(!validResponse(result))err('UNATTESTED_MODEL_RESULT');
          const row=this.state.results.find(r=>r.id===exam.id);
          Object.assign(row,{status:'CLIENT_ATTESTED_AWAITING_REVIEW',observedModel:result.observedModel,
            responseId:result.responseId,reasoningRequested:'xhigh',reasoningIndependentlyVerified:false,
            answer:JSON.stringify(result.output),answerSha256:sha(JSON.stringify(result.output)),
            recordedAt:new Date().toISOString(),providerSignatureVerified:false,operationalCertification:false});
          this.state.activeExamId=null;
          await this.persist();
        }catch{
          this.state.status='BLOCKED_UNCERTAIN';this.state.reason='PROVIDER_RESULT_UNCERTAIN_NO_RETRY';
          await this.persist();return;
        }
        if(this.pauseRequested){this.state.status='PAUSED_BY_OWNER';await this.persist();return;}
        const count=this.state.results.filter(r=>r.status==='CLIENT_ATTESTED_AWAITING_REVIEW').length;
        if(count<28&&this.waitMs>0)await sleep(this.waitMs);
      }
      this.state.status='COMPLETED_AWAITING_INDEPENDENT_REVIEW';this.state.finishedAt=new Date().toISOString();
      await this.persist();
    }finally{this.workerActive=false;}
  }
}
export const examSessionTestHelpers={validatePack,validResponse,PIN,examOrder,sha};
