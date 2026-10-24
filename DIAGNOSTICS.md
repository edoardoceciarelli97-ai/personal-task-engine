# Inference diagnostics candidate

The original catch-all error path retained a durable fence but discarded HTTP, transport and parsing evidence. An older uncertain attempt cannot be retrospectively reconciled without those observations. Never replay it or infer zero usage from missing output.

This candidate persists allowlisted phase checkpoints in the local audit before dispatch, after HTTP headers and during SSE handling. Dispatch attempted does not prove provider acceptance. Request IDs and terminal types are recorded only when observed. Error response bodies, exception messages, prompts, authorization headers and tokens are not diagnostic log fields.

The SSE decoder dispatches complete data frames, handles multiline data and chunked CRLF, flushes UTF-8, extracts terminal assistant text when no deltas arrived and rejects disagreement between delta and terminal text. These are independently demonstrated compatibility defects; they do not establish the cause of a historical attempt without logs. EOF without a completed event remains uncertain.

Measured response ID/model/token counts are preserved separately in audit if final JSON validation fails; no valid result is fabricated. Crash tests use isolated child processes and synthetic fixtures, not live provider requests. Durable checkpoints describe the last committed observation, not an atomic transaction with the remote provider.

No retries, scheduler activation, OAuth changes or live inference are introduced. Existing uncertain jobs remain fenced. A new job requires new personal consent. No historical ledger or receipt is shipped in this repository.

## Unexpected response MIME

The MIME essence is now recorded separately from header presence. Parameters are
never logged. MIME comparison is exact and case-insensitive; a substring match
cannot admit a different media type. On unexpected success format, a bounded
8 KiB / 2 second inspection records only a structural category and selected error
codes. It never promotes JSON, HTML, missing-header or mislabelled SSE responses to
success. HTTP 200 remains insufficient: an admitted SSE stream must contain the
completed terminal event.

This closes a diagnostic gap, not a proven historical provider failure. Previous
headers and bodies that were never retained cannot be reconstructed. No Accept
header workaround, transport substitution or automatic retry is introduced.
Protocol reference: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference

## Shared strict MIME parser

Both provider admission and diagnostic sanitization use `normalizeMime` from
`mime.mjs`. It validates type/subtype tokens and parameter syntax, rejects control
characters, invalid quoting, trailing garbage and duplicate parameter names, and
returns only the lowercase essence. Parameter contents are never retained.

The previous MIME regexes were corrupted by JavaScript replacement-string `$&`
expansion during patch generation. The new parser is authored directly and shared,
rather than duplicated via generated regex strings. This demonstrable defect is
separate from historical SSE_REQUIRED failures whose headers were not retained.

## Official SIWC headerless-SSE compatibility

OpenAI's official `sign-in-with-chatgpt-devkit` (packages/local/src/responses.ts)
explicitly allows a valid SSE stream without the Content-Type header on the SIWC
direct route. Earlier Personal Task Engine versions rejected these HTTP 200
responses before consuming any event, producing SSE_REQUIRED without verifying
whether the stream contained response.completed.

The patched client requests Accept: text/event-stream, accepts a missing MIME
header only when a body exists, and still requires valid SSE events ending in
response.completed before declaring success. A present but incorrect or invalid
MIME remains rejected; HTML, JSON, malformed streams, absent terminal events,
and interrupted streams cannot become a successful response. When the header
is absent, the stream is parsed normally, not truncated at the 8 KiB
unexpected-format diagnostic limit. No request retry, credential change,
model substitution, or fallback billing is introduced.

This is a demonstrated client compatibility defect and a tested protocol
fix. The three historical UNCERTAIN requests cannot be reclassified
retroactively: their complete responses were never captured.

Official reference:
https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/packages/local/src/responses.ts
