import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../engine.mjs';
import { save } from '../vault.mjs';
import { health } from './health.mjs';
const code = path.dirname(path.dirname(new URL(import.meta.url).pathname));
function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'pte-health-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  save(root, 'host', { id: 'fixture-host' });
  save(root, 'grant', {
    hostId: 'fixture-host',
    subject: 'fixture',
    scopes: ['chatgpt.tokens.use.direct'],
    expiresAt: Date.now() + 60000,
  });
  const e = new Engine(root, 'fixture');
  e.pause('OFFLINE_FIXTURE');
  e.close();
  return root;
}
test('offline health validates paused ledger without network or inference', (t) => {
  const h = health(fixture(t), code);
  assert.equal(h.ready, true);
  assert.equal(h.paused, true);
  assert.equal(h.auditValid, true);
  assert.deepEqual(h.jobs, []);
  assert(!JSON.stringify(h).includes('fixture-host'));
});
test('health rejects host mismatch', (t) => {
  const root = fixture(t);
  save(root, 'host', { id: 'different' });
  assert.throws(() => health(root, code), /GRANT_BINDING/);
});
test('health rejects credential permissions', (t) => {
  const root = fixture(t);
  chmodSync(path.join(root, 'grant.json'), 0o644);
  assert.throws(() => health(root, code), /PRIVATE_STORAGE/);
});
test('expired token is visible without automatic refresh', (t) => {
  const root = fixture(t);
  save(root, 'grant', {
    hostId: 'fixture-host',
    subject: 'fixture',
    scopes: ['chatgpt.tokens.use.direct'],
    expiresAt: 1,
  });
  assert.equal(health(root, code).grantUnexpired, false);
});

test('health command executes through deployment symlink', (t) => {
  const root = fixture(t),
    link = path.join(root, 'entry.mjs');
  symlinkSync(path.join(code, 'ops/health.mjs'), link);
  const r = spawnSync(process.execPath, [link, root, code], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ready, true);
});
test('symlink command fails closed on unsafe storage', (t) => {
  const root = fixture(t),
    link = path.join(root, 'entry.mjs');
  symlinkSync(path.join(code, 'ops/health.mjs'), link);
  chmodSync(path.join(root, 'grant.json'), 0o644);
  const r = spawnSync(process.execPath, [link, root, code], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /PTE_HEALTH_BLOCKED/);
});
