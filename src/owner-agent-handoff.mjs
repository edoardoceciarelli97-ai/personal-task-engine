// P7-B17 — bounded, owner-initiated, same-app business-analysis handoff.
// Import a chosen task via the LOCAL MCP tools, ask Sol Workplace once only after
// an explicit gesture, export a DRAFT via MCP only on another explicit gesture.
// NO general-purpose inference proxy, background work, API keys or hidden retries.
import {randomUUID} from 'node:crypto';
import {callLocalMcp} from './mcp-local-client.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES=new Set(['AgenteAnalisi','AgenteCommerciale','AgenteOperations']);
const MAX_PREVIEWS=10, PREVIEW_TTL=5*60*1000;
const fail=msg=>{throw Error(msg)};
const validMarket=m=>{if(m!=='IT'&&m!=='AE')fail('INVALID_MARKET');return m;};
const validUUID=id=>{if(!UUID.test(id||''))fail('INVALID_TASK_ID');return id;};
const outputText=(out)=>{
 const parts=[out.summary];
 for(const [key,label] of [['risks','Rischi'],['actions','Azioni'],['caveats','Limiti']]){
   if(out[key].length)parts.push(label+': '+out[key].slice(0,5).join('; '));
 }
 return parts.join('\n').slice(0,3900);
};
const publicState=h=>({id:h.id,market:h.market,agent:h.agent,taskId:h.taskId,
 state:h.state,summary:h.summary??null,observedModel:h.observedModel??null,
 responseId:h.responseId??null,createdAt:h.createdAt,providerAttestedInSol:h.state==='ATTESTED_LOCAL'||h.state==='EXPORTED_DRAFT'});
