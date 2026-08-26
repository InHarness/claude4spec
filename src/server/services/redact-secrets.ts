/**
 * Strip secret-bearing values out of a config object before it reaches a log.
 *
 * The one caller today is the `adapter_ready` branch of the turn loop, which
 * logs the adapter's `sdkConfig` so a support question like "what did this turn
 * actually run with" is answerable from the server log. That object is built by
 * the library and its shape is NOT ours: it grows between releases, and
 * `custom_env` carries a decrypted `ANTHROPIC_API_KEY` whenever the project
 * uses a stored credential. Logging it verbatim would put a live API key in
 * plaintext on disk.
 *
 * The rule is DENY-BY-KEY-NAME, applied at every depth, and it errs toward
 * over-redaction: a key that merely looks secret-shaped is redacted even when
 * its value is harmless. Over-redacting costs a debugging detail; under-
 * redacting leaks a credential, and only one of those is recoverable.
 *
 * The VALUE is replaced, never the key — a log that silently dropped `custom_env`
 * would read as "no env was passed", which is a different and misleading fact.
 */

/** Substrings that mark a key as secret-bearing. Matched case-insensitively. */
const SECRET_KEY_PARTS = [
  'apikey',
  'api_key',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'auth',
  'private_key',
  'privatekey',
];

/**
 * Keys whose ENTIRE subtree is secret-bearing regardless of the inner key names.
 * `custom_env` is an arbitrary environment block — every value in it is suspect,
 * and the inner names (`ANTHROPIC_API_KEY`, but equally `FOO`) are not ours to
 * predict.
 */
const SECRET_SUBTREE_KEYS = ['custom_env'];

export const REDACTED = '[redacted]';

const isSecretKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return SECRET_KEY_PARTS.some((part) => k.includes(part));
};

const isSecretSubtree = (key: string): boolean =>
  SECRET_SUBTREE_KEYS.includes(key.toLowerCase());

/**
 * Replace every secret-bearing value with `REDACTED`, recursing through plain
 * objects and arrays.
 *
 * Cycles are tolerated (a repeated reference renders as `'[circular]'`) because
 * this runs on a library-owned object in a log path: a stack overflow while
 * trying to WRITE a log line would take the turn down, which is a far worse
 * outcome than an imperfect log line.
 */
export function redactSecrets(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, seen));

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretSubtree(key)) {
      // Keep the KEY SHAPE visible — which env vars were set is useful and is
      // not itself a secret; the values are.
      out[key] =
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.fromEntries(Object.keys(entry as Record<string, unknown>).map((k) => [k, REDACTED]))
          : REDACTED;
      continue;
    }
    if (isSecretKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactSecrets(entry, seen);
  }
  return out;
}
