/**
 * M54 — validation and normalization of what a user types for a runner host:
 * the base address (`kqxtylk6`) and the master token (`qc6t2y7m`). Pure
 * functions; the record store (`host-records.ts`) runs them before every write.
 */

export type RunnerHostErrorCode = 'VALIDATION' | 'RUNNER_HOST_DUPLICATE' | 'NOT_FOUND';

/**
 * A refused runner-host write. `message` never carries the token (only which
 * rule it broke); the routes answer VALIDATION with 400, RUNNER_HOST_DUPLICATE
 * with 409 and NOT_FOUND with 404.
 */
export class RunnerHostError extends Error {
  constructor(
    readonly code: RunnerHostErrorCode,
    message: string,
    readonly field?: 'url' | 'token' | 'label',
  ) {
    super(message);
    this.name = 'RunnerHostError';
  }
}

/** Unspecified addresses as the URL parser serializes them (`0`, `0x0`, `[0::0]` land here too). */
const UNSPECIFIED_HOSTS = new Set(['0.0.0.0', '[::]']);

function invalidUrl(reason: string): RunnerHostError {
  return new RunnerHostError('VALIDATION', `url: ${reason}`, 'url');
}

/**
 * M54 `kqxtylk6`: the base address is an origin `http(s)://host[:port]` with an
 * optional path prefix — no query, no fragment, no userinfo, and the host is not
 * an unspecified address (`0.0.0.0`, `::`). Normalized before every write and
 * before every duplicate check: scheme and host lower-case, IDN to punycode, no
 * default port, no trailing `/`. The path prefix is kept.
 */
export function normalizeHostUrl(input: string): string {
  const raw = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalidUrl('not a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidUrl('only http and https are allowed');
  }
  // `http://@host` parses with an empty username — the `@` is userinfo all the same.
  if (parsed.username || parsed.password || /^[a-z][a-z0-9+.-]*:\/*[^/?#]*@/i.test(raw)) {
    throw invalidUrl('userinfo is not allowed');
  }
  // An empty `?` / `#` leaves `search` / `hash` empty but stays in the input.
  if (parsed.search || raw.includes('?')) throw invalidUrl('a query is not allowed');
  if (parsed.hash || raw.includes('#')) throw invalidUrl('a fragment is not allowed');
  if (UNSPECIFIED_HOSTS.has(parsed.hostname)) {
    throw invalidUrl('an unspecified address (0.0.0.0, ::) is not a host');
  }
  // `URL` already lower-cases scheme and host, converts IDN to punycode and
  // drops the scheme's default port; only the trailing `/` is left to strip.
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * M54 `kqxtylk6`: a contract path is appended to the normalized base address
 * without a double `/`; the base's path prefix is kept.
 */
export function hostEndpoint(baseUrl: string, contractPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${contractPath.replace(/^\/+/, '')}`;
}

/**
 * The fixed prefix every master token issued by a runner starts with
 * (`c4s-runner` `modules/M02-master-access.md` #18qjnuzh, "Token mastera").
 */
export const MASTER_TOKEN_PREFIX = 'c4sr_';

/**
 * M54 `qc6t2y7m`: the token is trimmed of whitespace, and refused (400, this
 * module's decision) when empty, when it holds a character outside printable
 * ASCII, or when it lacks the master-token prefix. The refusal never echoes it.
 */
export function normalizeMasterToken(input: string): string {
  const token = input.trim();
  if (!token) throw new RunnerHostError('VALIDATION', 'token: must not be empty', 'token');
  if (!/^[\x20-\x7e]+$/.test(token)) {
    throw new RunnerHostError('VALIDATION', 'token: only printable ASCII characters are allowed', 'token');
  }
  if (!token.startsWith(MASTER_TOKEN_PREFIX)) {
    throw new RunnerHostError('VALIDATION', `token: a master token starts with "${MASTER_TOKEN_PREFIX}"`, 'token');
  }
  return token;
}

/** The token's last four characters — not a secret; the only part API and UI ever see. */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