export class OwnerAgentHandoff{
 constructor({config,siwc,store,mcpCall=callLocalMcp}={}){
  this.config=config;this.siwc=siwc;this.store=store;this.mcpCall=mcpCall;
  this.previews=new Map();this.busy=false;
 }
 status(){return {configured:this.config?.enabled===true,reason:this.config?.enabled?'OWNER_LOCAL_MCP_CONFIGURED':this.config?.reason||'NOT_CONFIGURED',
  ownerRequestOnly:true,backgroundInference:false,commercialApiFallback:false,proprietaryModelProxy:false};}
 async tool(name,args){if(!this.config?.enabled)fail('LOCAL_MCP_NOT_CONFIGURED');return this.mcpCall(this.config,name,args);}
 async pending(market){validMarket(market);const data=await this.tool('fetch_pending_tasks',{market});
  if(!Array.isArray(data.tasks))fail('MCP_UNTRUSTED_TASK_LIST');
  return {market,tasks:data.tasks.filter(t=>t.market===market&&t.status==='PENDING'&&UUID.test(t.id)&&ROLES.has(t.agent)).slice(0,30)
   .map(t=>({id:t.id,market,agent:t.agent,prompt:String(t.prompt||'').slice(0,4000),revision:t.revision,channel:t.channel,origin:t.origin})),modelCalls:0};
 }
 async preview({market,taskId,expectedRevision}){
  validMarket(market);validUUID(taskId);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION');
  const data=await this.tool('read_task_status',{market,taskId});
  const t=data?.task;
  if(!t||t.id!==taskId||t.market!==market||t.status!=='PENDING'||t.revision!==expectedRevision||!ROLES.has(t.agent))fail('TASK_NOT_READY_FOR_OWNER');
  if(typeof t.prompt!=='string'||t.prompt.length<1||t.prompt.length>4000)fail('TASK_TEXT_INVALID');
  const products=await this.tool('read_product_context',{market,limit:12});
  if(products?.market!==market||products?.verifiedWithAmazon!==false||!Array.isArray(products.rows)||products.rows.length>12)fail('MCP_CONTEXT_NOT_TRUSTED');
  // Include ONLY low-sensitivity product fields and explicit source caveats.
  const snapshot={kind:'OWNER_SELECTED_AGENT_TASK',task:{id:t.id,agent:t.agent,market,revision:t.revision,request:t.prompt},
   productContext:{market,currency:market==='IT'?'EUR':'AED',source:'LOCAL_MANUAL_UNVERIFIED',
     rows:products.rows.map(p=>({sku:p.sku,title:p.title,stock:p.stock,sellingPrice:p.sellingPrice,landedCost:p.landedCost}))},
   isSellerCentralVerified:false,authorization:'OWNER_EXPLICIT_SINGLE_TASK_ONLY'};
  if(JSON.stringify(snapshot).length>32000)fail('MCP_CONTEXT_TOO_LARGE');
  const id=randomUUID();
  for(const [k,v] of this.previews)if(v.expiresAt<Date.now())this.previews.delete(k);
  if(this.previews.size>=MAX_PREVIEWS)this.previews.delete(this.previews.keys().next().value);
  this.previews.set(id,{snapshot,market,taskId,agent:t.agent,revision:expectedRevision,expiresAt:Date.now()+PREVIEW_TTL});
  return {previewId:id,market,agent:t.agent,taskId,revision:t.revision,taskText:t.prompt,
   products:snapshot.productContext.rows,expiresAt:new Date(Date.now()+PREVIEW_TTL).toISOString(),
   verifiedWithAmazon:false,modelCalls:0,willCreateDraftAutomatically:false};
 }
 async analyze({previewId,ownerConfirmed=false}){
  validUUID(previewId);if(ownerConfirmed!==true)fail('OWNER_ANALYSIS_CONFIRMATION_REQUIRED');
  if(this.busy)fail('ONLY_ONE_OWNER_AGENT_ACTION');
  const pre=this.previews.get(previewId);
  if(!pre||pre.expiresAt<=Date.now())fail('PREVIEW_EXPIRED');
  if(!this.siwc.status().readyForInference)fail('SIWC_NOT_READY');
  this.previews.delete(previewId);
  this.busy=true;
  const id=randomUUID();
  try{
   // Revalidate immediately before dispatch. Never infer on a stale/rejected task.
   const current=(await this.tool('read_task_status',{market:pre.market,taskId:pre.taskId})).task;
   if(!current||current.status!=='PENDING'||current.revision!==pre.revision||current.agent!==pre.agent)fail('TASK_CHANGED_BEFORE_INFERENCE');
   const createdAt=new Date().toISOString();
   await this.store.mutate(s=>{s.handoffs??=[];s.handoffs.push({id,market:pre.market,taskId:pre.taskId,
    revision:pre.revision,agent:pre.agent,state:'MODEL_REQUEST_UNCERTAIN_NO_RETRY',createdAt});s.handoffs=s.handoffs.slice(-50)});
   // Only the connected Sol Workplace app makes the SIWC request, directly
   // after an action in its own UI, with a bounded owner-selected context.
   let result;
   try{
    result=await this.siwc.infer({text:`Analizza questo singolo incarico per ${pre.agent}. Basa le conclusioni esclusivamente sui dati inclusi nel contesto allegato e segnala i dati mancanti.`,
     snapshot:pre.snapshot,ownerConfirmed:true,source:'OWNER_SELECTED_LOCAL_MCP_TASK'});
   }catch{return {handoffId:id,state:'MODEL_REQUEST_UNCERTAIN_NO_RETRY',automaticRetry:false,postedToOffice:false};}
   if(result?.completed!==true||result.observedModel!=='gpt-6.1-sol'||!/^resp_[A-Za-z0-9_-]{1,200}$/.test(result.responseId||''))
    return {handoffId:id,state:'MODEL_REQUEST_UNCERTAIN_NO_RETRY',automaticRetry:false,postedToOffice:false};
   const summary=outputText(result.output);
   await this.store.mutate(s=>{const h=s.handoffs.find(x=>x.id===id);if(h){Object.assign(h,{state:'ATTESTED_LOCAL',summary,observedModel:result.observedModel,responseId:result.responseId,output:result.output});}
    s.messages.push({id:randomUUID(),at:new Date().toISOString(),role:'assistant',state:'SOL_RESPONSE_ATTESTED',text:summary,
     observedModel:result.observedModel,responseId:result.responseId,agentTaskId:pre.taskId});s.messages=s.messages.slice(-200);
   });
   return {handoffId:id,state:'ATTESTED_LOCAL',observedModel:result.observedModel,responseId:result.responseId,
    summary,postedToOffice:false,ownerExportRequired:true};
  }finally{this.busy=false;}
 }
 async exportDraft({handoffId,ownerConfirmed=false}){
  validUUID(handoffId);if(ownerConfirmed!==true)fail('OWNER_EXPORT_CONFIRMATION_REQUIRED');
  if(this.busy)fail('ONLY_ONE_OWNER_AGENT_ACTION');
  this.busy=true;
  try{
   const data=await this.store.view(),h=data.handoffs?.find(x=>x.id===handoffId);
   if(!h||h.state!=='ATTESTED_LOCAL'||!h.summary||h.observedModel!=='gpt-6.1-sol')fail('ATTESTED_LOCAL_HANDOFF_REQUIRED');
   const current=(await this.tool('read_task_status',{market:h.market,taskId:h.taskId})).task;
   if(!current||current.status!=='PENDING'||current.revision!==h.revision||current.agent!==h.agent)fail('OFFICE_TASK_CHANGED');
   await this.store.mutate(s=>{const row=s.handoffs.find(x=>x.id===handoffId);row.state='EXPORT_UNCERTAIN_NO_RETRY';});
   // Stable idempotency key survives a lost response; never auto-retry a write.
   try{
    const receipt=await this.tool('post_agent_response',{taskId:h.taskId,agent:h.agent,text:h.summary,
     expectedRevision:h.revision,idempotencyKey:'sol-owner-handoff-'+handoffId});
    if(receipt.status!=='DRAFT_SUBMITTED'||receipt.published!==false||receipt.ownerReviewRequired!==true)fail('UNEXPECTED_MCP_WRITE_RECEIPT');
    await this.store.mutate(s=>{const row=s.handoffs.find(x=>x.id===handoffId);Object.assign(row,{state:'EXPORTED_DRAFT',draftMessageId:receipt.draftMessageId});});
    return {handoffId,state:'EXPORTED_DRAFT',draftMessageId:receipt.draftMessageId,requiresOwnerApprovalInOffice:true,
     providerAttestedInOffice:false,noAutomaticAmazonChanges:true};
   }catch{return {handoffId,state:'EXPORT_UNCERTAIN_NO_RETRY',automaticRetry:false,
      advise:'Do not retry without checking the Office task status.'};}
  }finally{this.busy=false;}
 }
 async history(){const data=await this.store.view();return {handoffs:(data.handoffs||[]).slice(-30).reverse().map(publicState),modelCalls:0};}
 async reconcileExport({handoffId}){
  validUUID(handoffId);
  const data=await this.store.view(),h=data.handoffs?.find(x=>x.id===handoffId);
  if(!h||h.state!=='EXPORT_UNCERTAIN_NO_RETRY')fail('NOT_AN_UNCERTAIN_EXPORT');
  const task=(await this.tool('read_task_status',{market:h.market,taskId:h.taskId})).task;
  if(task?.status==='DRAFT_SUBMITTED'){
   await this.store.mutate(s=>{const row=s.handoffs.find(x=>x.id===handoffId);row.state='EXPORTED_DRAFT';row.draftMessageId=task.draftMessageId;});
   return {state:'EXPORTED_DRAFT',reconciled:true,draftMessageId:task.draftMessageId,noNewWrite:true};
  }
  return {state:'EXPORT_UNCERTAIN_NO_RETRY',noNewWrite:true,taskStatus:task?.status||'UNKNOWN'};
 }
}
