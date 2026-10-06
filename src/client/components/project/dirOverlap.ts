/**
 * Client mirror of the server's root-overlap rule (`validateRootDirs` in
 * `src/server/config.ts`). 2.1.8: overlap is measured on NAMESPACES — a root's
 * files minus every dot-segment subtree — against every registry root (user and
 * system) and the plugin dir. The namespace logic itself is shared
 * (`src/shared/root-kinds.ts`); the server re-validates on every PATCH.
 */
import { SYSTEM_ROOTS, namespacesOverlap } from '../../../shared/root-kinds.js';

/** A relative directory inside the project: not absolute, no `..` escape. */
export function isPathSafeRelative(dir: string): boolean {
  const v = dir.trim();
  if (v === '') return false;
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(v)) return false;
  const norm = v.replace(/\\/g, '/');
  if (norm === '..' || norm.startsWith('../') || norm.includes('/../')) return false;
  return true;
}

/** Directories the app writes to besides the registry roots. */
export const RESERVED_WRITE_TARGETS = ['.claude4spec/plugins'];

/**
 * The fixed targets a user root may not overlap: the five system roots and the
 * plugin dir. Each with a label for the error under the field.
 */
export const FIXED_TARGETS: ReadonlyArray<{ id: string; dir: string; label: string }> = [
  ...SYSTEM_ROOTS.map((r) => ({ id: r.id, dir: r.dir, label: `the ${r.id} root (${r.dir})` })),
  ...RESERVED_WRITE_TARGETS.map((d) => ({ id: d, dir: d, label: 'the plugin directory' })),
];

/** Do two root namespaces overlap? Symmetric; dot-subtrees excluded both ways. */
export const rootsOverlap = namespacesOverlap;
