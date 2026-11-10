import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineSolRequest, getP7B9Readiness, verifySyntheticSolTerminal} from '../src/p7b9-provider-contract.mjs';
test('P7-B9 fixture request is exact model and xhigh without a paid fallback',()=>{
 const req=buildOfflineSolRequest({instruction:'Rispondi in JSON.',userPrompt:'Verifica uno SKU.',inputSnapshot:{market:'AE',verified:false}});
 assert.equal(req.model,'gpt-6.1-sol');assert.deepEqual(req.reasoning,{effort:'xhigh'});
 assert.equal(req.store,false); assert.equal(req.stream,true); assert.deepEqual(req.tools,[]);
 assert.ok(!JSON.stringify(req).includes('api_key'));
 assert.ok(JSON.stringify(req).includes('NOT_ATTESTED'));
});
test('P7-B9 invalid prompt, snapshot, or instruction never builds a dispatch',()=>{
 assert.throws(()=>buildOfflineSolRequest({instruction:'',userPrompt:'hello'}));
 assert.throws(()=>buildOfflineSolRequest({instruction:'A',userPrompt:''}));
 assert.throws(()=>buildOfflineSolRequest({instruction:'A',userPrompt:'B',inputSnapshot:['not object']}));
});
test('P7-B9 no terminal event or wrong provider model is accepted',()=>{
 for(const event of [{type:'response.failed',response:{status:'failed',model:'gpt-6.1-sol'}},
 {type:'response.completed',response:{status:'completed',model:'gpt-6.1-terra',id:'resp_mock',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]}},
 {type:'response.completed',response:{status:'completed',id:'resp_mock',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]}}])
   assert.throws(()=>verifySyntheticSolTerminal(event));
});
test('P7-B9 terminal verification is test-only, not a provider receipt',()=>{
 const synthetic={type:'response.completed',response:{status:'completed',model:'gpt-6.1-sol',id:'resp_fixture_only',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}};
 assert.deepEqual(verifySyntheticSolTerminal(synthetic),{observedModel:'gpt-6.1-sol',responseId:'resp_fixture_only',completed:true});
});
test('P7-B9 embedded proprietary Office is never auto-admitted',()=>{
 const g=getP7B9Readiness();
 assert.equal(g.planConnected,false);assert.equal(g.canStartOAuth,false);assert.equal(g.canSendToSol,false);assert.equal(g.independentAppPublished,false);
 assert.equal(g.canStartBackgroundTasks,false);assert.equal(g.externalPaidApiEnabled,false);
 assert.match(g.providerEligibility,/NOT_ATTESTED/);
});
