# Security scope and limits

This review covers only the standalone source release and offline tests.
It does not certify a deployment, actual OAuth grant, plan quota or inference.

- No shell, child-process invocation, eval, generated-code execution or model tool dispatcher.
- No API key provider, paid fallback, private model endpoint or model substitution.
- Fixed HTTP destinations: auth.openai.com for OAuth/JWKS; api.openai.com/v1 for catalog/Responses. Redirects are rejected; requests have timeouts and bounded bodies.
- Credentials belong to this client's registration and never enter model inputs.
- Owner-bound SQLite snapshots, serialized durable fencing and one active job per store.
- Owner-only directories/files, symlink rejection and atomic fsynced vault writes.
- OAuth PKCE, state, nonce, ID-token signature/claims and account-bound refresh.
- Consent expires before inference; scheduled work requires a separate bounded consent.
- No automatic retry after crash, quota, incomplete stream or uncertain outcome.
- Structured output currently means a parseable JSON object, not universal JSON Schema or professional-role certification.
- Audit hashes are not signatures or protection against an administrator rewriting the store.
- Revocation blocks jobs before dispatch; it cannot undo requests already sent.
- No residual-quota value is inferred from a model catalog or fabricated locally.
- A local eligibility declaration is an operator record, never OpenAI admission.

Trust boundary: the POSIX account, Node runtime and machine administrator are
trusted. The vault is not encrypted against root or malware with the same UID.
Do not mount unrelated credentials or expose the data directory through a web
server. No remotely hosted application integration is approved by this release.

Provenance: this source was authored for Personal Task Engine. No third-party
application source, asset, dependency bundle or credential is included. The
copyright holder approved MIT distribution. Node.js is an external prerequisite
and retains its own license and third-party notices.

Reproduce offline checks with Node24.21.0:

```sh
node --test *.test.mjs
```

Tests use explicit synthetic fixtures: temporary stores, locally generated RSA
keys, fake consent records and stub Responses streams. No OpenAI connection is
made by these tests. Successful tests do not establish account/model entitlement,
Linux deployment support, professional output quality or continuous inference.
