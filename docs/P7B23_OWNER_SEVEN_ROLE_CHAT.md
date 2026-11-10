# P7-B23 — Sette specialisti direttamente in Sol Workplace OSS

Release privata di configurazione e sorgente OSS open-source separati.

## Scopo

Il titolare usa il client già collegato a ChatGPT e apre `/roles` sul medesimo host locale, senza autorizzare Amazon OS proprietario a usare token o strumenti dell'app. Il modello desiderato è `gpt-6.1-sol` con `xhigh` richiesto; il client deve ricevere `response.completed` e il modello osservato esatto prima di conservare una risposta come `CLIENT_ATTESTED_RESPONSE`.

Sono disponibili sette profili **progettati**, non sette modelli addestrati o certificati: DirettoreAI, AgenteAnalisi, AgenteCommerciale, AgenteAds, AgenteOperations, AgenteFinance, AgenteCompliance. La specializzazione si realizza con istruzioni professionali caricate da un pacchetto privato verificato dal proprietario, distinto dal codice pubblicato.

## Dati e permessi

- I profili sono conservati in un file privato owner-only `0700/0600`, non nel repository pubblico e non nella web app Amazon OS.
- La conversazione è persistita nel vault locale dell'**app Sol Workplace** (`owner-role-conversations.json`, `0600`), separata per mercato IT/EUR e AE/AED; non cancella chat precedenti, ricevute esami o credenziali.
- Le API sono **solo locali** a `127.0.0.1`, con controllo Host, Origin e nonce per le mutazioni.
- Ogni invio richiede un clic e una conferma. Nessun scheduler, zero rinnovi automatici di messaggi, zero richieste dai processi Amazon OS.
- Il pulsante `Verifica / rinnova accesso` tenta un refresh della stessa app senza eseguire una inferenza.
- Risposte basate su dati manuali sono sempre non verificate con Amazon; nessuna pubblicazione listing, bidding, ordine o pagamento è consentita.
- In caso di risposta incerta, la conversazione viene bloccata e non si tenta un retry automatico. Per un riscontro affidabile non bisogna duplicare la richiesta.
- La sola schermata non attesta la qualità professionale, il reasoning interno o l'approvazione OpenAI. 0/7 certificati finché non ci sono prove indipendenti e signoff.

## Come avviare sul Mac

1. Ferma Sol Workplace già aperto con `Ctrl+C`, senza cancellare nulla.
2. Scarica il pacchetto Mac P7-B23; estrailo e lascia chiuso l'archivio OSS al suo interno.
3. Nel Terminale digita `bash ` e trascina `AVVIA_7_SPECIALISTI_MAC.command`, quindi premi Invio.
4. La pagina `http://127.0.0.1:4278/roles` si apre dopo i controlli locali. Scegli mercato, ruolo e `Nuova conversazione`.
5. Scrivi una richiesta e conferma **una singola risposta**. Conserva la ricevuta. Non ripetere l'invio se il risultato è incerto.

Non serve riavviare l'esame P7-B21 né reinstallare le credenziali. Un vecchio esame con risultato incerto resta intatto e non viene ritentato.

## Limiti dichiarati

Il modello non è accessibile a questo ambiente di sviluppo; i test di rilascio usano un provider simulato e non rappresentano chiamate reali. Sol Workplace deve essere effettivamente collegato all'account del proprietario e il modello deve essere nel catalogo disponibile. Il client OSS non fornisce un'API general-purpose alla piattaforma Amazon OS, in accordo con SIWC Terms efficaci dal 4 novembre 2026. La chat unificata **proprietaria** Amazon OS resta disabilitata lato AI finché il provider non ne ammette l'uso effettivo. Il server 24/7 e SP-API/Ads sono ancora assenti.

Fonti ufficiali:
- https://openai.com/policies/sign-in-with-chatgpt-terms/
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
