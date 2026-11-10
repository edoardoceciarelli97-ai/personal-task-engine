# Sol Workplace — P7-B17 Owner Agent MCP Handoff

**Fonte pubblica:** `https://github.com/edoardoceciarelli97-ai/personal-task-engine/tree/sol-workplace-oss` · **Versione:** 0.4.2 · **Licenza:** MIT · **Stato:** sorgente pubblico; la distribuzione non contiene credenziali né abilita automaticamente il provider. Una prova di risposta reale è stata documentata separatamente su un Mac dell’owner; le nuove installazioni e la VM richiedono verifiche proprie.

Questa applicazione è una chat locale autonoma in italiano. Il suo codice è separato dal gestionale proprietario Amazon AI Business OS. Quando avviata dall'utente, funziona da sola su `http://127.0.0.1:4278`: non richiede né espone API del gestionale proprietario e non trasferisce token ChatGPT all'Office. L'Office può mostrare la UI in una cornice, ma non può utilizzare il suo accesso SIWC come proxy.

La disponibilità della chat all'interno di un gestionale privato **non è di per sé prova di idoneità SIWC**. Il percorso self-service ufficiale riguarda applicazioni OSS genuine in runtime locale o VM self-hosted sotto il controllo dell'utente. Per applicazioni commerciali o remotamente gestite, OpenAI indica un percorso specifico.

## Funzioni

- Chat standalone responsive con salvataggio locale dei testi, messaggi e risultati verificati; nessuna risposta Sol inventata.
- Import manuale e facoltativo di file JSON con dati non verificati; nessuna connessione diretta a Seller Central.
- Autenticazione OAuth diretta `Continue with ChatGPT` per **questa** applicazione, con PKCE/state/nonce, ID-token verificato tramite JWKS, scope `chatgpt.tokens.use.direct` obbligatorio, host ID persistente, credenziali in vault `0700/0600`.
- Verifica catalogo disponibile, invio diretto con `gpt-6.1-sol`, `reasoning.effort=xhigh`, `store:false`, `stream:true`, `tools:[]`, niente API key e niente fallback.
- Un invio esplicito dal proprietario alla volta; niente scheduler, automazioni o retry automatici. Messaggi in stato incerto rimangono tali.
- Risposte accettate esclusivamente con terminale `response.completed`, modello effettivo esatto e ID risposta. Se i dati del provider mancano, il modello non viene certificato.

## Verifica locale

Richiede **Node.js 24+** su un account POSIX non-root. Non installa servizi esterni e non richiede `npm install`.

```sh
npm run verify
npm start
```

Il primo comando testa codice e contratti offline con mock sintetici. Il secondo avvia soltanto la chat autonoma su `http://127.0.0.1:4278`. Le credenziali non sono contenute nell'archivio e non vengono create senza un login autorizzato.

**Importante:** non avviare OAuth senza prima aver completato le condizioni seguenti.

## Gate di pubblicazione e consenso

1. Il titolare ha autorizzato la pubblicazione del **solo** sorgente di questa applicazione open source, senza codice, database, asset o segreti Amazon OS. Questo repository contiene soltanto il client autonomo.
2. Pubblicazione effettiva del client OSS indipendente, utilizzo standalone funzionante e conferma che l'installazione corrisponde al sorgente pubblicato.
3. Verifica del runtime owner-controlled, condizioni SIWC applicabili all'integrazione e idoneità reale del piano ChatGPT. La nostra dichiarazione locale non rappresenta approvazione OpenAI.
4. Il titolare può creare, fuori dal repository, un file JSON di evidenza pubblicazione conforme allo schema in `docs/OWNER_SIWC_ACTIVATION.md`, fornendone il percorso come `SOL_WORKPLACE_PUBLISHED_OSS_EVIDENCE=/percorso/...` all'avvio. **Non creare un file fittizio per superare il controllo.**
5. Nel solo client OSS il proprietario preme `Continua con ChatGPT`, apre il link ufficiale `auth.openai.com` in una nuova scheda e autorizza il client. L'app verifica scope e identità; una richiesta AI successiva deve essere approvata con un nuovo clic esplicito.

