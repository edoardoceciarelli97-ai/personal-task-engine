import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { eligibility, begin, complete, validateIdToken, PlanProvider } from './siwc.mjs';
const evidence = {
  standalone: true,
  distribution: 'PUBLISHED_OPEN_SOURCE',
  ownerApprovedLicense: true,
  license: 'TEST_FIXTURE_ONLY',
  sourceUrl: 'https://example.invalid/source',
  hostedOfficeBackend: false,
};
const params = {
  evidence,
  hostId: 'urn:uuid:12345678-1234-4234-8234-123456789abc',
  redirectUri: 'http://127.0.0.1:1455/auth/callback',
};
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = {
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' }],
};
function jwt(changes = {}) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const h = enc({ alg: 'RS256', kid: 'test' }),
    p = enc({
      iss: 'https://auth.openai.com',
      aud: 'oaiapp_test',
      sub: 'fixture',
      nonce: 'test',
      exp: Date.now() / 1000 + 60,
      ...changes,
    });
  return (
    h + '.' + p + '.' + sign('sha256', Buffer.from(h + '.' + p), privateKey).toString('base64url')
  );
}
const binding = { clientId: 'oaiapp_test', nonce: 'test', jwks };
test('unpublished candidate cannot authorize even if owner-only', () => {
  assert.equal(
    eligibility({ standalone: true, hostedOfficeBackend: false }).readyToRequestRegistration,
    false,
  );
  assert.throws(() => begin({ ...params, evidence: { standalone: true } }), /OSS_ELIGIBILITY/);
});
test('hosted Office cannot be relabeled as OSS', () =>
  assert.equal(
    eligibility({ ...evidence, hostedOfficeBackend: true }).readyToRequestRegistration,
    false,
  ));
test('eligibility declaration never attests OpenAI admission', () =>
  assert.equal(eligibility(evidence).openAIAdmissionProven, false));
test('PKCE fresh state, app identity and exact callback', () => {
  const a = begin(params),
    b = begin(params),
    u = new URL(a.url);
  assert.notEqual(a.attempt.state, b.attempt.state);
  assert.equal(u.searchParams.get('agent_name_hint'), 'Personal Task Engine');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(u.searchParams.has('code_verifier'), false);
});
test('non-loopback callback rejected', () =>
  assert.throws(
    () => begin({ ...params, redirectUri: 'https://example.invalid/callback' }),
    /LOOPBACK/,
  ));
test('OAuth wrong state stops before network', async () => {
  const { attempt } = begin(params);
  await assert.rejects(
    complete(attempt, { state: 'wrong' }, () => {
      throw new Error('NETWORK_MUST_NOT_RUN');
    }),
    /OAUTH_STATE/,
  );
});
test('ID token signature validated', () =>
  assert.equal(validateIdToken(jwt(), binding).subject, 'fixture'));
for (const [key, value] of [
  ['iss', 'https://invalid.example'],
  ['aud', 'oaiapp_other'],
  ['nonce', 'wrong'],
  ['exp', 1],
  ['nbf', 9999999999],
])
  test('ID token rejects ' + key, () =>
    assert.throws(() => validateIdToken(jwt({ [key]: value }), binding)),
  );
test('ID token subject cannot change during refresh', () =>
  assert.throws(() => validateIdToken(jwt(), { ...binding, subject: 'other' }), /ACCOUNT_CHANGED/));
test('granted direct scope is mandatory', async () => {
  const { attempt } = begin(params);
  await assert.rejects(
    complete(
      attempt,
      { state: attempt.state, code: 'FIXTURE_CODE', client_id: 'oaiapp_test' },
      async () =>
        new Response(
          JSON.stringify({
            scope: 'openid',
            token_type: 'Bearer',
            access_token: 'FIXTURE',
            refresh_token: 'FIXTURE',
            id_token: jwt(),
            expires_in: 100,
          }),
        ),
    ),
    /PLAN_GRANT/,
  );
});
test('native SSE preserves measured usage and returned model, no tools', async () => {
  let posts = 0;
  const grant = {
    scopes: ['chatgpt.tokens.use.direct'],
    accessToken: 'OFFLINE_FIXTURE',
    expiresAt: Date.now() + 60000,
  };
  const fetcher = async (url, init) => {
    if (url.endsWith('/models'))
      return new Response(
        JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] }),
      );
    posts++;
    const body = JSON.parse(init.body);
    assert.deepEqual(body.tools, []);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.max_output_tokens, undefined);
    return new Response(
      'data: {"type":"response.output_text.delta","delta":"{\\"ok\\":true}"}\n\ndata: {"type":"response.completed","response":{"status":"completed","model":"gpt-6.1-sol","id":"fixture","usage":{"input_tokens":3,"output_tokens":4}}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
  const r = await new PlanProvider(grant, fetcher).infer(
    { model: 'gpt-6.1-sol', instructions: 'fixture' },
    { expiresAt: Date.now() + 60000 },
  );
  assert.equal(posts, 1);
  assert.equal(r.usage.input_tokens, 3);
  assert.equal(r.observedModel, 'gpt-6.1-sol');
});
test('interrupted SSE never succeeds or retries', async () => {
  let calls = 0;
  const p = new PlanProvider(
    {
      scopes: ['chatgpt.tokens.use.direct'],
      accessToken: 'FIXTURE',
      expiresAt: Date.now() + 60000,
    },
    async (url) => {
      if (url.endsWith('/models'))
        return new Response(
          JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] }),
        );
      calls++;
      return new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  );
  await assert.rejects(
    p.infer({ model: 'gpt-6.1-sol', instructions: 'fixture' }, { expiresAt: Date.now() + 60000 }),
    /STREAM_NOT_COMPLETED/,
  );
  assert.equal(calls, 1);
});
test('consent expiring during catalog prevents POST', async () => {
  let posts = 0;
  const context = { expiresAt: Date.now() + 60000 };
  const p = new PlanProvider(
    {
      scopes: ['chatgpt.tokens.use.direct'],
      accessToken: 'FIXTURE',
      expiresAt: Date.now() + 60000,
    },
    async (url) => {
      if (url.endsWith('/models')) {
        context.expiresAt = 1;
        return new Response(
          JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] }),
        );
      }
      posts++;
      throw new Error('MUST_NOT_POST');
    },
  );
  await assert.rejects(p.infer({ model: 'gpt-6.1-sol' }, context), /CONSENT_OR_GRANT/);
  assert.equal(posts, 0);
});
test('quota error after stream started is retained without retry', async () => {
  let posts = 0;
  const p = new PlanProvider(
    {
      scopes: ['chatgpt.tokens.use.direct'],
      accessToken: 'FIXTURE',
      expiresAt: Date.now() + 60000,
    },
    async (url) => {
      if (url.endsWith('/models'))
        return new Response(
          JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] }),
        );
      posts++;
      return new Response(
        'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  );
  await assert.rejects(
    p.infer({ model: 'gpt-6.1-sol' }, { expiresAt: Date.now() + 60000 }),
    (e) => e.code === 'subscription_sharing_usage_limit_exceeded',
  );
  assert.equal(posts, 1);
});
