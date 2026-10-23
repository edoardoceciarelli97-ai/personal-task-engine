# Personal Task Engine

A standalone, owner-directed task queue with direct Sign in with ChatGPT (SIWC)
protocol support. MIT licensed. Runs independently using Node.js24 or later;
tested with24.21.0 on macOS. No npm dependencies and no Codex dependency.

This is an early source release with offline tests. No real OAuth grant, live
model inference, Linux deployment or continuous-operation certification is
implied by the test results. OpenAI determines registration, scope and model
availability; an open-source license is not an OpenAI approval.

## What it does

- Versioned roles, instructions and input/document/memory snapshots.
- Local SQLite queue with due dates, durable one-attempt fencing and one active job.
- Separate owner consent per task and bounded consent for scheduling.
- Hash-linked audit, structured JSON results and separate human review.
- Pause on quota errors, crashes or uncertain responses; no automatic retries.
- Direct SIWC primitives, protected local grant storage and authenticated catalog.

There is no remote application endpoint, third-party request routing, external
tool dispatcher, generated-code execution, shell execution or paid API fallback.
The model is pinned to `gpt-6.1-sol` in this release. It is never silently replaced.
The only HTTP listener is the temporary OAuth callback on127.0.0.1.

## Local setup

Use a non-root POSIX account and a canonical data directory without symlinks:

```sh
git clone https://github.com/edoardoceciarelli97-ai/personal-task-engine.git
cd personal-task-engine
mkdir -m 700 .state
node --test *.test.mjs
```

No `npm install` is necessary. `private:true` in package.json prevents accidental
npm publication; the source repository is distributed under MIT.
Runtime Node.js and its bundled components retain their own licenses and are not
vendored here. See [LICENSE](LICENSE).

## Sign in with ChatGPT

Read the official integration requirements before registering your installation:

- [Overview](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

The local eligibility declaration records the operator's evidence; it is not
proof of OpenAI admission. Do not misrepresent a private hosted service as an
eligible open-source client. A hosted integration requires its own assessment.
Example declaration for a genuinely published, independently usable installation:

```json
{
  "standalone": true,
  "distribution": "PUBLISHED_OPEN_SOURCE",
  "ownerApprovedLicense": true,
  "license": "MIT",
  "sourceUrl": "https://github.com/edoardoceciarelli97-ai/personal-task-engine",
  "hostedOfficeBackend": false
}
```

Save your reviewed declaration as `eligibility.json`, outside the source tree.
After personally authorizing the login, run:

```sh
node cli.mjs login "$PWD/.state" /absolute/path/to/eligibility.json
node cli.mjs auth-status "$PWD/.state"
node cli.mjs models "$PWD/.state"
```

The login command prints an official authorization URL. Review it and complete
consent in your own browser on this computer. It starts no inference. It uses
fresh PKCE/state/nonce, an independent persistent host ID and a loopback callback.
The client checks the issued client ID, ID-token signature/claims and granted
`chatgpt.tokens.use.direct` scope. A valid ID token alone does not grant plan use.
`auth-status` prints redacted account metadata including the subject needed below;
it never prints tokens. Treat account identifiers as private operational data.

Models are fetched using that registration's OAuth access token. A catalog entry
is not proof of successful inference or a measurement of remaining quota.
Refresh rotates the protected grant. If identity-bearing refresh verification
cannot complete, stop and reauthorize personally rather than bypassing checks.

## Personal jobs

Use the validated account subject from `auth-status` as OWNER_SUB. Create an input
JSON file with `role`, `version`, `instructions`, `input`, optional `documents`,
`memory` and a due timestamp in milliseconds. Documents and memory are explicit
snapshots; the worker does not read arbitrary document paths or crawl files.

```sh
node cli.mjs enqueue "$PWD/.state" OWNER_SUB /absolute/path/to/job.json
node cli.mjs status "$PWD/.state" OWNER_SUB
```

New jobs are BLOCKED. The owner must separately approve the exact UUID and digest
before `authorize`. A consent JSON contains:

- `owner`, `jobId`, `inputHash` returned for the reviewed snapshot;
- `model: "gpt-6.1-sol"`, `maxAttempts: 1`;
- `personalOnly: true`, `extraApiBilling: false`, `externalTools: false`;
- `expiresAt` in milliseconds, future and at most24hours away;
- `source`, identifying the actual personal consent record.

Do not manufacture a human consent record. Files supplied by the trusted local
operator record consent; they do not cryptographically prove human intent.

```sh
node cli.mjs authorize "$PWD/.state" OWNER_SUB /absolute/path/to/consent.json
node cli.mjs run-one "$PWD/.state" OWNER_SUB /absolute/path/to/eligibility.json
```

`run-one` can make a real plan-backed model request. Do not run it without the
specific personal consent. The request uses public Responses with `store:false`,
`stream:true`, `tools:[]`, timeout/size limits and no retries. It must reach a
completed terminal event. Returned model, usage and response ID are retained only
when actually provided. Missing fields are never invented as attestations.
Results must be JSON objects and enter VERIFYING for separate human review.
Role-specific professional validation is outside this first release.

Further commands: `pause`, `resume`, `recover`, `revoke JOB_ID`, and `review` with
a JSON file containing `id` and a boolean `approved`. Local `disconnect` removes
the grant; revoke remotely through official ChatGPT account settings as well.

## Scheduling and limitations

`watch DATA_DIRECTORY OWNER_SUB ELIGIBILITY_JSON AUTOMATION_CONSENT_JSON` requires
separate bounded automation consent: owner, source, personalOnly=true,
externalTools=false, issuedAt/expiresAt (maximum24hours), maxJobs1..100 and
pollSeconds30..3600. Each job still needs its own consent. Consumption persists
across restarts. Nothing starts automatically; no daemon, service or timer is
installed. Re-consenting must not be used to bypass plan limits.

The process can wait for jobs, but this is not unlimited inference entitlement.
No undocumented quota endpoint is used. Quota failures suspend the queue without
buying credits. Resume does not reset a consumed task fence. Crash recovery marks
RUNNING tasks UNCERTAIN. Reconcile uncertain attempts before any further action;
a request already sent cannot be cancelled retroactively. Exactly-once HTTP is
not promised. Long schedules stop on grant expiry rather than bypassing renewal.

VM deployment requires the documented host identity and protected credential
procedure, plus the user's separate authorization. Do not copy another client's
credentials or overwrite a VM's host ID with a laptop's identity. Do not route
other people's jobs through one owner's ChatGPT plan.

## Security and evidence

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md). The local vault is protected by OS
permissions, not encrypted against root or malware with the same UID. Hash-linked
audit detects simple edits; it is not provider-signed or immutable against the
disk owner. Tests use synthetic consent records, locally signed test JWTs and
stub provider responses. They are never represented as live provider receipts.
