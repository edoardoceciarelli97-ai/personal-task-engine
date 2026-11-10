# Gate operativo P7-B10 — SOLO soluzione A (SIWC)

## Stato attuale

Il codice è un client OSS autonomo pubblicato su GitHub. **Non è collegato a ChatGPT.** Nessun login, token, verifica catalogo, modello o richiesta dal provider sono stati eseguiti durante lo sviluppo. Non è stato attivato alcun servizio API con billing.

## Configurazione dopo pubblicazione autorizzata

Prima di qualsiasi accesso, il titolare verifica manualmente URL del repository, licenza, identità effettiva dell’app, runtime sotto il proprio controllo e termini OpenAI. A quel punto, fuori dal repository, può salvare un file `evidence.json` con:

```json
{
  "standalone": true,
  "distribution": "PUBLISHED_OPEN_SOURCE",
  "ownerApprovedLicense": true,
  "license": "MIT",
  "sourceUrl": "https://github.com/edoardoceciarelli97-ai/personal-task-engine/tree/sol-workplace-oss",
  "hostedOfficeBackend": false,
  "appName": "Sol Workplace",
  "ownerReviewedAt": "INSERIRE_LA_DATA_REALE_DI_VERIFICA"
}
```

**Non compilare dichiarazioni di comodo:** il file è evidenza dichiarata dall'operatore, non una prova di ammissione o approvazione OpenAI. Non usarlo finché i fatti non corrispondono.

Avvio su computer locale non-root con Node24+:

```sh
SOL_WORKPLACE_PUBLISHED_OSS_EVIDENCE=/percorso/assoluto/evidence.json npm start
```

Aprire `http://127.0.0.1:4278`, scegliere `Continua con ChatGPT` e seguire il link originale `https://auth.openai.com/...`. Dopo consenso browser il client verifica firma dell'ID token, scope e grant. Il primo messaggio Sol è inviabile solo dal client stesso e solo con il clic esplicito del proprietario. Le credenziali rimangono in `~/.sol-workplace-p7b5/siwc-credentials/` (0700/0600).

## VM owner-controlled

Per una VM privata conforme alla documentazione self-hosted, il callback `127.0.0.1` sul computer del browser non raggiunge automaticamente la VM: seguire la procedura ufficiale di OAuth locale e trasporto protetto del grant, conservando distinto l'ID dell'host VM. Non copiare un token da EVIENZA o da un altro client.

## Non autorizzato / non testato

- Pubblicazione dell'intero Amazon OS; nessuna parte proprietaria deve essere inclusa nel repository OSS.
- Uso dell'app OSS come API proxy per Amazon OS, automazioni senza consenso, scritture Amazon.
- Fallback API key / API a consumo, upgrade o nuove spese.
- Attestare `SOL_LIVE=YES` basandosi su mock, catalogo pubblico o sola concessione OAuth.

Provider docs: https://developers.openai.com/siwc/token-sharing-open-source ; https://developers.openai.com/siwc/token-sharing-open-source/sign-in ; https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms ; https://openai.com/policies/sign-in-with-chatgpt-terms/

## P7-B15 — Percorso self-hosted VM secondo OpenAI

Conservare localmente la registrazione dell'**app Sol Workplace** e il suo ID client rilasciato da OpenAI. Preparare un host ID VM distinto e conservarlo nel vault locale della VM. La procedura ufficiale prevede OAuth nel browser locale e il trasferimento **protetto** delle credenziali selezionate verso l'istanza della medesima app su VM owner-controlled, ad esempio via SSH; i limiti del piano rimangono condivisi.

La CLI per importare una copia temporanea protetta nel vault VM è:

```sh
node src/owner-vm-import.mjs /private/transfer/grant.json /var/lib/sol-workplace/siwc-credentials --owner-reviewed
```

Richiede esecuzione come utente POSIX non-root dedicato alla sola app OSS, cartella trasferimento di proprietà dello stesso utente con permessi 0700, file 0600, fonte verificata del medesimo client. Non scrive token in output, log o browser e rifiuta percorsi simbolici; conserva il nuovo ID host VM. L'owner deve prima predisporre il trasferimento dal proprio Mac sul canale SSH sicuro. L'applicazione resta autonoma e non apre un endpoint proxy per Amazon OS. Nessun consenso background o inferenza viene concesso dalla sola importazione.

Guida OpenAI: https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