Niente login riutilizzato di Personal Task Engine, Ambra, EVIENZA o QF. Niente browser/session cookie o token incollati in chat. Nessuna pubblicazione di Amazon OS. Nessuna API a consumo.

## Limiti attuali

- Repository OSS pubblico, ma il login resta bloccato di default fino alla verifica dell’ambiente, all’evidenza di pubblicazione revisionata dal proprietario e al consenso OAuth personale.
- Non è stata effettuata la prova di account reale, catalogo o `response.completed` autentico.
- Non vi è certificazione OpenAI per la combinazione con Office proprietario; una dichiarazione dell'operatore non la sostituisce.
- Non sono stati attivati server 24/7, accessi pubblici HTTPS/MFA, Seller Central o Amazon Ads.
- I test P7-B10 eseguiti con Node.js 22.16 nel runtime di sviluppo non sostituiscono il collaudo di produzione su Node.js 24+ e una VM owner-controlled.

**Fonti ufficiali:**
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://openai.com/policies/sign-in-with-chatgpt-terms/

`src/pte-core/` deriva da una copia verificata del progetto MIT `edoardoceciarelli97-ai/personal-task-engine` al commit `37e3c09d2de3ad609f2587dcbc7576a653ea92fc`, adattata esclusivamente per il nome app (`Sol Workplace`) nel flusso OAuth. Vedere `THIRD_PARTY_NOTICES.md`.

## Scaricare il codice da questa branch

```sh
git clone --branch sol-workplace-oss --single-branch https://github.com/edoardoceciarelli97-ai/personal-task-engine.git sol-workplace
cd sol-workplace
npm run verify
```

Questa branch GitHub e un tree indipendente dal ramo `main` di Personal Task Engine. Non autorizza ne prova l'idoneita SIWC per l'incorporamento in software proprietario.


## P7-B14 — Interfaccia del collegamento

La UI distingue un OAuth collegato da una risposta modello autentica. Il tasto «Verifica stato locale» conferma visibilmente l'orario dell'ultimo controllo. «Invia a Sol» diventa viola solo quando `canSendToSol`, `planConnected`, la sessione locale e il testo della richiesta sono tutti presenti; non invia nulla automaticamente. I messaggi restano inviati soltanto dal client locale OSS, non da Amazon OS. Il backend e i token non sono stati modificati.

## P7-B15 — Migrazione autorizzata alla VM self-hosted

La CLI `src/owner-vm-import.mjs` importa esclusivamente una **copia protetta** del grant di **questa stessa app Sol Workplace**, ottenuto dall'owner mediante il flusso OAuth ufficiale e trasferito via SSH secondo la guida self-hosted OpenAI. Deve essere invocata solo come utente Linux dedicato `sol-workplace`, con `--owner-reviewed` e file sorgente in cartella privata 0700/file 0600.

```sh
node src/owner-vm-import.mjs /percorso/privato/del/grant.json /var/lib/sol-workplace/siwc-credentials --owner-reviewed
```

**Non usare questo comando per ottenere un accesso non autorizzato**: l'app richiede ancora l'idoneità del piano, una verifica dell'installazione e il consenso dell'owner. La CLI non chiama OpenAI, non verifica i token presso il provider e non può attestare l'esito di una richiesta. Mantiene l'ID host VM distinto da quello Mac, impedisce la sovrascrittura di grant preesistenti e cancella solo la copia temporanea importata con successo. La copia originale sul Mac rimane invariata. Non trasferire mai password, cookie o token via chat. Non importare grant di Amazon OS proprietario, Personal Task Engine o EVIENZA.

Guida ufficiale: https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms

## P7-B17 — Agent Office owner handoff, opt-in locale

La nuova pagina `/agent-handoff` permette al proprietario di selezionare un incarico tramite **MCP stdio locale**, verificare i dati che verranno inviati, autorizzare una sola inferenza diretta nell'app Sol Workplace e scegliere separatamente se esportare la risposta **come bozza** nel sistema esterno. La bozza va ancora approvata nell'Office.

