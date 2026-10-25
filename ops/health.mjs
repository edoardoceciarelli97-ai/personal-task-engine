import { readFileSync, lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function health(root, code) {
  if (!path.isAbsolute(root) || !path.isAbsolute(code))
    throw Error('ABSOLUTE_PATH_REQUIRED');
  const check = (p, dir = false) => {
    const s = lstatSync(p);
    if (
      s.isSymbolicLink() ||
      (dir ? !s.isDirectory() : !s.isFile()) ||
      s.uid !== process.getuid() ||
      s.mode & 0o077
    )
      throw Error('PRIVATE_STORAGE_REQUIRED');
  };
  check(root, true);
  for (const name of ['host', 'grant']) check(path.join(root, name + '.json'));
  const host = JSON.parse(readFileSync(path.join(root, 'host.json'))),
    grant = JSON.parse(readFileSync(path.join(root, 'grant.json')));
  if (
    !host.id ||
    grant.hostId !== host.id ||
    !grant.subject ||
    !grant.scopes?.includes('chatgpt.tokens.use.direct')
  )
    throw Error('GRANT_BINDING_REQUIRED');
  for (const line of readFileSync(path.join(code, 'MANIFEST.sha256'), 'utf8')
    .trim()
    .split('\n')) {
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (
      !m ||
      path.isAbsolute(m[2]) ||
      m[2].split('/').includes('..') ||
      createHash('sha256')
        .update(readFileSync(path.join(code, m[2])))
        .digest('hex') !== m[1]
    )
      throw Error('MANIFEST_MISMATCH');
  }
  check(path.join(root, 'engine.sqlite'));
  const d = new DatabaseSync(path.join(root, 'engine.sqlite'), {
    readOnly: true,
  });
  try {
    if (
      d.prepare("SELECT v FROM settings WHERE k='owner'").get()?.v !==
      grant.subject
    )
      throw Error('OWNER_MISMATCH');
    let previous = 'GENESIS';
    for (const r of d.prepare('SELECT * FROM audit ORDER BY seq').all()) {
      if (
        r.previous !== previous ||
        createHash('sha256')
          .update(previous + r.event)
          .digest('hex') !== r.digest
      )
        throw Error('AUDIT_BROKEN');
      previous = r.digest;
    }
    return {
      ready: true,
      grantUnexpired: grant.expiresAt > Date.now(),
      directScope: true,
      auditValid: true,
      paused:
        d.prepare("SELECT v FROM settings WHERE k='paused'").get()?.v ===
        'true',
      jobs: d
        .prepare('SELECT state,count(*) AS count FROM jobs GROUP BY state')
        .all(),
    };
  } finally {
    d.close();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(JSON.stringify(health(process.argv[2], process.argv[3])));
  } catch {
    console.error('PTE_HEALTH_BLOCKED');
    process.exitCode = 1;
  }
}
