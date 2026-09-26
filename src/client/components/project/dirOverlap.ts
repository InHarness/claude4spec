/**
 * Client mirror of the server's write-target overlap rules (`src/server/config.ts`
 * — `dirsOverlap`, `rootsOverlap`, `targetsOverlap`). Kept local so the bundle
 * never pulls node-only config code; the server re-validates on every PATCH.
 */

/** A relative directory inside the project: not absolute, no `..` escape. */
export function isPathSafeRelative(dir: string): boolean {
  const v = dir.trim();
  if (v === '') return false;
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(v)) return false;
  const norm = v.replace(/\\/g, '/');
  if (norm === '..' || norm.startsWith('../') || norm.includes('/../')) return false;
  return true;
}

/** Normalize a cwd-relative dir for comparison (trailing slash and `./` stripped). */
export function normDir(dir: string): string {
  const n = dir.trim().replace(/\\+/g, '/').replace(/\/+$/, '').replace(/^\.\//, '');
  return n === '.' || n === '' ? '' : n;
}

/** True when `child` equals or is nested under `parent` (both normalized). */
function isInsideDir(parent: string, child: string): boolean {
  if (parent === child) return true;
  if (parent === '') return true;
  return child.startsWith(parent + '/');
}

function hasDotSegment(rel: string): boolean {
  return rel.split('/').some((s) => s.startsWith('.'));
}

/** Would a pages walker rooted at `container` descend into `child`? Dot-dirs are skipped. */
function walkerReaches(container: string, child: string): boolean {
  if (!isInsideDir(container, child)) return false;
  const rel = container === '' ? child : child.slice(container.length + 1);
  return !hasDotSegment(rel);
}

/** A page root against a non-root target: the root is the walker. */
export function rootOverlapsDir(rootDir: string, otherDir: string): boolean {
  const na = normDir(rootDir);
  const nb = normDir(otherDir);
  if (na === nb) return true;
  if (isInsideDir(nb, na)) return true;
  return walkerReaches(na, nb);
}

/** Two page roots — symmetric, dot-dir exemption kept both ways. */
export function rootsOverlap(aDir: string, bDir: string): boolean {
  const na = normDir(aDir);
  const nb = normDir(bDir);
  if (na === nb) return true;
  return walkerReaches(na, nb) || walkerReaches(nb, na);
}

/** Two non-root targets — neither walks, so plain equality-or-containment. */
export function targetsNest(aDir: string, bDir: string): boolean {
  const na = normDir(aDir);
  const nb = normDir(bDir);
  return na === nb || isInsideDir(na, nb) || isInsideDir(nb, na);
}

/** Directories the app writes to; a root or an artifact dir overlapping one is an error. */
export const RESERVED_WRITE_TARGETS = ['.claude4spec/plugins'];
