/**
 * 2.1.8 — L13 / M02 m02l13001: the root-registry implementor is the only party
 * that mounts a registry root's source, and it does so before any reaction is
 * bound and before the boot `indexAll()` passes run.
 *
 * The behaviour is pinned by `src/server/workspace/root-registry-runtime.test.ts`
 * (the hook mounts every root, binds the kind's reactions, delivers only the
 * file-map entries). These are the SOURCE halves of those criteria, kept here in
 * one copy: the M29 projection modules never mount or watch on their own, and
 * the context build has no hand-made mount of a registry root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const SERVER = path.join(REPO_ROOT, 'src', 'server');

/** Code lines only — comment lines describe the patterns, they do not use them. */
function codeLines(file: string): Array<{ line: number; text: string }> {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => {
      const t = text.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    });
}

const PROJECTION_MODULES = ['entity-store.ts', 'entity-indexer.ts', 'release-store.ts', 'release-indexer.ts'];
const PROJECT_CONTEXT = path.join(SERVER, 'workspace', 'project-context.ts');

describe('2.1.8 — L13: registry roots are mounted by the implementor hook only', () => {
  it('[ac:ac-zrodla-zdarzen-korzeni-entities-i-rel] the M29 projection modules (entity/release store and indexers) never mount or watch a source themselves', () => {
    for (const file of PROJECTION_MODULES) {
      const hits = codeLines(path.join(SERVER, 'services', file)).filter(({ text }) =>
        /\bmountSource\s*\(|\bchokidar\b|\bfs\.watch\s*\(/.test(text),
      );
      expect(hits, file).toEqual([]);
    }
  });

  it('the context build mounts by hand only the plugin sources — every registry root goes through mountRegistryRoots', () => {
    const mounts = codeLines(PROJECT_CONTEXT).filter(({ text }) => /\bmountSource\s*\(/.test(text));
    for (const m of mounts) expect(m.text, `project-context.ts:${m.line}`).toMatch(/source:\s*PLUGINS_[A-Z_]+_SOURCE\b/);
    expect(codeLines(PROJECT_CONTEXT).some(({ text }) => /\bawait mountRegistryRoots\s*\(/.test(text))).toBe(true);
  });

  it('build order: mountRegistryRoots, then bindRegistryReactions, and no boot indexAll() before the binding', () => {
    const lines = codeLines(PROJECT_CONTEXT);
    const first = (re: RegExp) => lines.find(({ text }) => re.test(text))?.line ?? -1;
    const mount = first(/\bmountRegistryRoots\s*\(/);
    const bind = first(/\bbindRegistryReactions\s*\(/);
    const indexAll = first(/\.indexAll\s*\(/);
    expect(mount).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(mount);
    expect(indexAll).toBeGreaterThan(bind);
  });
});
