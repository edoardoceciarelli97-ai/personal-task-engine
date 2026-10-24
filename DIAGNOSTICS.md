# Inference diagnostics candidate

The original catch-all error path retained a durable fence but discarded HTTP, transport and parsing evidence. An older uncertain attempt cannot be retrospectively reconciled without those observations. Never replay it or infer zero usage from missing output.

This candidate persists allowlisted phase checkpoints in the local audit before dispatch, after HTTP headers and during SSE handling. Dispatch attempted does not prove provider acceptance. Request IDs and terminal types are recorded only when observed. Error response bodies, exception messages, prompts, authorization headers and tokens are not diagnostic log fields.

The SSE decoder dispatches complete data frames, handles multiline data and chunked CRLF, flushes UTF-8, extracts terminal assistant text when no deltas arrived and rejects disagreement between delta and terminal text. These are independently demonstrated compatibility defects; they do not establish the cause of a historical attempt without logs. EOF without a completed event remains uncertain.

Measured response ID/model/token counts are preserved separately in audit if final JSON validation fails; no valid result is fabricated. Crash tests use isolated child processes and synthetic fixtures, not live provider requests. Durable checkpoints describe the last committed observation, not an atomic transaction with the remote provider.

No retries, scheduler activation, OAuth changes or live inference are introduced. Existing uncertain jobs remain fenced. A new job requires new personal consent. No historical ledger or receipt is shipped in this repository.
