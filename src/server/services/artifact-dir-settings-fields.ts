import path from 'node:path';
import { artifactDirConflicts, validateRootDirs } from '../config.js';
import type { Root } from '../../shared/types.js';
import type { CrossFieldRule, FieldDeclaration, FieldRule } from '../settings/field-registry.js';

/**
 * 0.2.113 — the five artifact directories, each declared by the module whose files
 * live there (plans, briefs, patches, the entity framework, releases).
 *
 * All five are `context-rebuild` AND resume-locked: the rebuild mounts the new
 * directory and `indexAll()` rebuilds state from it alone (a relocation moves no
 * files), and every one of them is in the agent's implicit deny-set, so a thread
 * founded under the old location cannot be resumed.
 */
type ArtifactDirKey = 'plansDir' | 'briefsDir' | 'patchesDir' | 'entitiesDir' | 'releasesDir';

export const ARTIFACT_DIR_KEYS: readonly ArtifactDirKey[] = [
  'plansDir',
  'briefsDir',
  'patchesDir',
  'entitiesDir',
  'releasesDir',
];

/** Same path-safety contract as a root's `dir`: relative, and never escaping cwd. */
const safeRelativeDir =
  (field: string): FieldRule =>
  (value, ctx) => {
    if ((value as string).trim() === '') return { ok: false, error: `${field} must be a non-empty string` };
    if (path.isAbsolute(value as string)) return { ok: false, error: `${field} must be relative to cwd` };
    const rel = path.relative(ctx.cwd, path.resolve(ctx.cwd, value as string));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, error: `${field} must not escape project root` };
    }
    return { ok: true };
  };

const dirField = (key: ArtifactDirKey, owner: string, def: string): FieldDeclaration => ({
  key,
  owner,
  type: 'string',
  default: def,
  validate: safeRelativeDir(key),
  effect: 'context-rebuild',
  resumeLock: true,
  apiWritable: true,
});

export const ARTIFACT_DIR_SETTINGS_FIELDS: FieldDeclaration[] = [
  dirField('plansDir', 'plans', '.claude4spec/plans'),
  dirField('briefsDir', 'briefs', '.claude4spec/briefs'),
  dirField('patchesDir', 'patches', '.claude4spec/patches'),
  dirField('entitiesDir', 'entity-framework', '.claude4spec/entities'),
  dirField('releasesDir', 'releases', '.claude4spec/releases'),
];

const effectiveDirs = (effective: (key: string) => unknown) => ({
  entitiesDir: effective('entitiesDir') as string,
  releasesDir: effective('releasesDir') as string,
  briefsDir: effective('briefsDir') as string,
  patchesDir: effective('patchesDir') as string,
  plansDir: effective('plansDir') as string,
});

/**
 * 0.2.8 (C17): briefs/patches/plans must be three different directories — two of them
 * sharing one would double-index every file under two markers. Paths are compared
 * RESOLVED, so './x', 'x/' and 'x' are the same directory.
 */
export const ARTIFACT_DIRS_DIFFER_RULE: CrossFieldRule = {
  owner: 'settings',
  id: 'artifact-dirs-differ',
  touches: ['briefsDir', 'patchesDir', 'plansDir'],
  check: (effective, ctx) => {
    const dirs = effectiveDirs(effective);
    const pairs: Array<[ArtifactDirKey, ArtifactDirKey]> = [
      ['briefsDir', 'patchesDir'],
      ['briefsDir', 'plansDir'],
      ['patchesDir', 'plansDir'],
    ];
    for (const [a, b] of pairs) {
      if (path.resolve(ctx.cwd, dirs[a]) === path.resolve(ctx.cwd, dirs[b])) {
        const key = ctx.touched.has(b) ? b : a;
        return { ok: false, key, error: `${a} and ${b} must differ` };
      }
    }
    return { ok: true };
  },
};

/**
 * D4 (0.2.9) + 0.2.113: every write target against every other one.
 *
 *  - a page root overlapping entitiesDir / releasesDir / the plugin dir, or another
 *    root, is an error (`validateRootDirs().errors`);
 *  - two non-root write targets overlapping each other is an error at write time
 *    (`newPairConflicts`, `artifactDirConflicts`) — only boot tolerates them;
 *  - briefs/patches/plans overlapping a page root is a WARNING (rule 3a): logged,
 *    the save goes through.
 *
 * Rejections are scoped to what the request touches, so an already-colliding config
 * stays repairable field by field: an unrelated PATCH never fails on damage it did
 * not cause.
 */
export const WRITE_TARGET_OVERLAP_RULE: CrossFieldRule = {
  owner: 'settings',
  id: 'write-target-overlap',
  touches: ['roots', ...ARTIFACT_DIR_KEYS],
  check: (effective, ctx) => {
    const dirs = effectiveDirs(effective);
    // No roots in the payload → the roots the running context actually uses
    // (`--pages` override applied), not the ones on disk.
    const roots = ctx.touched.has('roots') ? (effective('roots') as Root[]) : ctx.effectiveRoots;
    const { errors, warnings, newPairConflicts } = validateRootDirs(roots, dirs);
    // briefs/patches/plans only ever produce rule-3a warnings against roots, so they
    // must not gate the root sweep: a `{ plansDir }` save would otherwise 400 with a
    // message naming `entitiesDir` and a root — fields the request never carried.
    const touchesHardTargets = ['roots', 'entitiesDir', 'releasesDir'].some((k) => ctx.touched.has(k));
    if (touchesHardTargets) {
      const hard = [...errors, ...newPairConflicts];
      if (hard.length > 0) {
        const key = ctx.touched.has('roots') ? 'roots' : ctx.touched.has('entitiesDir') ? 'entitiesDir' : 'releasesDir';
        return { ok: false, key, error: hard[0]! };
      }
    }
    for (const c of artifactDirConflicts(dirs)) {
      if (ctx.touched.has(c.a) || ctx.touched.has(c.b)) {
        return { ok: false, key: ctx.touched.has(c.a) ? c.a : c.b, error: c.message };
      }
    }
    return { ok: true, warnings };
  },
};
