import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceBaseDir } from '../workspace/registry.js';

/**
 * M05 — the secrets primitive: at-rest encryption for the user's ANTHROPIC API key
 * (`agent_credential`). 2.1.57 (m24-requires-m05): M24 encrypts the remote session
 * token (`remote_session.access_token`) with it too — same algorithm, same keyring.
 *
 * Algorithm: AES-256-GCM with a random 12-byte IV per encryption. Stored format is
 * base64 of `iv | authTag | ciphertext`. The keyring is 32 random bytes generated
 * once (lazy-create on first write) and kept in `~/.claude4spec/secret.key`
 * (mode 0600) — OUTSIDE the repo and OUTSIDE the per-project SQLite slot.
 *
 * Protection boundary (deliberately accepted): this protects a raw copy of
 * `db.sqlite` (a backup, an accidental commit) WITHOUT the keyring file. It does
 * NOT protect against access to the same machine (where the keyring is readable).
 */

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

/** `~/.claude4spec/secret.key` — honors the `C4S_HOME` override via `workspaceBaseDir()`. */
function keyringPath(): string {
  return path.join(workspaceBaseDir(), 'secret.key');
}

function readKeyring(file: string): Buffer {
  const key = fs.readFileSync(file);
  if (key.length !== KEY_BYTES) {
    throw new Error(`secret.key is corrupt: expected ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

/**
 * Lazily create the 32-byte keyring on first use; read it on subsequent calls.
 * 2.1.62 (M54 writes from several processes): the key is written to a private
 * temp file and published with `link`, which fails if `secret.key` already
 * exists — so two processes making their first write at once agree on ONE key
 * (the loser reads the winner's) and nobody ever sees a half-written file.
 */
function loadKeyring(): Buffer {
  const file = keyringPath();
  if (fs.existsSync(file)) return readKeyring(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const key = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(tmp, key, { mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
    return key;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return readKeyring(file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Encrypt plaintext → base64 `iv | authTag | ciphertext`. */
export function encrypt(plaintext: string): string {
  const key = loadKeyring();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** Decrypt a base64 `iv | authTag | ciphertext` blob back to plaintext. */
export function decrypt(stored: string): string {
  const key = loadKeyring();
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
