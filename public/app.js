'use strict';
const $=x=>document.getElementById(x);
let nonce='',selection=null,lastFile=null,readyForSol=false,sendInProgress=false;
function node(tag,cls,content){const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=content;return el;}
async function get(url){const res=await fetch(url,{credentials:'omit',cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);return res.json();}
async function post(url,obj){const res=await fetch(url,{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json','X-Owner-Action':nonce},body:JSON.stringify(obj)});const data=await res.json();if(!res.ok)throw Error(data.error||'HTTP '+res.status);return data;}
function showMessages(messages){const div=$('conversation');div.replaceChildren();if(!messages.length){const el=node('div','empty');el.append(node('div','empty-icon','✧'),node('h2','','La tua conversazione inizia qui'),node('p','','Salva le tue richieste: resteranno bozze private, senza essere inviate a Sol.'));div.append(el);return;}for(const msg of messages){const el=node('div','msg');const flag=msg.state==='SOL_RESPONSE_ATTESTED'?'RISPOSTA SOL · MODELLO VERIFICATO':msg.state==='SOL_REQUEST_UNCERTAIN_NO_RETRY'?'INVIO INCERTO · NON RIPETERE':msg.state==='SOL_REQUEST_RESERVED'?'RICHIESTA IN CORSO':msg.state==='SOL_REQUEST_COMPLETED'?'RICHIESTA COMPLETATA':'BOZZA · NON INVIATA';el.append(node('div','flag',flag),node('div','text',msg.text),node('small','',new Date(msg.at).toLocaleString('it-IT')));if(msg.state==='SOL_RESPONSE_ATTESTED'&&msg.output){for(const k of ['risks','actions','caveats']){const arr=msg.output[k];if(Array.isArray(arr)&&arr.length){el.append(node('strong','',({risks:'Rischi',actions:'Azioni suggerite',caveats:'Limiti'})[k]));for(const item of arr.slice(0,20))el.append(node('div','text','• '+item));}}}div.append(el);}div.scrollTop=div.scrollHeight;}
function showSnapshots(data){const select=$('snapshot-select');const previous=select.value;select.replaceChildren();select.append(node('option','','Seleziona snapshot…'));select.options[0].value='';for(const s of data.snapshots){const el=node('option','',`${s.market} · ${s.asOf.slice(0,10)} · ${s.count} SKU`);el.value=s.id;select.append(el);}select.value=previous&&data.snapshots.some(s=>s.id===previous)?previous:(data.snapshots.at(-1)?.id||'');$('check').disabled=!select.value;}
function updateSendControl(){
 const prompt=$('message').value.trim();
 const canSend=readyForSol && !!nonce && !sendInProgress && prompt.length>0;
 $('send').disabled=!canSend;
 $('send').textContent=sendInProgress?'Invio in corso…':canSend?'Invia a Sol · GPT-6.1 Sol':'Invia a Sol';
 $('send').setAttribute('aria-label', canSend?'Invia una sola richiesta a GPT-6.1 Sol':'Invio a Sol non ancora disponibile');
}
function showCheckFeedback(text){
 $('refresh-feedback').textContent=text;
}
async function refresh({userInitiated=false}={}){
 // Disabilita la trasmissione durante ogni refresh incompleto: fail closed.
 readyForSol=false;
 updateSendControl();
 const [status,gate,data,auth]=await Promise.all([
   get('/api/status'),get('/api/siwc/readiness'),get('/api/data'),get('/api/session')
 ]);
 if(status.extraApiBilling)throw Error('PAID_API_FORBIDDEN');
 if(typeof auth.nonce!=='string' || auth.nonce.length<32)throw Error('LOCAL_SESSION_UNAVAILABLE');
 nonce=auth.nonce;
 const granted=status.planConnected===true && gate.planConnected===true;
 readyForSol=granted && gate.canSendToSol===true;
 $('connection').textContent=granted?'ChatGPT collegato':'Sol non connesso';
 const tag=$('mode-status');
 tag.textContent=readyForSol?'ACCESSO PRONTO · SOL DA VERIFICARE':granted?'ACCESSO PRESENTE · INVIO BLOCCATO':'NON CONNESSO';
 tag.classList.toggle('connected',readyForSol);
 $('p7b9-gate-status').textContent=readyForSol
   ? 'Login verificato e invio disponibile. Scrivi il messaggio: solo una risposta reale potrà attestare Sol.'
   : granted?'Accesso presente ma invio non ancora pronto. Nessuna richiesta AI parte.'
   : gate.canStartOAuth?'App OSS dichiarata: puoi autorizzare il login personale.':
     'Client OSS non verificato. Nessuna richiesta AI consentita.';
 $('login').disabled=!gate.canStartOAuth || granted;
 $('verification').textContent=status.liveInference
   ? 'È già registrata una risposta reale verificata nel client.'
   : 'Nessuna risposta autentica di Sol ancora registrata. Nessuna API a pagamento.';
 showMessages(data.messages);showSnapshots(data);
 updateSendControl();
 if(userInitiated){
   const time=new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
   showCheckFeedback('Stato aggiornato alle '+time+(readyForSol?' · pronto per un messaggio':' · invio non disponibile'));
 }else if(readyForSol){
   showCheckFeedback('Accesso personale pronto. Scrivi una richiesta per attivare il pulsante viola «Invia a Sol».');
 }
}
$('message').addEventListener('input',()=>{
 updateSendControl();
 if(readyForSol && !sendInProgress && !$('message').value.trim())
   $('composer-info').textContent='ChatGPT collegato. Scrivi il messaggio per attivare «Invia a Sol».';
 else if(readyForSol && !sendInProgress)
   $('composer-info').textContent='Pronto per UNA richiesta esplicita; nessun invio automatico.';
});
$('refresh').addEventListener('click',async()=>{
 const button=$('refresh');
 button.disabled=true;
 button.textContent='Controllo in corso…';
 showCheckFeedback('Controllo del collegamento locale…');
 try{await refresh({userInitiated:true});}
 catch{
   readyForSol=false;updateSendControl();
   showCheckFeedback('Controllo non riuscito: invio sospeso, nessuna richiesta AI avviata.');
 }
 finally{button.disabled=false;button.textContent='Verifica stato locale';}
});
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
 if(!readyForSol || !nonce){$('composer-info').textContent='Accesso non pronto. Nessun invio effettuato.';return;}
 if(!original.trim()){$('composer-info').textContent='Inserisci una richiesta prima di inviare.';return;}
 if(sendInProgress)return;
 sendInProgress=true;updateSendControl();
 try{
  $('composer-info').textContent='Invio esplicito in corso: nessun retry automatico.';
  const response=await post('/api/sol/send',{text:original,snapshotId:$('snapshot-select').value||'',ownerConfirmed:true});
  if(response.state!=='SOL_RESPONSE_ATTESTED'||response.observedModel!=='gpt-6.1-sol')throw Error('UNVERIFIED');
  $('message').value='';$('composer-info').textContent='Risposta diretta verificata e salvata.';
  await refresh();
 }catch{
  $('composer-info').textContent='Risposta non attestata. Testo conservato. Se la richiesta è incerta, NON riprovare automaticamente.';
 }finally{
  sendInProgress=false;
  await refresh().catch(()=>{readyForSol=false;});
  updateSendControl();
 }
});
$('save').addEventListener('click',async()=>{const value=$('message').value;if(!value.trim()){$('composer-info').textContent='Scrivi prima la richiesta.';return;}try{if(!nonce)throw Error();await post('/api/messages',{text:value});$('message').value='';$('composer-info').textContent='Bozza salvata, non inviata a OpenAI.';await refresh();}catch{$('composer-info').textContent='Salvataggio fallito: messaggio conservato nell’editor.';}});
$('file').addEventListener('change',()=>{lastFile=$('file').files?.[0]||null;$('import').disabled=!lastFile;$('import-info').textContent=lastFile?`Selezionato: ${lastFile.name} (${lastFile.size} byte)`:'Nessun file selezionato';});
$('import').addEventListener('click',async()=>{if(!lastFile)return;if(lastFile.size>40_000){$('import-info').textContent='File troppo grande (max 40 KB)';return;}try{const data=JSON.parse(await lastFile.text());const saved=await post('/api/snapshots',data);$('import-info').textContent=`Importato ${saved.count} SKU ${saved.market}. Dati NON verificati con Amazon.`;await refresh();$('snapshot-select').value=saved.id;$('check').disabled=false;}catch{$('import-info').textContent='Importazione respinta: utilizzare solo il formato JSON previsto, senza credenziali.';}});
$('snapshot-select').addEventListener('change',()=>{$('check').disabled=!$('snapshot-select').value;});
$('check').addEventListener('click',async()=>{const id=$('snapshot-select').value;if(!id)return;try{const res=await post('/api/check-local',{snapshotId:id});const area=$('signals');area.replaceChildren();if(!res.cards.length){area.append(node('div','minor','Nessun segnale dalle regole locali; non è una verifica Amazon.'));return;}const title=node('div','minor',`${res.summary.total} segnali locali (NON analisi Sol)`);area.append(title);for(const c of res.cards.slice(0,30)){const box=node('div','signal');box.append(node('strong','',`${c.evidence.sku} · ${c.code}`),node('span','',c.detail));area.append(box);}}catch{$('signals').textContent='Controllo non disponibile. Nessun invio AI tentato.';}});
refresh().catch(()=>{readyForSol=false;updateSendControl();$('connection').textContent='Servizio non disponibile';$('verification').textContent='Disconnesso. Nessun invio AI.';showCheckFeedback('Il controllo iniziale non è riuscito; nessuna richiesta può partire.');});
