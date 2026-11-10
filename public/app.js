'use strict';
const $=x=>document.getElementById(x);
let nonce='',selection=null,lastFile=null;
function node(tag,cls,content){const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=content;return el;}
async function get(url){const res=await fetch(url,{credentials:'omit',cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);return res.json();}
async function post(url,obj){const res=await fetch(url,{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json','X-Owner-Action':nonce},body:JSON.stringify(obj)});const data=await res.json();if(!res.ok)throw Error(data.error||'HTTP '+res.status);return data;}
function showMessages(messages){const div=$('conversation');div.replaceChildren();if(!messages.length){const el=node('div','empty');el.append(node('div','empty-icon','✧'),node('h2','','La tua conversazione inizia qui'),node('p','','Salva le tue richieste: resteranno bozze private, senza essere inviate a Sol.'));div.append(el);return;}for(const msg of messages){const el=node('div','msg');const flag=msg.state==='SOL_RESPONSE_ATTESTED'?'RISPOSTA SOL · MODELLO VERIFICATO':msg.state==='SOL_REQUEST_UNCERTAIN_NO_RETRY'?'INVIO INCERTO · NON RIPETERE':msg.state==='SOL_REQUEST_RESERVED'?'RICHIESTA IN CORSO':msg.state==='SOL_REQUEST_COMPLETED'?'RICHIESTA COMPLETATA':'BOZZA · NON INVIATA';el.append(node('div','flag',flag),node('div','text',msg.text),node('small','',new Date(msg.at).toLocaleString('it-IT')));if(msg.state==='SOL_RESPONSE_ATTESTED'&&msg.output){for(const k of ['risks','actions','caveats']){const arr=msg.output[k];if(Array.isArray(arr)&&arr.length){el.append(node('strong','',({risks:'Rischi',actions:'Azioni suggerite',caveats:'Limiti'})[k]));for(const item of arr.slice(0,20))el.append(node('div','text','• '+item));}}}div.append(el);}div.scrollTop=div.scrollHeight;}
function showSnapshots(data){const select=$('snapshot-select');const previous=select.value;select.replaceChildren();select.append(node('option','','Seleziona snapshot…'));select.options[0].value='';for(const s of data.snapshots){const el=node('option','',`${s.market} · ${s.asOf.slice(0,10)} · ${s.count} SKU`);el.value=s.id;select.append(el);}select.value=previous&&data.snapshots.some(s=>s.id===previous)?previous:(data.snapshots.at(-1)?.id||'');$('check').disabled=!select.value;}
async function refresh(){
 const status=await get('/api/status');
 const gate=await get('/api/siwc/readiness');
 if(status.extraApiBilling)throw Error('PAID_API_FORBIDDEN');
 $('connection').textContent=status.planConnected?'ChatGPT collegato':'Sol non connesso';
 $('p7b9-gate-status').textContent=gate.canStartOAuth?
   (gate.planConnected?'Accesso personale presente. Verifica il modello con una richiesta esplicita.':'Applicazione OSS dichiarata: puoi effettuare il login personale.'):
   'Il client OSS autonomo non risulta ancora pubblicato e verificato. Nessuna richiesta AI consentita.';
 $('login').disabled=!gate.canStartOAuth||status.planConnected;
 $('send').disabled=!gate.canSendToSol;
 $('verification').textContent=status.liveInference?'Risposta autentica di Sol registrata nel client.':'Nessuna risposta Sol autentica registrata. API a consumo disattivate.';
 const data=await get('/api/data');showMessages(data.messages);showSnapshots(data);
 if(!nonce){const auth=await get('/api/session');nonce=auth.nonce;}
}
$('refresh').addEventListener('click',async()=>{try{await refresh()}catch{$('verification').textContent='Stato non verificabile: operazioni sospese.'}});
$('login').addEventListener('click',async()=>{
 const spot=$('oauth-link');spot.replaceChildren();
 try{if(!nonce)throw Error('NO_SESSION');
  const res=await post('/api/oauth/start',{});
  const u=new URL(res.authorizationUrl);
  if(u.origin!=='https://auth.openai.com')throw Error('WRONG_OAUTH_HOST');
  const a=node('a','','Apri il consenso ufficiale ChatGPT in una nuova scheda');
  a.href=u.toString();a.target='_blank';a.rel='noopener noreferrer';spot.append(a);
 }catch{spot.textContent='Login non avviato: verifica il client open source e riprova.';}
});
$('send').addEventListener('click',async()=>{
 const original=$('message').value;
 if(!original.trim()){$('composer-info').textContent='Inserisci una richiesta prima di inviarla.';return;}
 try{
  if(!nonce)throw Error('NO_SESSION');
  $('send').disabled=true;
  $('composer-info').textContent='Una sola richiesta diretta a Sol: nessun retry automatico.';
  const response=await post('/api/sol/send',{text:original,snapshotId:$('snapshot-select').value||'',ownerConfirmed:true});
  if(response.state!=='SOL_RESPONSE_ATTESTED'||response.observedModel!=='gpt-6.1-sol')throw Error('UNVERIFIED');
  $('message').value='';$('composer-info').textContent='Risposta diretta verificata e salvata.';
  await refresh();
 }catch{$('composer-info').textContent='Nessuna risposta Sol verificata. Testo conservato: controlla lo stato prima di riprovare.';}
 finally{await refresh().catch(()=>{});}
});
$('save').addEventListener('click',async()=>{const value=$('message').value;if(!value.trim()){$('composer-info').textContent='Scrivi prima la richiesta.';return;}try{if(!nonce)throw Error();await post('/api/messages',{text:value});$('message').value='';$('composer-info').textContent='Bozza salvata, non inviata a OpenAI.';await refresh();}catch{$('composer-info').textContent='Salvataggio fallito: messaggio conservato nell’editor.';}});
$('file').addEventListener('change',()=>{lastFile=$('file').files?.[0]||null;$('import').disabled=!lastFile;$('import-info').textContent=lastFile?`Selezionato: ${lastFile.name} (${lastFile.size} byte)`:'Nessun file selezionato';});
$('import').addEventListener('click',async()=>{if(!lastFile)return;if(lastFile.size>40_000){$('import-info').textContent='File troppo grande (max 40 KB)';return;}try{const data=JSON.parse(await lastFile.text());const saved=await post('/api/snapshots',data);$('import-info').textContent=`Importato ${saved.count} SKU ${saved.market}. Dati NON verificati con Amazon.`;await refresh();$('snapshot-select').value=saved.id;$('check').disabled=false;}catch{$('import-info').textContent='Importazione respinta: utilizzare solo il formato JSON previsto, senza credenziali.';}});
$('snapshot-select').addEventListener('change',()=>{$('check').disabled=!$('snapshot-select').value;});
$('check').addEventListener('click',async()=>{const id=$('snapshot-select').value;if(!id)return;try{const res=await post('/api/check-local',{snapshotId:id});const area=$('signals');area.replaceChildren();if(!res.cards.length){area.append(node('div','minor','Nessun segnale dalle regole locali; non è una verifica Amazon.'));return;}const title=node('div','minor',`${res.summary.total} segnali locali (NON analisi Sol)`);area.append(title);for(const c of res.cards.slice(0,30)){const box=node('div','signal');box.append(node('strong','',`${c.evidence.sku} · ${c.code}`),node('span','',c.detail));area.append(box);}}catch{$('signals').textContent='Controllo non disponibile. Nessun invio AI tentato.';}});
refresh().catch(()=>{$('connection').textContent='Servizio non disponibile';$('verification').textContent='Disconnesso. Nessun invio AI.';});
