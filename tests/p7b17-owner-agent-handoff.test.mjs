import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnerAgentHandoff} from '../src/owner-agent-handoff.mjs';
import {localMcpConfig} from '../src/mcp-local-client.mjs';
const id='11111111-1111-4111-8111-111111111111';
const task={id,market:'IT',agent:'AgenteAnalisi',prompt:'Analizza dati dichiarati',status:'PENDING',revision:1};
function stub({modelReady=true}={}){
 let calls=[];
 const mcpCall=async(_config,name,args)=>{calls.push([name,args]);if(name==='fetch_pending_tasks')return {tasks:[task]};
  if(name==='read_task_status')return {task};
  if(name==='read_product_context')return {market:'IT',verifiedWithAmazon:false,rows:[]};
  throw Error('UNEXPECTED_STUB_WRITE');};
 const store={value:{handoffs:[],messages:[]},async view(){return structuredClone(this.value)},async mutate(fn){return fn(this.value)}};
 const siwc={status:()=>({readyForInference:modelReady}),infer:async()=>{throw Error('SYNTHETIC_PROVIDER_IS_NEVER_CALLED_WITHOUT_OWNER_CLICK')}};
 const b=new OwnerAgentHandoff({config:{enabled:true},siwc,store,mcpCall});return {b,calls,store};
}
test('P7-B17 local MCP bridge is disabled without explicit absolute owner paths',()=>{
 assert.equal(localMcpConfig({}).enabled,false);
 assert.equal(localMcpConfig({SOL_WORKPLACE_AGENT_MCP_ENTRY:'/tmp/evienza/mcp-stdio.mjs',SOL_WORKPLACE_AGENT_DB_PATH:'/tmp/data.sqlite'}).enabled,false);
});
test('P7-B17 pending tasks and preview cause zero model calls and preserve market boundaries',async()=>{
 const s=stub();const p=await s.b.pending('IT');assert.equal(p.tasks.length,1);
 const x=await s.b.preview({market:'IT',taskId:id,expectedRevision:1});assert.equal(x.modelCalls,0);
 assert.equal(x.willCreateDraftAutomatically,false);
 await assert.rejects(s.b.analyze({previewId:x.previewId,ownerConfirmed:false}),/OWNER_ANALYSIS_CONFIRMATION_REQUIRED/);
 assert.deepEqual(s.calls.map(x=>x[0]),['fetch_pending_tasks','read_task_status','read_product_context']);
});
test('P7-B17 no SIWC grant must not dispatch to the model',async()=>{
 const s=stub({modelReady:false});const x=await s.b.preview({market:'IT',taskId:id,expectedRevision:1});
 await assert.rejects(s.b.analyze({previewId:x.previewId,ownerConfirmed:true}),/SIWC_NOT_READY/);
});
test('P7-B17 raw text or cross-market task IDs cannot bypass selection gate',async()=>{
 const s=stub();await assert.rejects(s.b.preview({market:'AE',taskId:id,expectedRevision:1}),/TASK_NOT_READY_FOR_OWNER/);
 await assert.rejects(s.b.preview({market:'IT',taskId:'../../secrets',expectedRevision:1}),/INVALID_TASK_ID/);
 await assert.rejects(s.b.exportDraft({handoffId:id,ownerConfirmed:true}),/ATTESTED_LOCAL_HANDOFF_REQUIRED/);
});
