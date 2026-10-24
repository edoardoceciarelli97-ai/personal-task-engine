import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMime } from './mime.mjs';
import { mimeMetadata, PlanProvider } from './siwc.mjs';
import { safeDiagnostic } from './engine.mjs';
for (const value of [
  'text /event-stream',
  'text{/event-stream',
  'text/ event-stream',
  'text/event stream',
  'text/event{stream',
  'text/event-stream extra',
  'text//event-stream',
  '/event-stream',
  'text/',
  'text/event-stream;',
  'text/event-stream; charset',
  'text/event-stream; charset=',
  'text/event-stream; charset="unterminated',
  'text/event-stream\r\nsecret: value',
  'text/event-stream; charset=utf-8; charset=utf-8',
  'text/event-stream; key=hello world',
  'text/event-stream; key="bad\u0001"',
  'export class PlanProvider {/event-stream',
  'text/const codes',
])
  test('strict MIME rejects ' + JSON.stringify(value), () => {
    assert.equal(normalizeMime(value), null);
    assert.deepEqual(safeDiagnostic({ mimeType: value, token: 'SECRET' }), {});
  });
for (const value of [
  'text/event-stream',
  'TEXT/EVENT-STREAM',
  ' text/event-stream ',
  'text/event-stream; charset=utf-8',
  'text/event-stream; charset="utf-8"',
  'text/event-stream; note="quoted; value"',
])
  test('strict MIME normalizes ' + value, () => {
    assert.equal(normalizeMime(value), 'text/event-stream');
    assert.equal(
      mimeMetadata(new Headers({ 'content-type': value })).mimeType,
      'text/event-stream',
    );
    assert.deepEqual(safeDiagnostic({ mimeType: value }), {
      mimeType: 'text/event-stream',
    });
  });
test('parameter contents never escape metadata', () => {
  assert.deepEqual(
    safeDiagnostic({
      mimeType: 'application/json; secret="DO_NOT_LOG"',
      bodyStructure: 'SECRET',
    }),
    { mimeType: 'application/json' },
  );
});
test('HTML, JSON and fake SSE cannot complete inference', async () => {
  for (const [mime, body] of [
    ['application/json', '{"object":"response","status":"completed"}'],
    ['text/html', '<html>SECRET</html>'],
    ['text/plain', 'data: {"type":"response.completed"}\n\n'],
    ['text/event-stream', 'data: {"type":"response.created"}\n\n'],
  ]) {
    let calls = 0;
    const p = new PlanProvider(
      {
        scopes: ['chatgpt.tokens.use.direct'],
        accessToken: 'OFFLINE',
        expiresAt: Date.now() + 60000,
      },
      async (url) => {
        if (url.endsWith('/models'))
          return Response.json({
            models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }],
          });
        calls++;
        return new Response(body, { headers: { 'content-type': mime } });
      },
    );
    await assert.rejects(
      p.infer(
        { model: 'gpt-6.1-sol', instructions: 'fixture', input: 'fixture' },
        { expiresAt: Date.now() + 60000 },
      ),
      mime === 'text/event-stream' ? /STREAM_NOT_COMPLETED/ : /SSE_REQUIRED/,
    );
    assert.equal(calls, 1);
  }
});
