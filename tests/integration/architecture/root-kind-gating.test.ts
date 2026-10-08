/**
 * 2.1.8 — L13 contract, as falsifiable tests: every per-file behaviour is gated
 * by a FLAG of the root's kind or by the KIND itself, never by a directory or an
 * identifier (M02 `m02l13001` No-hardcode assert, L13 `l13role01`).
 *
 * Two halves:
 *  - behaviour: a project whose base root is `id: docs, dir: manual` gets exactly
 *    the gating a project with `id: pages, dir: pages` gets — the registry
 *    answers by `builtin`, by kind and by kind flags, and the system roots by kind;
 *  - source: no production module compares a root id or a dir against a root
 *    literal, and none reads a root directory from a legacy config key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RootRegistry } from '../../../src/server/roots/registry.js';
import {
  KIND_DECLARATIONS,
  SYSTEM_ROOT_KINDS,
  fileMapEntryOf,
  systemRootKindOf,
} from '../../../src/shared/root-kinds.js';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const SRC = path.join(REPO_ROOT, 'src');

function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(abs);
    }
  };
  walk(SRC);
  return out;
}

/** Code lines only — block-comment and line-comment lines describe the forbidden pattern, they do not use it. */
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

const ROOT_LITERALS = ['pages', ...SYSTEM_ROOT_KINDS].join('|');
/** `rootId === 'plans'`, `root.id !== 'pages'`, `dir === 'pages'`, `r.dir === ".claude4spec/briefs"`, … */
const ID_OR_DIR_GATE = new RegExp(
  String.raw`\b(?:rootId|id|dir)\s*[!=]==\s*['"\x60](?:(?:\.claude4spec/)?(?:${ROOT_LITERALS}))['"\x60]`,
);
/** `config.plansDir`, `cfg.entitiesDir`, … — a root dir read from a config key. */
const LEGACY_DIR_KEY = /\.\s*(?:plansDir|briefsDir|patchesDir|entitiesDir|releasesDir)\b/;

describe('2.1.8 — L13: per-file behaviour is gated by kind or kind flag', () => {
  it('[ac:ac-kazde-zachowanie-per-katalog-jest-bramko] gating follows the kind and its flags — never a directory or an identifier', () => {
    // Behaviour: rename the base root's id and dir — every gate answers the same.
    const conventional = new RootRegistry([
      { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
      { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
    ]);
    const renamed = new RootRegistry([
      { id: 'docs', name: 'Docs', dir: 'manual', builtin: true },
      { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
    ]);
    const shape = (reg: RootRegistry) => ({
      base: reg.builtin().builtin,
      baseIndex: reg.list().indexOf(reg.builtin()),
      pages: reg.pages().length,
      release: reg.withFlag('release').map((r) => r.kind),
      references: reg.withFlag('references').map((r) => r.kind),
      gitignore: reg.withFlag('gitignore').map((r) => r.id),
      agentDirectFs: reg.withFlag('agentDirectFs', false).map((r) => r.id),
      sectionIndexer: reg.selecting('m06-section-indexer').map((r) => r.kind),
      capture: reg.selecting('m17-capture').map((r) => r.kind),
    });
    expect(shape(renamed)).toEqual(shape(conventional));
    expect(renamed.builtin().id).toBe('docs');
    expect(renamed.selecting('m06-section-indexer').map((r) => r.id)).toEqual(['docs', 'adr']);
    // Every flag value the registry reports is the kind declaration's, for every root.
    for (const root of renamed.list()) {
      for (const flag of ['release', 'references', 'gitignore', 'agentDirectFs'] as const) {
        expect(renamed.withFlag(flag).includes(root)).toBe(KIND_DECLARATIONS[root.kind].flags[flag]);
      }
    }
    // A system root is found by its kind, and an id is mapped back to a kind, not compared.
    for (const kind of SYSTEM_ROOT_KINDS) {
      expect(renamed.system(kind).kind).toBe(kind);
      expect(systemRootKindOf(renamed.system(kind).id)).toBe(kind);
    }
    expect(systemRootKindOf('docs')).toBeUndefined();
    // The file type is the kind's file map — the same for any root of the kind, whatever its dir.
    expect(fileMapEntryOf('pages', 'a/b.md')?.format).toBe('markdown');
    expect(fileMapEntryOf('pages', 'a/b.html')).toMatchObject({ format: 'raw', track: 'none' });
    expect(fileMapEntryOf('pages', 'a/b.json')).toBeUndefined();

    // Source: no production branch on a root id / dir literal, no dir from a config key.
    const offenders: string[] = [];
    for (const file of productionSources()) {
      for (const { line, text } of codeLines(file)) {
        if (ID_OR_DIR_GATE.test(text) || LEGACY_DIR_KEY.test(text)) {
          offenders.push(`${path.relative(REPO_ROOT, file)}:${line}: ${text.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
