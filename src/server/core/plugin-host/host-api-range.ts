/**
 * M33: minimal semver-range satisfaction for the Host API compatibility gate.
 *
 * The host advertises ONE clean version (`HOST_API_VERSION`, e.g. "1.4.0"); a
 * plugin declares the range it targets (`manifest.hostApiVersion`). We only need
 * to answer "does the host version satisfy the plugin's range?", and the range
 * forms plugin authors realistically write are narrow:
 *
 *   *  / "" / "x"      → any
 *   1.4.0              → exact
 *   ^1.4.0             → >=1.4.0 <2.0.0  (caret)
 *   ~1.4.0             → >=1.4.0 <1.5.0  (tilde)
 *   1.x / 1 / 1.4      → x-range
 *   >=1.4.0            → single comparator
 *   "a || b"           → OR of the above
 *
 * Implemented here (rather than depending on the `semver` package) to keep the
 * loader self-contained — the package is not part of the dependency set.
 */

type Triple = [number, number, number];

function parseVersion(v: string): Triple | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: Triple, b: Triple): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

/** Satisfaction of a single (non-OR) range clause. */
function satisfiesClause(host: Triple, clause: string): boolean {
  const range = clause.trim();
  if (range === '' || range === '*' || range === 'x' || range === 'X') return true;

  // Comparator form: >=, >, <=, <, = (single comparator only).
  const compMatch = /^(>=|<=|>|<|=)\s*v?(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (compMatch) {
    const op = compMatch[1];
    const target: Triple = [Number(compMatch[2]), Number(compMatch[3]), Number(compMatch[4])];
    const c = cmp(host, target);
    switch (op) {
      case '>=':
        return c >= 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      case '<':
        return c < 0;
      default:
        return c === 0; // '='
    }
  }

  // Caret: ^1.4.0 → >=1.4.0 <2.0.0  (for major 0, semver narrows, but plugins
  // targeting a 1.x+ host don't hit that; keep the common-major behavior).
  if (range.startsWith('^')) {
    const t = parseVersion(range.slice(1));
    if (!t) return false;
    const upper: Triple = t[0] > 0 ? [t[0] + 1, 0, 0] : t[1] > 0 ? [0, t[1] + 1, 0] : [0, 0, t[2] + 1];
    return cmp(host, t) >= 0 && cmp(host, upper) < 0;
  }

  // Tilde: ~1.4.0 → >=1.4.0 <1.5.0
  if (range.startsWith('~')) {
    const t = parseVersion(range.slice(1));
    if (!t) return false;
    const upper: Triple = [t[0], t[1] + 1, 0];
    return cmp(host, t) >= 0 && cmp(host, upper) < 0;
  }

  // X-range / partial: "1", "1.4", "1.x", "1.4.x"
  const parts = range.split('.');
  const isX = (p: string | undefined) => p == null || p === 'x' || p === 'X' || p === '*';
  if (isX(parts[0])) return true;
  const major = Number(parts[0]);
  if (!Number.isFinite(major)) return false;
  if (host[0] !== major) return false;
  if (isX(parts[1])) return true;
  const minor = Number(parts[1]);
  if (!Number.isFinite(minor)) return false;
  if (host[1] !== minor) return false;
  if (isX(parts[2])) return true;
  const patch = Number(parts[2]);
  if (!Number.isFinite(patch)) return false;
  return host[2] === patch;
}

/**
 * Does `hostVersion` (a clean version) satisfy the plugin's `range`?
 * Conservative: an unparseable host version or fully-unparseable range → false.
 */
export function satisfiesHostApi(hostVersion: string, range: string): boolean {
  const host = parseVersion(hostVersion);
  if (!host) return false;
  if (range == null) return false;
  if (range.trim() === '') return true;
  return range
    .split('||')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .some((clause) => satisfiesClause(host, clause));
}
