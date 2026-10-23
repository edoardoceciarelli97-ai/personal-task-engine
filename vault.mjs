import {
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  lstatSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { privateDirectory, requireTrue } from './engine.mjs';
const names = ['grant', 'host', 'pending'];
function target(root, name) {
  privateDirectory(root);
  requireTrue(names.includes(name), 'INVALID_VAULT_KEY');
  return path.join(root, name + '.json');
}
export function save(root, name, value) {
  const file = target(root, name),
    tmp = file + '.new';
  try {
    const st = lstatSync(file);
    requireTrue(
      st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() && !(st.mode & 0o077),
      'UNSAFE_VAULT_FILE',
    );
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  const dir = openSync(root, 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export function load(root, name) {
  const file = target(root, name);
  let st;
  try {
    st = lstatSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  requireTrue(
    st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() && !(st.mode & 0o077),
    'UNSAFE_VAULT_FILE',
  );
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function remove(root, name) {
  const file = target(root, name);
  if (load(root, name)) unlinkSync(file);
}
export function consumePending(root, state) {
  const pending = load(root, 'pending');
  requireTrue(
    pending && pending.state === state && pending.expiresAt > Date.now(),
    'OAUTH_PENDING_STATE',
  );
  const from = target(root, 'pending'),
    consumed = from + '.consumed';
  renameSync(from, consumed);
  try {
    return pending;
  } finally {
    unlinkSync(consumed);
  }
}
