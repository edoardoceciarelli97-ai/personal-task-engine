'use strict';
const $=id=>document.getElementById(id);
let nonce='',roles=[],pending=false,providerReady=false,threadLocked=false;
const create=(tag,content,cls='')=>{const e=document.createElement(tag);e.textContent=content??'';if(cls)e.className=cls;return e;};
const request=async(url,payload)=>{const opts={cache:'no-store',credentials:'omit'};if(payload!==undefined){opts.method='POST';opts.headers={'Content-Type':'application/json','X-Owner-Action':nonce};opts.body=JSON.stringify(payload);}const res=await fetch(url,opts);const json=await res.json();if(!res.ok)throw Error(json.error||'HTTP_'+res.status);return json;};
const notice=s=>$('notice').textContent=s;
const market=()=>$('market').value;
const thread=()=>$('thread').value;
const role=()=>$('role').value;
const refreshSend=()=>{$('send').disabled=pending||!thread()||!providerReady||threadLocked;};
async function verify(){const [state,session]=await Promise.all([request('/api/roles/status'),request('/api/session')]);
 if(typeof session.nonce!=='string'||session.nonce.length<32)throw Error('LOCAL_SESSION_REQUIRED');nonce=session.nonce;roles=state.roles;providerReady=state.providerReady;
 $('role').replaceChildren();for(const r of roles){const op=create('option',`@${r.mention} · ${r.name}`);op.value=r.id;$('role').append(op);} 
 $('connected').textContent=providerReady?'Sol connesso':'Sol da collegare';
 await refreshThreads();notice(providerReady?'Accesso rilevato: scegli ruolo e autorizza una richiesta alla volta.':'Per inviare, occorre il login della stessa app Sol Workplace.');}
async function refreshThreads(){const d=await request('/api/roles/threads?market='+encodeURIComponent(market()));const prev=thread();$('thread').replaceChildren();const first=create('option','Seleziona una conversazione');first.value='';$('thread').append(first);
 for(const t of d.threads){const x=create('option',`${t.roleId} · ${t.messageCount} messaggi${t.locked?' · BLOCCATO':''}`);x.value=t.id;$('thread').append(x);}if(d.threads.some(t=>t.id===prev))$('thread').value=prev;else if(d.threads.length)$('thread').value=d.threads[0].id;await refreshMessages();}
async function refreshMessages(){const box=$('messages');box.replaceChildren();if(!thread()){box.append(create('p','Crea una conversazione prima di scrivere.','muted'));refreshSend();return;}
 try{threadLocked=false;const d=await request('/api/roles/thread?market='+encodeURIComponent(market())+'&id='+encodeURIComponent(thread()));const profile=roles.find(r=>r.id===d.roleId);$('role').value=d.roleId;$('selected').textContent=profile?.name||d.roleId;
 for(const m of d.messages){const item=create('article','',`msg ${m.actor}`);item.append(create('small',`${m.actor==='owner'?'Tu':profile?.name||'Sol'} · ${m.state}`));item.append(create('pre',m.text));box.append(item);}
 if(d.locked){threadLocked=true;notice('Esito incerto in questa conversazione. Non ripetere la richiesta; conserva la ricevuta per riconciliazione.');}
 }catch(e){notice('Lettura bloccata: '+e.message);}box.scrollTop=box.scrollHeight;refreshSend();}
$('new').addEventListener('click',async()=>{if(pending)return;pending=true;try{const t=await request('/api/roles/new',{market:market(),roleId:role()});await refreshThreads();$('thread').value=t.id;await refreshMessages();notice('Conversazione creata: nessuna richiesta Sol eseguita.');}catch(e){notice('Creazione fallita: '+e.message);}finally{pending=false;refreshSend();}});
$('refresh').addEventListener('click',()=>refreshThreads().catch(e=>notice(e.message)));
$('refreshAccess').addEventListener('click',async()=>{if(pending)return;pending=true;refreshSend();try{const x=await request('/api/roles/refresh',{});providerReady=x.providerReady;notice(providerReady?'Accesso aggiornato senza alcuna chiamata AI.':'Accesso non pronto; controlla il login Sol Workplace.');$('connected').textContent=providerReady?'Sol connesso':'Sol da collegare';}catch(e){notice('Rinnovo non riuscito; nessuna AI inviata: '+e.message);}finally{pending=false;refreshSend();}});
$('market').addEventListener('change',()=>refreshThreads().catch(e=>notice(e.message)));
$('thread').addEventListener('change',()=>refreshMessages());
$('role').addEventListener('change',()=>{$('selected').textContent=roles.find(r=>r.id===role())?.name||'Specialista';});
$('sendForm').addEventListener('submit',async e=>{e.preventDefault();if(pending||$('send').disabled)return;const t=$('message').value.trim();if(!t)return notice('Inserisci una richiesta.');if(!window.confirm('Autorizzi UNA richiesta a GPT-6.1 Sol in questa app locale, senza azioni Amazon e senza ripetizioni automatiche?'))return;
 pending=true;refreshSend();notice('Invio autorizzato. Non ripetere se la risposta tarda...');
 try{const result=await request('/api/roles/send',{id:thread(),market:market(),text:t,ownerConfirmed:true});$('message').value='';notice(result.state+' · modello '+result.observedModel);}
 catch(ex){notice('Risultato da verificare: '+ex.message+'; non ripetere la richiesta.');}
 finally{pending=false;await refreshMessages().catch(()=>{});refreshSend();}
});
verify().catch(e=>{notice('Installazione dei profili o sessione non disponibile: '+e.message);$('send').disabled=true;});
