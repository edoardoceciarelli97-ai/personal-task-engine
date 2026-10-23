#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Engine, requireTrue, runSchedule } from './engine.mjs';
import { eligibility, begin, complete, refresh, catalog, PlanProvider } from './siwc.mjs';
import { load, save, remove, consumePending } from './vault.mjs';
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
export async function login(root, evidence) {
  requireTrue(eligibility(evidence).readyToRequestRegistration, 'OSS_ELIGIBILITY_NOT_ESTABLISHED');
  let host = load(root, 'host');
  if (!host) {
    host = { id: 'urn:uuid:' + randomUUID() };
    save(root, 'host', host);
  }
  const previous = load(root, 'grant'),
    server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port,
    redirectUri = 'http://127.0.0.1:' + port + '/auth/callback';
  try {
    const { attempt, url } = begin({ evidence, hostId: host.id, redirectUri, previous });
    save(root, 'pending', attempt);
    process.stdout.write('Complete personal consent in the official browser:\n' + url + '\n');
    await new Promise((resolve, reject) => {
      let busy = false;
      const timer = setTimeout(() => reject(new Error('LOGIN_TIMEOUT')), 300000);
      server.on('request', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const u = new URL(req.url, redirectUri);
        if (
          req.method !== 'GET' ||
          req.socket.remoteAddress !== '127.0.0.1' ||
          req.headers.host !== '127.0.0.1:' + port ||
          u.pathname !== '/auth/callback' ||
          busy
        ) {
          res.writeHead(400);
          res.end('Rejected');
          return;
        }
        let pending;
        try {
          pending = consumePending(root, u.searchParams.get('state'));
          busy = true;
        } catch {
          res.writeHead(400);
          res.end('Invalid callback');
          return;
        }
        try {
          const grant = await complete(pending, Object.fromEntries(u.searchParams));
          save(root, 'grant', grant);
          res.end('Personal authorization saved. No inference started.');
          clearTimeout(timer);
          resolve();
        } catch {
          res.writeHead(400);
          res.end('Authorization rejected. No inference started.');
          clearTimeout(timer);
          reject(new Error('PERSONAL_AUTHORIZATION_FAILED'));
        }
      });
    });
  } finally {
    server.closeAllConnections();
    server.close();
    remove(root, 'pending');
  }
}
export async function main(args = process.argv.slice(2)) {
  const [command, root, owner, file] = args;
  requireTrue(root && path.isAbsolute(root), 'PRIVATE_DATA_DIRECTORY_REQUIRED');
  if (command === 'login') return login(root, json(owner));
  if (command === 'disconnect') {
    remove(root, 'grant');
    return {
      localGrantRemoved: true,
      remoteRevocation: 'Revoke in ChatGPT account settings; not asserted by local deletion',
    };
  }
  if (command === 'auth-status') {
    const g = load(root, 'grant');
    return g
      ? {
          connected: true,
          subject: g.subject,
          clientId: g.clientId,
          scopes: g.scopes,
          expiresAt: g.expiresAt,
        }
      : { connected: false };
  }
  if (command === 'models') {
    let g = load(root, 'grant');
    requireTrue(g, 'LOGIN_REQUIRED');
    if (g.expiresAt <= Date.now() + 60000) {
      g = await refresh(g);
      save(root, 'grant', g);
    }
    return { models: await catalog(g), quotaRemaining: 'NOT_EXPOSED_BY_THIS_CATALOG' };
  }
  const engine = new Engine(root, owner);
  try {
    if (command === 'enqueue') return engine.enqueue(json(file));
    if (command === 'authorize') {
      const c = json(file);
      engine.authorize(c.jobId, c);
      return { authorized: c.jobId };
    }
    if (command === 'status')
      return {
        jobs: engine.db.prepare('SELECT id,state,attempts,digest FROM jobs').all(),
        auditValid: engine.auditValid(),
      };
    if (command === 'pause') {
      engine.pause('OWNER_REQUEST');
      return { paused: true };
    }
    if (command === 'resume') {
      engine.resume();
      return { resumed: true, automaticRetry: false };
    }
    if (command === 'recover') {
      engine.recover();
      return { recoveredWithoutRetry: true };
    }
    if (command === 'revoke') {
      engine.revoke(file);
      return { revoked: file };
    }
    if (command === 'review') {
      const r = json(file);
      engine.review(r.id, r.approved);
      return { reviewed: r.id };
    }
    if (command === 'run-one' || command === 'watch') {
      const e = json(file);
      requireTrue(eligibility(e).readyToRequestRegistration, 'OSS_ELIGIBILITY_NOT_ESTABLISHED');
      let g = load(root, 'grant');
      requireTrue(g && g.subject === owner, 'PERSONAL_ACCOUNT_MISMATCH');
      if (g.expiresAt <= Date.now() + 60000) {
        g = await refresh(g);
        save(root, 'grant', g);
      }
      const admission = {
        eligible: true,
        authenticated: true,
        planUsageGranted: g.scopes.includes('chatgpt.tokens.use.direct'),
        model: 'gpt-6.1-sol',
      };
      if (command === 'watch') {
        const automation = json(args[4]);
        const signal = new AbortController();
        process.once('SIGTERM', () => signal.abort());
        process.once('SIGINT', () => signal.abort());
        return await runSchedule(engine, new PlanProvider(g), admission, automation, {
          signal: signal.signal,
        });
      }
      return await engine.tick(new PlanProvider(g), admission);
    }
    throw new Error('UNKNOWN_COMMAND');
  } finally {
    engine.close();
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href)
  main()
    .then((v) => {
      if (v) process.stdout.write(JSON.stringify(v) + '\n');
    })
    .catch(() => {
      process.stderr.write(
        'BLOCKED: command failed; no automatic retry. Inspect local state without exposing credentials.\n',
      );
      process.exitCode = 1;
    });
