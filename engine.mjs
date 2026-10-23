import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
export const hash = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
export function requireTrue(v, code) {
  if (!v) throw new Error(code);
}
export function privateDirectory(root) {
  requireTrue(
    typeof process.getuid === 'function' && process.getuid() !== 0,
    'NON_ROOT_POSIX_ACCOUNT_REQUIRED',
  );
  requireTrue(path.isAbsolute(root), 'ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED');
  // All existing ancestors must be directories, never symlinks.
  let p = path.parse(root).root;
  for (const part of root.slice(p.length).split('/').filter(Boolean)) {
    p = path.join(p, part);
    try {
      requireTrue(
        lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink(),
        'SYMLINK_OR_NON_DIRECTORY',
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      mkdirSync(p, { mode: 0o700 });
    }
  }
  const s = lstatSync(root);
  requireTrue(
    s.uid === process.getuid() && (s.mode & 0o077) === 0,
    'PRIVATE_DIRECTORY_PERMISSIONS_REQUIRED',
  );
}
export class Engine {
  constructor(root, owner) {
    requireTrue(typeof owner === 'string' && owner.length > 0, 'OWNER_REQUIRED');
    privateDirectory(root);
    this.owner = owner;
    const file = path.join(root, 'engine.sqlite');
    try {
      closeSync(openSync(file, 'wx', 0o600));
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const st = lstatSync(file);
    requireTrue(
      st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0,
      'PRIVATE_DATABASE_REQUIRED',
    );
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,snapshot TEXT NOT NULL,digest TEXT NOT NULL,due INTEGER NOT NULL,state TEXT NOT NULL,consent TEXT,attempts INTEGER NOT NULL DEFAULT 0,result TEXT);
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY,job TEXT,event TEXT NOT NULL,previous TEXT NOT NULL,digest TEXT NOT NULL);
      INSERT OR IGNORE INTO settings VALUES('paused','false');`);
    const bound = this.db.prepare("SELECT v FROM settings WHERE k='owner'").get();
    if (bound && bound.v !== owner) {
      this.db.close();
      throw new Error('OTHER_OWNER_DATABASE');
    }
    this.db.prepare("INSERT OR IGNORE INTO settings VALUES('owner',?)").run(owner);
  }
  close() {
    this.db.close();
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  event(id, type, data = {}) {
    const previous =
      this.db.prepare('SELECT digest FROM audit ORDER BY seq DESC LIMIT 1').get()?.digest ||
      'GENESIS';
    const event = JSON.stringify({ type, data, at: new Date().toISOString() });
    this.db
      .prepare('INSERT INTO audit(job,event,previous,digest) VALUES(?,?,?,?)')
      .run(id, event, previous, hash(previous + event));
  }
  enqueue({ role, version, instructions, input, documents = [], memory = [], due = Date.now() }) {
    requireTrue(
      typeof role === 'string' &&
        role.length &&
        typeof version === 'string' &&
        version.length &&
        typeof instructions === 'string' &&
        instructions.length,
      'VERSIONED_ROLE_REQUIRED',
    );
    requireTrue(
      Number.isSafeInteger(due) && Array.isArray(documents) && Array.isArray(memory),
      'INVALID_SNAPSHOT',
    );
    const snapshot = JSON.stringify({
      model: 'gpt-6.1-sol',
      role,
      version,
      instructions,
      input,
      documents,
      memory,
    });
    requireTrue(Buffer.byteLength(snapshot) <= 60000, 'INPUT_TOO_LARGE');
    const id = randomUUID(),
      digest = hash(snapshot);
    this.tx(() => {
      this.db
        .prepare("INSERT INTO jobs(id,owner,snapshot,digest,due,state) VALUES(?,?,?,?,?,'BLOCKED')")
        .run(id, this.owner, snapshot, digest, due);
      this.event(id, 'CREATED_BLOCKED');
    });
    return { id, digest };
  }
  job(id) {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(id, this.owner);
    requireTrue(r, 'JOB_NOT_FOUND');
    return r;
  }
  authorize(id, c, now = Date.now()) {
    this.tx(() => {
      const j = this.job(id);
      requireTrue(j.state === 'BLOCKED' && j.attempts === 0, 'JOB_NOT_AUTHORIZABLE');
      requireTrue(
        c.owner === this.owner &&
          c.jobId === id &&
          c.inputHash === j.digest &&
          c.model === 'gpt-6.1-sol' &&
          c.maxAttempts === 1 &&
          c.personalOnly === true &&
          c.extraApiBilling === false &&
          c.externalTools === false &&
          typeof c.source === 'string' &&
          c.source.length,
        'SPECIFIC_PERSONAL_CONSENT_REQUIRED',
      );
      requireTrue(
        Number.isSafeInteger(c.expiresAt) && c.expiresAt > now && c.expiresAt <= now + 86400000,
        'CONSENT_EXPIRED_OR_TOO_LONG',
      );
      this.db
        .prepare("UPDATE jobs SET consent=?,state='QUEUED' WHERE id=?")
        .run(JSON.stringify(c), id);
      this.event(id, 'OWNER_AUTHORIZED', { consentHash: hash(c) });
    });
  }
  revoke(id) {
    this.tx(() => {
      const j = this.job(id);
      requireTrue(['BLOCKED', 'QUEUED'].includes(j.state), 'ALREADY_FENCED');
      this.db.prepare("UPDATE jobs SET state='CANCELLED' WHERE id=?").run(id);
      this.event(id, 'OWNER_REVOKED');
    });
  }
  pause(reason) {
    this.tx(() => {
      this.db.prepare("UPDATE settings SET v='true' WHERE k='paused'").run();
      this.event(null, 'PAUSED', { reason });
    });
  }
  resume() {
    this.tx(() => {
      this.db.prepare("UPDATE settings SET v='false' WHERE k='paused'").run();
      this.event(null, 'OWNER_RESUMED_NO_RETRY');
    });
  }
  recover() {
    this.tx(() => {
      for (const r of this.db.prepare("SELECT id FROM jobs WHERE state='RUNNING'").all()) {
        this.db.prepare("UPDATE jobs SET state='UNCERTAIN' WHERE id=?").run(r.id);
        this.event(r.id, 'CRASH_UNCERTAIN_NO_RETRY');
      }
    });
  }
  async tick(provider, admission, now = Date.now(), automation = null) {
    if (automation) validateAutomation(automation, this.owner, now);
    // No daemon is started. Calling tick is a local owner-controlled action.
    requireTrue(
      admission?.eligible === true &&
        admission?.authenticated === true &&
        admission?.planUsageGranted === true &&
        admission?.model === 'gpt-6.1-sol',
      'SIWC_ADMISSION_REQUIRED',
    );
    const j = this.tx(() => {
      if (this.db.prepare("SELECT v FROM settings WHERE k='paused'").get().v === 'true')
        return null;
      if (this.db.prepare("SELECT id FROM jobs WHERE state='RUNNING'").get()) return null;
      const r = this.db
        .prepare(
          "SELECT * FROM jobs WHERE owner=? AND state='QUEUED' AND due<=? ORDER BY due,id LIMIT 1",
        )
        .get(this.owner, now);
      if (!r) return null;
      const c = JSON.parse(r.consent);
      if (c.expiresAt <= now) {
        this.db.prepare("UPDATE jobs SET state='BLOCKED',consent=NULL WHERE id=?").run(r.id);
        this.event(r.id, 'CONSENT_EXPIRED');
        return null;
      }
      requireTrue(
        hash(r.snapshot) === r.digest && c.inputHash === r.digest && r.attempts === 0,
        'SNAPSHOT_OR_FENCE_INVALID',
      );
      if (automation) {
        const key = 'automation:' + hash(automation);
        const used = Number(this.db.prepare('SELECT v FROM settings WHERE k=?').get(key)?.v || 0);
        requireTrue(used < automation.maxJobs, 'AUTOMATION_BUDGET_EXHAUSTED');
        this.db
          .prepare(
            'INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',
          )
          .run(key, String(used + 1));
      }
      this.db.prepare("UPDATE jobs SET state='RUNNING',attempts=1 WHERE id=?").run(r.id);
      this.event(r.id, 'DURABLE_ATTEMPT_RESERVED');
      return r;
    });
    if (!j) return null;
    try {
      const response = await provider.infer(JSON.parse(j.snapshot), {
        expiresAt: JSON.parse(j.consent).expiresAt,
      });
      requireTrue(
        response?.completed === true && response.requestedModel === 'gpt-6.1-sol',
        'INCOMPLETE_RESPONSE',
      );
      requireTrue(
        !response.observedModel || response.observedModel === 'gpt-6.1-sol',
        'WRONG_MODEL',
      );
      const output = JSON.parse(response.text);
      requireTrue(
        output && typeof output === 'object' && !Array.isArray(output),
        'JSON_OBJECT_OUTPUT_REQUIRED',
      );
      const result = {
        version: 1,
        inputHash: j.digest,
        requestedModel: 'gpt-6.1-sol',
        observedModel: response.observedModel || null,
        providerResponseId: response.id || null,
        usage: response.usage || null,
        output,
        outputHash: hash(output),
        humanReview: 'PENDING',
        origin: 'PERSONAL_SIWC_NOT_P3_BROKER_RECEIPT',
      };
      const persistedState = this.tx(() => {
        const state = this.job(j.id).state === 'RUNNING' ? 'VERIFYING' : 'UNCERTAIN';
        this.db
          .prepare('UPDATE jobs SET state=?,result=? WHERE id=?')
          .run(state, JSON.stringify(result), j.id);
        this.event(
          j.id,
          state === 'VERIFYING'
            ? 'RESULT_AWAITING_HUMAN_REVIEW'
            : 'RESULT_RETAINED_FOR_RECONCILIATION',
          { resultHash: hash(result) },
        );
        return state;
      });
      return { id: j.id, state: persistedState, result };
    } catch (e) {
      const limit = [
        'subscription_sharing_usage_limit_exceeded',
        'subscription_sharing_usage_unavailable',
      ].includes(e.code);
      this.tx(() => {
        this.db
          .prepare('UPDATE jobs SET state=? WHERE id=?')
          .run(limit ? 'LIMITED' : 'UNCERTAIN', j.id);
        this.event(j.id, limit ? 'PLAN_LIMIT_NO_RETRY' : 'UNCERTAIN_NO_RETRY');
      });
      this.pause(limit ? 'PLAN_LIMIT' : 'RECONCILIATION_REQUIRED');
      return { id: j.id, state: limit ? 'LIMITED' : 'UNCERTAIN' };
    }
  }
  review(id, approved) {
    requireTrue(typeof approved === 'boolean', 'HUMAN_DECISION_REQUIRED');
    this.tx(() => {
      const j = this.job(id);
      requireTrue(j.state === 'VERIFYING', 'NOT_REVIEWABLE');
      this.db
        .prepare('UPDATE jobs SET state=? WHERE id=?')
        .run(approved ? 'COMPLETED' : 'FAILED', id);
      this.event(id, 'OWNER_REVIEW', { approved });
    });
  }
  auditValid() {
    let previous = 'GENESIS';
    for (const r of this.db.prepare('SELECT * FROM audit ORDER BY seq').all()) {
      if (r.previous !== previous || r.digest !== hash(previous + r.event)) return false;
      previous = r.digest;
    }
    return true;
  }
}

export function validateAutomation(c, owner, now = Date.now()) {
  requireTrue(
    c?.owner === owner &&
      c.personalOnly === true &&
      c.externalTools === false &&
      typeof c.source === 'string' &&
      c.source.length &&
      Number.isSafeInteger(c.issuedAt) &&
      c.issuedAt <= now &&
      Number.isSafeInteger(c.expiresAt) &&
      c.expiresAt > now &&
      c.expiresAt - c.issuedAt <= 86400000 &&
      Number.isSafeInteger(c.maxJobs) &&
      c.maxJobs >= 1 &&
      c.maxJobs <= 100 &&
      Number.isSafeInteger(c.pollSeconds) &&
      c.pollSeconds >= 30 &&
      c.pollSeconds <= 3600,
    'EXPLICIT_BOUNDED_AUTOMATION_CONSENT_REQUIRED',
  );
}
export async function runSchedule(
  engine,
  provider,
  admission,
  automation,
  { clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), signal } = {},
) {
  validateAutomation(automation, engine.owner, clock());
  while (clock() < automation.expiresAt && !signal?.aborted) {
    if (engine.db.prepare("SELECT v FROM settings WHERE k='paused'").get().v === 'true') break;
    const key = 'automation:' + hash(automation);
    const used = Number(engine.db.prepare('SELECT v FROM settings WHERE k=?').get(key)?.v || 0);
    if (used >= automation.maxJobs) break;
    await engine.tick(provider, admission, clock(), automation);
    if (signal?.aborted) break;
    await sleep(
      Math.min(automation.pollSeconds * 1000, Math.max(0, automation.expiresAt - clock())),
    );
  }
  return { state: 'SCHEDULE_STOPPED', automaticRetry: false };
}
