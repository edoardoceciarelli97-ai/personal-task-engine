# Sol Workplace — P7-B15 SIWC Owner-Controlled VM Readiness

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
