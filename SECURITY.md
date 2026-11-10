# Sicurezza e disclosure

Sol Workplace e un'applicazione locale destinata a un singolo proprietario: usa solo `127.0.0.1` e non offre un servizio pubblico autenticato. Non esporre direttamente la porta 4278 su Internet, non usare su computer condivisi e non disabilitare le protezioni di origine e host.

OAuth e permessi SIWC sono soggetti ai requisiti OpenAI: un repository pubblico non equivale a un'ammissione del provider. Non pubblicare token, cookie, file di stato o le evidenze locali. Le cartelle `.local-state/`, `.siwc-state/`, `siwc-published-evidence.json` e i file di credenziali devono restare esclusi dal controllo versione.

Per vulnerabilita, non creare issue con segreti o dettagli di sessione: contattare il manutentore del repository in forma riservata.

Non usare questo programma per fornire un'API generica a software proprietari. Non collegare alcuna chiave API OpenAI a consumo.
