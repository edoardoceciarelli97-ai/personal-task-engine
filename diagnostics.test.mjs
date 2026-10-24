import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine, safeDiagnostic } from './engine.mjs';
import { PlanProvider } from './siwc.mjs';
const grant = {
  scopes: ['chatgpt.tokens.use.direct'],
  expiresAt: Date.now() + 600000,
  accessToken: 'OFFLINE_FIXTURE',
};
const job = {
  model: 'gpt-6.1-sol',
  role: 'fixture',
  version: '1',
  instructions: 'JSON only',
  input: 'fixture',
  documents: [],
  memory: [],
};
const admission = {
  eligible: true,
  authenticated: true,
  planUsageGranted: true,
  model: 'gpt-6.1-sol',
};
function terminal(text = '{"ok":true}') {
  return {
    type: 'response.completed',
    response: {
      status: 'completed',
      id: 'resp_fixture',
      model: 'gpt-6.1-sol',
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        },
      ],
    },
  };
}
function stream(text) {
  return new Response(text, {
    headers: {
      'content-type': 'text/event-stream',
      'x-request-id': 'req_fixture',
    },
  });
}
function provider(response) {
  let calls = 0;
  const p = new PlanProvider(grant, async (url) => {
    if (url.endsWith('/models'))
      return Response.json({
        models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }],
      });
    calls++;
    return typeof response === 'function' ? response() : response;
  });
  return { p, count: () => calls };
}
async function run(t, response) {
  const dir = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'pte-diag-'));
  const e = new Engine(dir, 'fixture');
  t.after(() => {
    e.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const j = e.enqueue(job);
  e.authorize(j.id, {
    owner: 'fixture',
    jobId: j.id,
    inputHash: j.digest,
    model: job.model,
    maxAttempts: 1,
    personalOnly: true,
    extraApiBilling: false,
    externalTools: false,
    source: 'OFFLINE_ONLY',
    expiresAt: Date.now() + 60000,
  });
  const { p, count } = provider(response);
  const r = await e.tick(p, admission);
  return {
    e,
    j,
    r,
    count,
    audit: () =>
      e.db
        .prepare('SELECT event FROM audit WHERE job=? ORDER BY seq')
        .all(j.id)
        .map((x) => JSON.parse(x.event)),
  };
}
test('terminal-only output succeeds; measured usage and checkpoints persist', async (t) => {
  const x = await run(
    t,
    stream('data: ' + JSON.stringify(terminal()) + '\n\n'),
  );
  assert.equal(x.r.state, 'VERIFYING');
  assert.equal(x.r.result.usage.total_tokens, 5);
  assert.equal(x.count(), 1);
  assert(
    x
      .audit()
      .some(
        (x) => x.data.phase === 'http_response' && x.data.httpStatus === 200,
      ),
  );
});
test('multiline SSE data and CRLF split across chunks', async () => {
  const json = JSON.stringify(terminal(), null, 2);
  const event =
    json
      .split('\n')
      .map((x) => 'data: ' + x)
      .join('\r\n') + '\r\n\r\n';
  const bytes = new TextEncoder().encode(event);
  const { p } = provider(
    new Response(
      new ReadableStream({
        start(c) {
          for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
          c.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  );
  assert.equal(
    (await p.infer(job, { expiresAt: Date.now() + 60000 })).text,
    '{"ok":true}',
  );
});
test('invalid result JSON stays uncertain while measured response evidence survives', async (t) => {
  const x = await run(
    t,
    stream('data: ' + JSON.stringify(terminal('not json')) + '\n\n'),
  );
  assert.equal(x.r.state, 'UNCERTAIN');
  const f = x.audit().find((x) => x.type === 'UNCERTAIN_NO_RETRY').data;
  assert.equal(f.errorCode, 'INVALID_OUTPUT_JSON');
  assert.equal(f.responseEvidence.providerResponseId, 'resp_fixture');
  assert.equal(f.responseEvidence.usage.total_tokens, 5);
  assert.equal(x.e.job(x.j.id).result, null);
});
test('interrupted stream cannot invent terminal, usage or result', async (t) => {
  const x = await run(
    t,
    stream('data: {"type":"response.output_text.delta","delta":"{}"}\n\n'),
  );
  assert.equal(x.r.state, 'UNCERTAIN');
  assert.equal(x.e.job(x.j.id).result, null);
  assert(
    x
      .audit()
      .some(
        (x) =>
          x.data.errorCode === 'STREAM_NOT_COMPLETED' ||
          x.data.provider?.errorCode === 'STREAM_NOT_COMPLETED',
      ),
  );
  assert.equal(x.count(), 1);
});
test('timeout records allowlisted code with no retry', async (t) => {
  const x = await run(t, () => {
    throw new DOMException('SENSITIVE_FIXTURE', 'TimeoutError');
  });
  assert.equal(x.r.state, 'UNCERTAIN');
  assert.equal(x.count(), 1);
  const log = JSON.stringify(x.audit());
  assert(log.includes('TIMEOUT'));
  assert(!log.includes('SENSITIVE_FIXTURE'));
});
for (const [status, code, state] of [
  [400, 'private-message', 'UNCERTAIN'],
  [429, 'subscription_sharing_usage_limit_exceeded', 'LIMITED'],
])
  test(
    'HTTP ' + status + ' records status without response body',
    async (t) => {
      const x = await run(
        t,
        new Response(
          JSON.stringify({ error: { code, message: 'SECRET_FIXTURE' } }),
          { status, headers: { 'x-request-id': 'req_failure' } },
        ),
      );
      assert.equal(x.r.state, state);
      assert.equal(x.count(), 1);
      assert(!JSON.stringify(x.audit()).includes('SECRET_FIXTURE'));
      assert(x.audit().some((x) => x.data.httpStatus === status));
    },
  );
test('terminal/delta mismatch is rejected', async (t) => {
  const x = await run(
    t,
    stream(
      'data: {"type":"response.output_text.delta","delta":"{}"}\n\ndata: ' +
        JSON.stringify(terminal()) +
        '\n\n',
    ),
  );
  assert.equal(x.r.state, 'UNCERTAIN');
});
test('diagnostics reject arbitrary secrets and unsafe identifiers', () => {
  assert.deepEqual(
    safeDiagnostic({
      phase: 'access_token=secret',
      requestId: 'Bearer secret',
      errorCode: 'secret',
      token: 'secret',
    }),
    {},
  );
});
for (const phase of ['before_send', 'after_send'])
  test(
    'simulated process crash ' + phase + ' retains fence without rerun',
    async (t) => {
      const dir = mkdtempSync(
        path.join(realpathSync(os.tmpdir()), 'pte-crash-'),
      );
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const script = `import {Engine} from ${JSON.stringify(new URL('./engine.mjs', import.meta.url).href)};import {writeFileSync} from 'node:fs';const e=new Engine(${JSON.stringify(dir)},'fixture');const j=e.enqueue(${JSON.stringify(job)});e.authorize(j.id,{owner:'fixture',jobId:j.id,inputHash:j.digest,model:'gpt-6.1-sol',maxAttempts:1,personalOnly:true,extraApiBilling:false,externalTools:false,source:'OFFLINE',expiresAt:Date.now()+60000});await e.tick({infer:async()=>{if(${JSON.stringify(phase)}==='after_send')writeFileSync(${JSON.stringify(dir + '/simulated-send')},'fixture');process.exit(0);}},${JSON.stringify(admission)});`;
      const child = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        { encoding: 'utf8' },
      );
      assert.equal(child.status, 0, child.stderr);
      const e = new Engine(dir, 'fixture');
      try {
        const j = e.db.prepare('SELECT * FROM jobs').get();
        assert.equal(j.state, 'RUNNING');
        assert.equal(j.attempts, 1);
        e.recover();
        assert.equal(e.job(j.id).state, 'UNCERTAIN');
        assert.equal(e.job(j.id).result, null);
        let calls = 0;
        assert.equal(
          await e.tick({ infer: async () => calls++ }, admission),
          null,
        );
        assert.equal(calls, 0);
        assert.equal(
          existsSync(dir + '/simulated-send'),
          phase === 'after_send',
        );
      } finally {
        e.close();
      }
    },
  );
