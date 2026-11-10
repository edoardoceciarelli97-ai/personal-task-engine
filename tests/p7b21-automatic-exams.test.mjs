import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {OwnerExamSession,examSessionTestHelpers as h} from '../src/owner-exam-session.mjs';
const roleOrder=['director','research','listing','ads','operations','finance','compliance'];
const levels=['simple','intermediate','complex','critical'];
const fakeExams=()=>roleOrder.flatMap(role=>levels.map(level=>({id:`${role}-${level}`,roleId:role,market:'IT',difficulty:level,prompt:`Owner test ${role}-${level}`})));
function setup(t,{failAt=null,holdFirst=null,statusConnected=true}={}){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'assessment-test-'));fs.chmodSync(dir,0o700);
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const calls=[];
 const siwc={running:false,
  status:()=>({eligibleAppDeclared:statusConnected,scopeGranted:statusConnected,readyForInference:statusConnected}),
  grant:async()=>{if(!statusConnected)throw Error('NOT_CONNECTED')},
  infer:async({text,ownerConfirmed,source})=>{
    assert.equal(ownerConfirmed,true);assert.equal(source,'OWNER_DIRECT_STANDALONE_UI');calls.push(text);
    if(holdFirst&&calls.length===1)await holdFirst.promise;
    if(failAt===calls.length)throw Error('PROVIDER_UNCERTAIN_SYNTHETIC');
    const output={summary:'Risposta di prova. Nessun dato verificato.',risks:[],actions:['Verificare dati'],caveats:['Solo test sintetico']};
    return {completed:true,observedModel:'gpt-6.1-sol',reasoningRequested:'xhigh',
      responseId:'resp_synthetic_'+calls.length,output};
  }
 };
 const s=new OwnerExamSession({stateDir:dir,packFile:path.join(dir,'pack.json'),siwc,waitMs:0});
 s.exams=fakeExams();return {s,calls,dir,siwc};
}
const consent={confirmation:'AUTORIZZO 28 ESAMI',packDigest:h.PIN,maxRequests:28};
async function until(session,states,timeout=5000){
 const stop=Date.now()+timeout;
 while(Date.now()<stop){if(states.includes(session.state.status)&&!session.workerActive)return;await new Promise(r=>setTimeout(r,15));}
 throw Error('SYNTHETIC_TEST_TIMED_OUT: '+session.state.status);
}
test('P7-B21 the exam pack pin refuses arbitrary or changed user inputs',()=>{
 assert.throws(()=>h.validatePack({version:'P7B19-FROZEN-28',contentSha256:h.PIN,exams:fakeExams()}),/OWNER_EXAM_PACK_DIGEST_MISMATCH/);
 assert.equal(h.examOrder.length,28);assert.equal(new Set(h.examOrder).size,28);
});
test('P7-B21 denied without exact one-session owner consent, no inference',async(t)=>{
 const {s,calls}=setup(t);for(const i of [undefined,{...consent,confirmation:'SI'},{...consent,maxRequests:29},{...consent,packDigest:'0'.repeat(64)}])await assert.rejects(s.authorize(i));assert.equal(calls.length,0);
});
test('P7-B21 all 28 tests proceed in serial, with original receipt and no automatic certification',async(t)=>{
 const {s,calls,dir}=setup(t);await s.authorize(consent);await until(s,['COMPLETED_AWAITING_INDEPENDENT_REVIEW']);
 assert.equal(calls.length,28);assert.equal(new Set(calls).size,28);assert.equal(s.publicStatus().completed,28);
 const report=s.report();assert.equal(report.attempts.length,28);assert.equal(report.certifiedRoles,0);assert.equal(report.independentProviderVerification,false);
 assert.equal(report.attempts[0].observedModel,'gpt-6.1-sol');assert.match(report.attempts[0].responseId,/^resp_/);
 assert.equal(JSON.stringify(report).includes('refreshToken'),false);
 assert.equal(fs.statSync(path.join(dir,'owner-exam-session.json')).mode&0o077,0);
 await assert.rejects(s.authorize(consent),/SESSION_ALREADY_USED_OR_BLOCKED/);
});
test('P7-B21 stop during live request pauses after exactly one response; no duplicate when resumed',async(t)=>{
 let release;const first={promise:new Promise(r=>{release=r})};
 const {s,calls}=setup(t,{holdFirst:first});await s.authorize(consent);
 while(!s.state.activeExamId)await new Promise(r=>setTimeout(r,2));
 await s.stop();release();await until(s,['PAUSED_BY_OWNER']);
 assert.equal(calls.length,1);assert.equal(s.publicStatus().completed,1);
 await s.authorize(consent);await until(s,['COMPLETED_AWAITING_INDEPENDENT_REVIEW']);
 assert.equal(calls.length,28);assert.equal(new Set(calls).size,28);
});
test('P7-B21 uncertain model response stops without retry and blocks another start',async(t)=>{
 const {s,calls}=setup(t,{failAt:3});await s.authorize(consent);await until(s,['BLOCKED_UNCERTAIN']);
 assert.equal(calls.length,3);assert.equal(s.publicStatus().completed,2);
 assert.equal(s.state.results[2].status,'RESERVED_PROVIDER_RESULT_UNKNOWN');
 await assert.rejects(s.authorize(consent),/SESSION_ALREADY_USED_OR_BLOCKED/);
});
test('P7-B21 denies session when SIWC is not ready',async(t)=>{
 const {s,calls}=setup(t,{statusConnected:false});await assert.rejects(s.authorize(consent),/OWNER_SIWC_GRANT_REQUIRED/);assert.equal(calls.length,0);
});
test('P7-B21 concurrent start requests only authorize one session',async(t)=>{
 const {s}=setup(t);const results=await Promise.allSettled([s.authorize(consent),s.authorize(consent)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 await until(s,['COMPLETED_AWAITING_INDEPENDENT_REVIEW']);
});
test('P7-B21 public status redacts the full provider response identifier',async(t)=>{
 const {s}=setup(t);await s.authorize(consent);await until(s,['COMPLETED_AWAITING_INDEPENDENT_REVIEW']);
 assert.ok(s.publicStatus().results[0].responseIdRedacted.endsWith('…'));
 assert.ok(!JSON.stringify(s.publicStatus()).includes('resp_synthetic_1'));
});
