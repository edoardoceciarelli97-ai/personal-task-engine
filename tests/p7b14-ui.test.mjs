import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const style=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
function mockDom({connected=true,ready=true}={}){
 const ids=['message','send','save','login','refresh','connection','p7b9-gate-status','verification','refresh-feedback','mode-status','conversation','snapshot-select','check','composer-info','oauth-link','file','import','import-info','snapshot-select','signals'];
 const nodes={};
 for(const id of ids){nodes[id]={id,value:'',disabled:id==='send',textContent:'',listeners:{},attributes:{},options:[{value:''}],classList:{toggle(k,v){this[k]=v;}},setAttribute(k,v){this.attributes[k]=v;},replaceChildren(){},append(){},addEventListener(k,fn){this.listeners[k]=fn;}};}
 const calls=[];
 const responses={
  '/api/status':{planConnected:connected,extraApiBilling:false,liveInference:false},
  '/api/siwc/readiness':{planConnected:connected,canSendToSol:ready,canStartOAuth:connected},
  '/api/data':{messages:[],snapshots:[],cards:[]},
  '/api/session':{nonce:'a'.repeat(64)},
 };
 const fetch=async(url,opts={})=>{calls.push({url,opts});return {ok:true,json:async()=>responses[url]||{}}};
 const document={getElementById:id=>nodes[id],createElement:tag=>({tag,textContent:'',value:'',append(){},attributes:{},setAttribute(){}})};
 const context={document,fetch,Date,URL,console,Promise};
 vm.createContext(context);vm.runInContext(source,context);
 return {nodes,calls,wait:async()=>{await new Promise(r=>setTimeout(r,8));}};
}
test('P7-B14 send requires grant plus explicit written prompt; refresh returns visible status',async()=>{
 const {nodes,wait}=mockDom();await wait();
 assert.equal(nodes['send'].disabled,true,'empty message must not be sent');
 assert.match(nodes['refresh-feedback'].textContent,/Scrivi una richiesta/);
 assert.match(nodes['mode-status'].textContent,/ACCESSO PRONTO/);
 nodes['message'].value='Richiesta test locale';nodes['message'].listeners.input();
 assert.equal(nodes['send'].disabled,false);
 assert.match(nodes['send'].textContent,/GPT-6.1 Sol/);
 await nodes['refresh'].listeners.click();
 assert.match(nodes['refresh-feedback'].textContent,/Stato aggiornato alle/);
 assert.equal(nodes['refresh'].disabled,false);
});
test('P7-B14 disconnected or missing authorization never enables send',async()=>{
 for(const o of [{connected:false,ready:false},{connected:true,ready:false}]){
  const {nodes,wait}=mockDom(o);await wait();
  nodes['message'].value='Test';nodes['message'].listeners.input();
  assert.equal(nodes['send'].disabled,true);
 }
});
test('P7-B14 actual styling distinguishes enabled from disabled and dynamic status is in DOM',()=>{
 assert.match(style,/#send:not\(:disabled\)/);
 assert.match(style,/#send:disabled/);
 assert.match(html,/id="refresh-feedback"/);
 assert.match(html,/id="mode-status"/);
});
