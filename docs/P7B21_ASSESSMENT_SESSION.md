# P7-B21 • Bounded owner-exam session

- Public app: Sol Workplace OSS, `sol-workplace-oss` branch; no private product data or complete exam texts.
- Input: the single, sha256-pinned 28-item Amazon seller skills assessment suite imported by the owner to a private local path. The suite uses only synthetic data and has no Seller Central connection.
- User control: first-party UI `/academy`, same-origin nonce-protected POST, one explicit confirmation for up to 28 sequential requests. The application carries out only this finite session, not a new recurring task. Separate consent on intentional resume.
- Each request: `SiwcRuntime.infer`, model `gpt-6.1-sol`, reasoning `xhigh` requested, `store:false`, `tools:[]`, streaming and completion verification from the existing runtime. No generic API or token transfer.
- Failure semantics: save `RESERVED_PROVIDER_RESULT_UNKNOWN` before dispatch; on failure `BLOCKED_UNCERTAIN` and no retry. On a restart with in-flight work `BLOCKED_UNCERTAIN_AFTER_RESTART`; no auto-resume. A pause finishes at most the already-dispatched request. Synchronous preflight failures stop before dispatch.
- Storage: separate atomic owner-private file `owner-exam-session.json` (0600) in existing SIWC state directory (0700). No raw grant, access token, refresh token, auth code, environment secrets or client credentials in the session report.
- Output: original response text and observed model/response ID, locally client-attested; xhigh separately requested, not independently observed. Assessment scoring and release sign-off are independent and **not part of this app**.
- Operational freeze: baseline owner roles and criteria are not modified by this feature. No activation of new Amazon OS agents. No Amazon credentials, Ads or EVIENZA connections.

Current evidence: code tested with deterministic synthetic SSE completions only; real owner Sol session and provider responses not executed by this release. User must launch the local app to complete them.