Il modello non chiama un server MCP ospitato nella Responses API: il **client locale** esegue i tool MCP `fetch_pending_tasks`, `read_task_status`, `read_product_context` e `post_agent_response`. La Responses API con SIWC mantiene `tools: []`, `store:false`, `stream:true`, `reasoning.effort=xhigh`; il risultato viene riconosciuto soltanto dopo `response.completed` con modello esattamente `gpt-6.1-sol` e `resp_...`. Non esiste endpoint di inferenza per Amazon OS, né una coda di inferenza background, né API key/fallback.

**Disabilitato di default.** Solo quando il proprietario ha installato l'app OSS e il gestionale *sullo stesso computer sotto lo stesso utente* può impostare due variabili all'avvio:

```
SOL_WORKPLACE_AGENT_MCP_ENTRY=/percorso/owner/app/agent-office/mcp-stdio.mjs
SOL_WORKPLACE_AGENT_DB_PATH=/percorso/owner/app/data/amazon-os-p2.sqlite
```

Il client non cerca database di altre applicazioni, non inoltra token SIWC, non attiva il modello da eventi o da richieste HTTP del gestionale e non esegue funzioni di acquisto o pubblicazione. Se i percorsi non sono normali file locali, se il task cambia o se manca un consenso, il flusso si ferma. Una risposta del modello dal provider non implica che l'applicazione esterna possa attestare il modello indipendentemente; la bozza resta non attestata nell'Office.

**VM:** in una VM con utenti Linux separati, questi due percorsi non vanno resi leggibili allo stesso utente semplicemente modificando i permessi; serve un canale IPC privato e autenticato progettato a parte. Questa versione prova soltanto il percorso owner-controlled locale; non certifica cloud 24/7.

I test inclusi sono sintetici: non creano un OAuth grant reale e non consumano il piano. L'idoneità OpenAI per ogni specifico uso dell'app va confermata dalle condizioni ufficiali, che vietano di usare l'accesso SIWC come API generica per altre applicazioni.


## P7-B21 — Prima sessione d'esami dell'utente (feature OSS, limitata)

Sol Workplace 0.6.0 include una pagina locale `http://127.0.0.1:4278/academy` per una **suite di 28 esami professionali sintetici** del titolare, avviabile con un unico consenso esplicito. La logica di esecuzione vive interamente in questa applicazione indipendente e utilizza unicamente `SiwcRuntime.infer` già autorizzato.

- Il materiale d'esame **non è incluso in questo repository pubblico**: il titolare lo conserva localmente in file privato (0700/0600). Il codice controlla il digest esatto della suite congelata e non offre endpoint generici di inferenza a software esterni.
- Invia richieste solo dopo un clic di conferma dalla pagina locale. Max 28, una per volta, 10 secondi minimi fra gli invii (oltre alla durata delle richieste), zero retry o pianificazione ricorrente. L'owner può chiedere una pausa in ogni momento; la richiesta già in corso può finire.
- Ogni invio viene riservato e persistito prima di contattare il provider. Un errore in fase incerta o un arresto del processo durante una richiesta *blocca* la ripetizione automatica. Dopo una pausa sicura, la ripresa richiede un consenso esplicito separato.
- Il client richiede il modello esatto `gpt-6.1-sol` e l'effort `xhigh`, ma la sola risposta non attesta autonomamente l'effort interno. Accetta soltanto la risposta completata che supera il controllo già implementato in SiwcRuntime.
- I dati e le risposte originali sono salvati nel solo runtime privato dell'utente, senza esportare password/token/chiavi. L'utente può scaricare un JSON delle ricevute e sottoporlo a valutazione indipendente.
- **Non certifica né attiva alcun agente**. Nessun accesso Seller Central, Amazon Ads, nessuna API a consumo, nessuna modifica nel gestionale proprietario. L'uso del piano ChatGPT resta limitato all'app SIWC collegata e alle automazioni espressamente autorizzate.
- La presenza della feature non certifica l'ammissione del provider, la disponibilità di quota o la capacità di funzionare senza il runtime locale acceso.

Avvio su Mac con kit privato owner-controlled: il launcher installa soltanto la nuova versione OSS e il pack d'esame in cartella privata, preservando lo stesso vault e il vecchio archivio. Non pubblicare il pack privato o l'intero sistema Amazon OS su GitHub.

Fonti: https://openai.com/policies/sign-in-with-chatgpt-terms/ ; https://developers.openai.com/siwc/token-sharing-open-source
