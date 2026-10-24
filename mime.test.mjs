import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanProvider, mimeMetadata, inspectUnexpected } from './siwc.mjs';
import { safeDiagnostic } from './engine.mjs';
const grant = {
  accessToken: 'OFFLINE_FIXTURE',
  scopes: ['chatgpt.tokens.use.direct'],
  expiresAt: Date.now() + 60000,
};
const job = {
  model: 'gpt-6.1-sol',
  instructions: 'fixture',
  input: 'fixture',
  documents: [],
  memory: [],
};
async function run(response) {
  const events = [];
  let calls = 0;
  const provider = new PlanProvider(
    grant,
    async (url, options) => {
      if (url.endsWith('/models'))
        return Response.json({
          models: [{ slug: job.model, visibility: 'list' }],
        });
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer OFFLINE_FIXTURE');
      const b = JSON.parse(options.body);
      assert.deepEqual(
        [b.model, b.store, b.stream, b.tools],
        [job.model, false, true, []],
      );
      return response;
    },
    (d) => events.push(safeDiagnostic(d)),
  );
  try {
    return {
      value: await provider.infer(job, { expiresAt: Date.now() + 60000 }),
      events,
      calls,
    };
  } catch (error) {
    return { error, events, calls };
  }
}
const terminal =
  'data: ' +
  JSON.stringify({
    type: 'response.completed',
    response: {
      status: 'completed',
      model: job.model,
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '{}' }],
        },
      ],
    },
  }) +
  '\n\n';
test('headerless SSE with response.completed is accepted', async () => {
  const r = await run(new Response(new TextEncoder().encode(terminal)));
  assert.equal(r.calls, 1);
  assert.equal(r.value.text, '{}');
  assert(r.events.some((e) => e.contentTypePresent === false && e.mimeType === null));
  assert(r.events.some((e) => e.terminalType === 'response.completed'));
});
test('headerless SSE >8 KiB is parsed, not rejected by diagnostic size', async () => {
  const output = JSON.stringify({ message: 'x'.repeat(16000) });
  const event =
    'data: ' +
    JSON.stringify({
      type: 'response.completed',
      response: {
        status: 'completed',
        model: job.model,
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: output }],
          },
        ],
      },
    }) +
    '\n\n';
  assert(Buffer.byteLength(event) > 8192);
  const r = await run(new Response(new TextEncoder().encode(event)));
  assert.equal(r.calls, 1);
  assert.equal(r.value.text, output);
  assert(r.events.some((e) => e.terminalType === 'response.completed'));
});
test('headerless HTML and JSON never count as completed inference', async () => {
  for (const body of [
    '<!DOCTYPE html><html>not an SSE response</html>',
    '{"object":"response","status":"completed"}',
  ]) {
    const r = await run(new Response(new TextEncoder().encode(body)));
    assert.equal(r.calls, 1);
    assert.equal(r.error.code, 'STREAM_NOT_COMPLETED');
    assert(!r.events.some((e) => e.terminalType === 'response.completed'));
  }
});
test('headerless SSE with no completed event is rejected', async () => {
  const body = 'data: {"type":"response.created"}\n\n';
  const r = await run(new Response(new TextEncoder().encode(body)));
  assert.equal(r.calls, 1);
  assert.equal(r.error.code, 'STREAM_NOT_COMPLETED');
});
test('explicit wrong MIME still blocks even valid SSE', async () => {
  const r = await run(
    new Response(terminal, { headers: { 'content-type': 'application/json' } }),
  );
  assert.equal(r.error.code, 'SSE_REQUIRED');
  assert(!r.value);
});

test('valid mixed-case MIME with parameters remains SSE', async () => {
  const r = await run(
    new Response(terminal, {
      headers: { 'content-type': 'Text/Event-Stream; charset=utf-8' },
    }),
  );
  assert.equal(r.value.text, '{}');
  assert.equal(r.calls, 1);
});
test('absent content-type is explicit; JSON is never success', async () => {
  const r = await run(
    new Response(
      new TextEncoder().encode('{"object":"response","output":"PRIVATE_TEXT"}'),
    ),
  );
  assert.equal(r.error.code, 'SSE_REQUIRED');
  assert(
    r.events.some((e) => e.contentTypePresent === false && e.mimeType === null),
  );
  assert(r.events.some((e) => e.bodyStructure === 'JSON_OBJECT_RESPONSE'));
  assert(!JSON.stringify(r.events).includes('PRIVATE_TEXT'));
});
test('unexpected JSON error records only allowlisted code', async () => {
  const r = await run(
    Response.json({
      error: {
        code: 'insufficient_scope',
        message: 'SECRET',
        access_token: 'SECRET',
      },
    }),
  );
  assert.equal(r.error.code, 'SSE_REQUIRED');
  assert(r.events.some((e) => e.providerErrorCode === 'insufficient_scope'));
  assert(!JSON.stringify(r.events).includes('SECRET'));
});
test('HTML is classified without body logging', async () => {
  const r = await run(
    new Response('<!DOCTYPE html><html>SECRET</html>', {
      headers: { 'content-type': 'text/html', 'x-request-id': 'req_fixture' },
    }),
  );
  assert.equal(r.error.code, 'SSE_REQUIRED');
  assert(
    r.events.some(
      (e) => e.bodyStructure === 'HTML' && e.requestId === 'req_fixture',
    ),
  );
  assert(!JSON.stringify(r.events).includes('SECRET'));
});
test('malformed MIME does not admit substring spoofing', async () => {
  const r = await run(
    new Response(terminal, {
      headers: { 'content-type': 'application/x-text/event-stream' },
    }),
  );
  assert.equal(r.error.code, 'SSE_REQUIRED');
});
test('mislabelled SSE only classified, not accepted', async () => {
  const r = await run(
    new Response(terminal, { headers: { 'content-type': 'text/plain' } }),
  );
  assert.equal(r.error.code, 'SSE_REQUIRED');
  assert(r.events.some((e) => e.bodyStructure === 'SSE_LIKE'));
});
test('unexpected body diagnostic is bounded', async () => {
  assert.equal(
    (await inspectUnexpected(new Response('x'.repeat(9000)))).bodyStructure,
    'LIMIT_REACHED',
  );
});
test('header parameters and arbitrary error codes excluded', async () => {
  assert.deepEqual(
    mimeMetadata(
      new Headers({ 'content-type': 'application/json; private=SECRET' }),
    ),
    { contentTypePresent: true, mimeType: 'application/json' },
  );
  const r = await run(Response.json({ error: { code: 'SECRET' } }));
  assert(!JSON.stringify(r.events).includes('SECRET'));
});
test('valid SSE without completed remains uncertain', async () => {
  const r = await run(
    new Response(
      'data: {"type":"response.output_text.delta","delta":"{}"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  );
  assert.equal(r.error.code, 'STREAM_NOT_COMPLETED');
});
