import test from 'node:test';
import assert from 'node:assert/strict';
import {
  realpathSync,
  mkdtempSync,
  rmSync,
  chmodSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine, hash } from './engine.mjs';
import { save, load, consumePending } from './vault.mjs';
const admission = {
  eligible: true,
  authenticated: true,
  planUsageGranted: true,
  model: 'gpt-6.1-sol',
};
function fixture(t) {
  const dir = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'pte-test-'));
  const e = new Engine(dir, 'fixture-owner');
  t.after(() => {
    e.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { e, dir };
}
const job = {
  role: 'reviewer',
  version: '1',
  instructions: 'Fixture instructions. Return JSON only.',
  input: { fixture: true },
  documents: [{ name: 'fixture', content: 'Not authentic business evidence' }],
};
function allow(e, j, override = {}) {
  e.authorize(j.id, {
    owner: 'fixture-owner',
    jobId: j.id,
    inputHash: j.digest,
    model: 'gpt-6.1-sol',
    maxAttempts: 1,
    personalOnly: true,
    extraApiBilling: false,
    externalTools: false,
    source: 'OFFLINE_TEST_CONSENT_NOT_REAL',
    expiresAt: Date.now() + 60000,
    ...override,
  });
}
const good = {
  infer: async () => ({
    completed: true,
    requestedModel: 'gpt-6.1-sol',
    observedModel: 'gpt-6.1-sol',
    text: '{"fixture":true}',
    usage: { input_tokens: 1, output_tokens: 1 },
  }),
};
test('queued snapshot includes role, documents, memory and hash', (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  assert.equal(e.job(j.id).state, 'BLOCKED');
  assert.equal(hash(e.job(j.id).snapshot), j.digest);
  assert.equal(e.auditValid(), true);
});
test('no consent means no provider call', async (t) => {
  const { e } = fixture(t);
  e.enqueue(job);
  let calls = 0;
  assert.equal(await e.tick({ infer: async () => calls++ }, admission), null);
  assert.equal(calls, 0);
});
for (const [name, value] of [
  ['inputHash', 'wrong'],
  ['owner', 'other'],
  ['model', 'other'],
  ['maxAttempts', 2],
  ['externalTools', true],
  ['extraApiBilling', true],
  ['personalOnly', false],
  ['expiresAt', 1],
])
  test('reject consent ' + name, (t) => {
    const { e } = fixture(t),
      j = e.enqueue(job);
    assert.throws(() => allow(e, j, { [name]: value }));
    assert.equal(e.job(j.id).attempts, 0);
  });
test('native full flow ends in review, never auto-approved', async (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  allow(e, j);
  const r = await e.tick(good, admission);
  assert.equal(r.state, 'VERIFYING');
  assert.equal(r.result.humanReview, 'PENDING');
  e.review(j.id, false);
  assert.equal(e.job(j.id).state, 'FAILED');
  assert.equal(e.auditValid(), true);
});
test('two workers share durable single fence', async (t) => {
  const { e, dir } = fixture(t),
    second = new Engine(dir, 'fixture-owner'),
    j = e.enqueue(job);
  t.after(() => second.close());
  allow(e, j);
  let release,
    calls = 0;
  const p = e.tick(
    {
      infer: () => {
        calls++;
        return new Promise((r) => (release = r));
      },
    },
    admission,
  );
  assert.equal(await second.tick(good, admission), null);
  release(await good.infer());
  await p;
  assert.equal(calls, 1);
  assert.equal(e.job(j.id).attempts, 1);
});
test('crash reservation cannot be reauthorized or retried', async (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  allow(e, j);
  e.db.prepare("UPDATE jobs SET state='RUNNING',attempts=1 WHERE id=?").run(j.id);
  e.recover();
  assert.equal(e.job(j.id).state, 'UNCERTAIN');
  assert.throws(() => allow(e, j));
  assert.equal(await e.tick(good, admission), null);
});
test('quota suspends all jobs and resume never repeats fenced one', async (t) => {
  const { e } = fixture(t),
    a = e.enqueue(job),
    b = e.enqueue(job);
  allow(e, a);
  allow(e, b);
  await e.tick(
    {
      infer: async () => {
        throw Object.assign(new Error(), { code: 'subscription_sharing_usage_limit_exceeded' });
      },
    },
    admission,
  );
  assert.equal(await e.tick(good, admission), null);
  const fenced = e.db.prepare("SELECT id FROM jobs WHERE state='LIMITED'").get().id;
  assert.equal(e.job(fenced).attempts, 1);
  e.resume();
  await e.tick(good, admission);
  assert.equal(e.job(fenced).state, 'LIMITED');
});
test('cancelled and future due jobs do not run', async (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  allow(e, j);
  e.revoke(j.id);
  const future = e.enqueue({ ...job, due: Date.now() + 100000 });
  allow(e, future);
  assert.equal(await e.tick(good, admission), null);
});
test('expired consent stops before fencing', async (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  allow(e, j);
  assert.equal(await e.tick(good, admission, Date.now() + 120000), null);
  assert.equal(e.job(j.id).attempts, 0);
  assert.equal(e.job(j.id).state, 'BLOCKED');
});
test('tampered input stops before provider', async (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  allow(e, j);
  e.db.prepare('UPDATE jobs SET snapshot=? WHERE id=?').run('{}', j.id);
  await assert.rejects(e.tick(good, admission), /SNAPSHOT_OR_FENCE/);
  assert.equal(e.job(j.id).attempts, 0);
});
test('wrong returned model is uncertain, no fallback', async (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  allow(e, j);
  const r = await e.tick(
    { infer: async () => ({ ...(await good.infer()), observedModel: 'other' }) },
    admission,
  );
  assert.equal(r.state, 'UNCERTAIN');
  assert.equal(e.job(j.id).attempts, 1);
});
test('other-owner cannot open database', (t) => {
  const { dir } = fixture(t);
  assert.throws(() => new Engine(dir, 'other'), /OTHER_OWNER/);
});
test('vault enforces permissions and consumes callback once', (t) => {
  const { dir } = fixture(t);
  save(dir, 'pending', { state: 'test', expiresAt: Date.now() + 60000 });
  assert.throws(() => consumePending(dir, 'wrong'));
  consumePending(dir, 'test');
  assert.throws(() => consumePending(dir, 'test'));
  save(dir, 'grant', { fixture: true });
  chmodSync(path.join(dir, 'grant.json'), 0o644);
  assert.throws(() => load(dir, 'grant'), /UNSAFE/);
});
test('symlink vault target rejected', (t) => {
  const { dir } = fixture(t);
  writeFileSync(path.join(dir, 'fixture'), '{}');
  symlinkSync(path.join(dir, 'fixture'), path.join(dir, 'grant.json'));
  assert.throws(() => save(dir, 'grant', {}), /UNSAFE/);
});
test('audit edits detected', (t) => {
  const { e } = fixture(t);
  e.enqueue(job);
  e.db.prepare("UPDATE audit SET event='changed'").run();
  assert.equal(e.auditValid(), false);
});

test('bounded scheduler needs separate consent, preserves global budget on restart', async (t) => {
  const { e } = fixture(t);
  const { runSchedule } = await import('./engine.mjs');
  const a = e.enqueue(job),
    b = e.enqueue(job);
  allow(e, a);
  allow(e, b);
  let now = Date.now(),
    calls = 0;
  const consent = {
    owner: 'fixture-owner',
    personalOnly: true,
    externalTools: false,
    source: 'OFFLINE_AUTOMATION_FIXTURE',
    issuedAt: now,
    expiresAt: now + 120000,
    maxJobs: 1,
    pollSeconds: 30,
  };
  const opts = {
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  await runSchedule(
    e,
    {
      infer: async () => {
        calls++;
        return good.infer();
      },
    },
    admission,
    consent,
    opts,
  );
  await runSchedule(e, good, admission, consent, opts);
  assert.equal(calls, 1);
  assert.equal(e.db.prepare('SELECT sum(attempts) AS n FROM jobs').get().n, 1);
});
test('scheduler refuses absent consent before provider', async (t) => {
  const { e } = fixture(t);
  const { runSchedule } = await import('./engine.mjs');
  await assert.rejects(runSchedule(e, good, admission, null), /BOUNDED_AUTOMATION/);
});
test('recovery racing an active response preserves output without false VERIFYING', async (t) => {
  const { e } = fixture(t),
    j = e.enqueue(job);
  allow(e, j);
  let release;
  const pending = e.tick({ infer: () => new Promise((r) => (release = r)) }, admission);
  e.recover();
  release(await good.infer());
  const r = await pending;
  assert.equal(r.state, 'UNCERTAIN');
  assert.equal(e.job(j.id).state, 'UNCERTAIN');
  assert.ok(e.job(j.id).result);
  assert.equal(e.job(j.id).attempts, 1);
});

test('CLI standalone account status never exposes credential fields', async (t) => {
  const { dir } = fixture(t);
  const { main } = await import('./cli.mjs');
  save(dir, 'grant', {
    subject: 'fixture-owner',
    clientId: 'oaiapp_fixture',
    scopes: ['chatgpt.tokens.use.direct'],
    expiresAt: Date.now() + 60000,
    accessToken: 'FIXTURE_SECRET_ACCESS',
    refreshToken: 'FIXTURE_SECRET_REFRESH',
    idToken: 'FIXTURE_SECRET_ID',
  });
  const status = await main(['auth-status', dir]);
  assert.equal(status.subject, 'fixture-owner');
  assert.equal(JSON.stringify(status).includes('FIXTURE_SECRET'), false);
});
