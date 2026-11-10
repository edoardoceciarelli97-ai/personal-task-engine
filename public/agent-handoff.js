'use strict';
const $=id=>document.getElementById(id);
const el=(tag,content,cls='')=>{const e=document.createElement(tag);e.textContent=content??'';if(cls)e.className=cls;return e};
let nonce='',ready=false,selection=null,handoffId=null,busy=false;
async function get(u){const r=await fetch(u,{cache:'no-store',credentials:'omit'});const data=await r.json();if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data;}
async function post(u,data){if(!nonce)throw Error('LOCAL_SESSION_NOT_READY');const r=await fetch(u,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Owner-Action':nonce},body:JSON.stringify(data)});const out=await r.json();if(!r.ok)throw Error(out.error||'HTTP '+r.status);return out;}
const explain=e=>String(e?.message||'Operazione non disponibile').replace(/[^A-Za-z0-9_ .-]/g,'').slice(0,100);
function locked(on){busy=on;$('load').disabled=on||!ready;$('analyze').disabled=on||!selection||!ready;$('export').disabled=on||!handoffId||!ready;$('history').disabled=on;}
async function connect(){try{
 const [c,s]=await Promise.all([get('/api/agent-handoff/status'),get('/api/session')]);
 if(typeof s.nonce!=='string'||s.nonce.length<32)throw Error('SESSION_REQUIRED');nonce=s.nonce;ready=c.configured&&c.grantReady;
 $('status').textContent=c.configured?(c.grantReady?'MCP locale pronto · accesso Sol valido':'MCP pronto ma SIWC non disponibile'):'MCP locale non configurato su questo computer';
 locked(false);
 }catch(e){ready=false;locked(false);$('status').textContent='Impossibile verificare: '+explain(e);}}
async function load(){if(busy||!ready)return;locked(true);try{
 const market=$('market').value;const d=await get('/api/agent-handoff/pending?market='+encodeURIComponent(market));const area=$('tasks');area.replaceChildren();
 for(const t of d.tasks){const b=el('article','','task');b.append(el('strong',t.agent+' · '+market+' · revisione '+t.revision),el('p',t.prompt));const btn=el('button','Seleziona incarico');btn.type='button';btn.addEventListener('click',()=>preview(t));b.append(btn);area.append(b);}
 if(!d.tasks.length)area.append(el('p','Nessun incarico pendente. Crea un @AgenteAnalisi dall’Ufficio agenti di Amazon OS.','hint'));
 }catch(e){$('tasks').replaceChildren(el('p','Lettura non riuscita: '+explain(e)));}finally{locked(false)}}
async function preview(t){if(busy)return;locked(true);selection=null;handoffId=null;try{
 const d=await post('/api/agent-handoff/preview',{market:t.market,taskId:t.id,expectedRevision:t.revision});
 selection=d.previewId;const area=$('preview');area.replaceChildren(el('p','Incarico: '+d.taskText),el('p','Ruolo: '+d.agent+' · Dati locali NON verificati con Amazon.'));
 const table=el('table',''),head=document.createElement('tr');for(const k of ['SKU','Prodotto','Scorte','Prezzo','Costo'])head.append(el('th',k));table.append(head);
 for(const p of d.products){const tr=document.createElement('tr');for(const k of ['sku','title','stock','sellingPrice','landedCost'])tr.append(el('td',p[k]===null?'mancante':String(p[k]??'')));table.append(tr);}area.append(table);
 }catch(e){$('preview').textContent='Anteprima non disponibile: '+explain(e);}finally{locked(false)}}
async function analyze(){if(busy||!selection||!ready)return;locked(true);const id=selection;selection=null;handoffId=null;$('answer').textContent='Richiesta singola in corso; non chiudere questa scheda né ripetere l’invio…';try{
 const r=await post('/api/agent-handoff/analyze',{previewId:id,ownerConfirmed:true});
 if(r.state==='ATTESTED_LOCAL'){handoffId=r.handoffId;$('answer').replaceChildren(el('p','Modello osservato: '+r.observedModel+' · risposta '+r.responseId),el('div',r.summary,'result'));}
 else $('answer').textContent='Risposta non attestata. Stato: '+r.state+'. NON ripetere la richiesta.';
 }catch(e){$('answer').textContent='Esito non verificabile: '+explain(e)+'. NON ripetere. Controlla lo storico.';}finally{locked(false);await history()}}
async function exportDraft(){if(busy||!handoffId||!ready)return;locked(true);const id=handoffId;handoffId=null;try{
 const r=await post('/api/agent-handoff/export',{handoffId:id,ownerConfirmed:true});
 $('answer').append(el('p',r.state==='EXPORTED_DRAFT'?'Bozza salvata. Apri Amazon OS, verifica e approva il compito.':'Esportazione incerta: NON ripetere. Controlla lo storico.'));
 }catch(e){$('answer').append(el('p','Esportazione non verificabile: '+explain(e)+'. Non ripetere.'));}finally{locked(false);await history()}}
async function history(){try{const d=await get('/api/agent-handoff/history');const area=$('receipts');area.replaceChildren();for(const h of d.handoffs){const b=el('article','','receipt');b.append(el('strong',h.agent+' · '+h.market+' · '+h.state),el('p',h.summary||'Nessuna risposta attestata.'));if(h.state==='ATTESTED_LOCAL'){
 const btn=el('button','Esporta bozza confermando');btn.addEventListener('click',()=>{handoffId=h.id;exportDraft();});b.append(btn);
 }if(h.state==='EXPORT_UNCERTAIN_NO_RETRY'){const btn=el('button','Verifica senza ripetere');btn.addEventListener('click',async()=>{try{await post('/api/agent-handoff/reconcile',{handoffId:h.id});await history();}catch(e){b.append(el('p','Impossibile verificare: '+explain(e)))}});b.append(btn);}area.append(b);}if(!d.handoffs.length)area.append(el('p','Nessuna inferenza da incarichi registrata.','hint'));
 }catch(e){$('receipts').textContent='Storico non leggibile: '+explain(e)}}
$('load').addEventListener('click',load);$('analyze').addEventListener('click',analyze);$('export').addEventListener('click',exportDraft);$('history').addEventListener('click',history);
$('market').addEventListener('change',()=>{$('tasks').replaceChildren();selection=null;locked(false)});
await connect();await history();
