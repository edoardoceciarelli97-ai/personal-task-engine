'use strict';
const $=id=>document.getElementById(id);
let nonce='',state=null,prompts=null;
const labels={NOT_STARTED:'Da avviare',RUNNING:'In esecuzione',STOP_REQUESTED:'Arresto richiesto',PAUSED_BY_OWNER:'In pausa',PAUSED_AFTER_RESTART:'Pausa dopo riavvio',PAUSED_BY_OTHER_REQUEST:'Pausa per richiesta concorrente',BLOCKED_BEFORE_DISPATCH:'Accesso da rinnovare',BLOCKED_UNCERTAIN:'Esito incerto · non ripetere',BLOCKED_UNCERTAIN_AFTER_RESTART:'Esito incerto dopo riavvio',COMPLETED_AWAITING_INDEPENDENT_REVIEW:'Da valutare',EXAM_PACK_NOT_INSTALLED:'Kit esami non installato'};
function feedback(text){$('feedback').textContent=text}
async function get(url){const r=await fetch(url,{cache:'no-store',credentials:'omit'});const d=await r.json();if(!r.ok)throw Error(d.error||'HTTP '+r.status);return d}
async function post(url,body){const r=await fetch(url,{method:'POST',cache:'no-store',credentials:'omit',headers:{'Content-Type':'application/json','X-Owner-Action':nonce},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'HTTP '+r.status);return d}
async function refresh(){
  try{
    const [status,auth,session]=await Promise.all([get('/api/academy/status'),get('/api/siwc/owner-state'),get('/api/session')]);
    if(typeof session.nonce!=='string'||session.nonce.length<32)throw Error('SESSION_REQUIRED');
    nonce=session.nonce;state=status;
    $('counter').textContent=`${status.completed||0} / ${status.total||28}`;
    $('completed').textContent=String(status.completed||0);
    $('progress').style.width=`${Math.round(100*(status.completed||0)/28)}%`;
    $('state').textContent=labels[status.state]||status.state;
    $('active').textContent=status.activeExamId?'Esame corrente: '+status.activeExamId:status.reason||'Nessun esame in corso';
    const mayStart=['NOT_STARTED','PAUSED_BY_OWNER','PAUSED_AFTER_RESTART','PAUSED_BY_OTHER_REQUEST','BLOCKED_BEFORE_DISPATCH'].includes(status.state);
    $('start').disabled=!(status.packLoaded&&status.total===28&&auth.eligibleAppDeclared===true&&auth.scopeGranted===true&&mayStart);
    $('start').textContent=status.state==='NOT_STARTED'?'Autorizzo 28 esami e avvia':'Autorizzo la ripresa dei soli esami mancanti';
    $('stop').disabled=!['RUNNING','STOP_REQUESTED'].includes(status.state);
    $('export').disabled=(status.completed||0)===0;
    if(status.state==='COMPLETED_AWAITING_INDEPENDENT_REVIEW')feedback('28 esami acquisiti. Scarica le ricevute per la valutazione professionale. Nessun ruolo è ancora certificato.');
    else if(status.state.includes('UNCERTAIN'))feedback('Richiesta incerta: esecuzione sospesa. NON avviare di nuovo; verifica la ricevuta originale.');
    else if(status.state==='EXAM_PACK_NOT_INSTALLED')feedback('Il pacchetto privato degli esami non è installato. Nessuna inferenza consentita.');
    else if(status.state==='RUNNING')feedback('Esecuzione in corso. Puoi lasciare la scheda aperta o fermare il batch; niente richieste parallele.');
    else if(mayStart)feedback(auth.scopeGranted?'Accesso personale rilevato. Pronto per un unico consenso.':'Accesso SIWC non pronto. Avvia o rinnova la stessa app, senza inviare richieste.');
  }catch{feedback('Stato locale non disponibile. Nessuna richiesta inviata.');$('start').disabled=true;$('stop').disabled=true;}
}
$('start').addEventListener('click',async()=>{
 if(!state||$('start').disabled)return;
 const remaining=28-(state.completed||0);
 if(!window.confirm(`Autorizzi questa sessione Sol Workplace a eseguire fino a ${remaining} esami mancanti su 28, un esame per volta, con il tuo piano ChatGPT, senza retry automatici e senza azioni Amazon?`))return;
 $('start').disabled=true;feedback('Registrazione consenso e avvio...');
 try{await post('/api/academy/start',{confirmation:'AUTORIZZO 28 ESAMI',packDigest:state.packDigest,maxRequests:28});await refresh()}
 catch(e){feedback('Avvio respinto: '+String(e.message).slice(0,80));await refresh().catch(()=>{});}
});
$('stop').addEventListener('click',async()=>{if($('stop').disabled)return;$('stop').disabled=true;try{await post('/api/academy/stop',{confirmStop:true});feedback('Pausa richiesta: la chiamata già iniziata può ancora concludersi.');}catch{feedback('Non è stato possibile richiedere la pausa.');}await refresh().catch(()=>{});});
$('export').addEventListener('click',async()=>{try{const report=await get('/api/academy/report');const b=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(b);const a=document.createElement('a');a.href=url;a.download='sol-workplace-28-esami-ricevute.json';document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);feedback('Ricevute scaricate: controllale prima di condividerle.');}catch{feedback('Esportazione non disponibile.');}});
$('toggle').addEventListener('click',async()=>{
 if(!$('exams').hidden){$('exams').hidden=true;$('toggle').textContent='Mostra gli esami';return;}
 try{if(!prompts)prompts=await get('/api/academy/prompts');const target=$('exams');target.replaceChildren();for(const item of prompts.exams){const d=document.createElement('details');const title=document.createElement('summary');title.textContent=`${item.id} · ${item.market}`;const content=document.createElement('pre');content.textContent=item.prompt;d.append(title,content);target.append(d);}target.hidden=false;$('toggle').textContent='Nascondi gli esami';}catch{feedback('Impossibile visualizzare le tracce.');}
});
refresh();setInterval(refresh,4000);
