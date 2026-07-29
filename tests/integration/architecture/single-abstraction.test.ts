/**
 * The Single Abstraction Rule, as falsifiable tests.
 *
 * 0.2.2 generalized the rule: it stopped being an enumeration of type literals
 * and became structural — the host resolves a type through the registry, reads
 * `module.table` from the manifest, and gets its service by shape. The four
 * greps below are the brief's own verification gates. They lived only in the
 * brief, which meant nothing stopped them rotting; here they fail a build.
 *
 * Scope note for every gate: a hit inside `entities/` (types built in directly)
 * or inside an envelope's `plugins/<name>/src/` is BY DEFINITION fine — that is
 * the package that contributes the type. The rule is about the host core.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const SRC = path.join(REPO_ROOT, 'src');

/** Every `.ts`/`.tsx` under `src/`, excluding the type-owning directories. */
function hostSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // The two directories where a type legitimately knows its own name.
        if (entry.name === 'entities') continue;
        walk(abs);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(abs);
      }
    }
  };
  walk(SRC);
  return out;
}

/**
 * Comment lines are stripped before matching. Every gate here has prose hits —
 * the rule is discussed at length in docblocks, including by quoting the very
 * pattern being searched for — and a rule that fires on its own documentation
 * teaches people to delete the documentation.
 */
function codeLines(file: string): Array<{ line: number; text: string }> {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const out: Array<{ line: number; text: string }> = [];
  let inBlock = false;
  lines.forEach((text, i) => {
    const trimmed = text.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    out.push({ line: i + 1, text });
  });
  return out;
}

function hits(pattern: RegExp, filter: (file: string) => boolean = () => true): string[] {
  const found: string[] = [];
  for (const file of hostSourceFiles()) {
    if (!filter(file)) continue;
    for (const { line, text } of codeLines(file)) {
      if (pattern.test(text)) found.push(`${path.relative(REPO_ROOT, file)}:${line}: ${text.trim()}`);
    }
  }
  return found;
}

/** Test doubles and fixtures name types on purpose — that is what they are for. */
const isProduction = (file: string) => !/\.test\.tsx?$/.test(file) && !file.includes('__fixtures__');

describe('Single Abstraction Rule', () => {
  it('only the plugin host reads `config.entities`', () => {
    // `config.entitiesDir` is a different field (a filesystem path) and does not
    // count; the boundary is the `\b` after `entities`.
    expect(
      hits(/config\.entities\b/, (f) => isProduction(f) && !f.includes('core/plugin-host/')),
    ).toEqual([
      // The settings screen whose whole job is EDITING the activation set. It
      // reads the field as data, which is the opposite of dispatching on it.
      expect.stringContaining('EntitiesSection.tsx'),
      // A user-facing sentence that happens to name the field.
      expect.stringContaining('BrokenChip.tsx'),
      // Pass-through, not dispatch: the project config is copied verbatim into
      // the release bundle so a restore can reproduce the activation set.
      expect.stringContaining('release-bundle.ts'),
    ]);
  });

  it('the host does not branch on an entity type literal', () => {
    const ENTITY_TYPES = ['endpoint', 'dto', 'ui-view', 'ac', 'design-system', 'diagram', 'database-table'];
    const pattern = new RegExp(`type === '(${ENTITY_TYPES.join('|')})'`);
    expect(hits(pattern, isProduction)).toEqual([
      // PRE-EXISTING, and out of scope for the 0.2.2 envelope work: the
      // cross-cutting reference-tools server skips `ac` when sweeping for
      // unreferenced entities. Filed as a patch rather than widened into.
      expect.stringContaining('mcp/reference-tools.ts'),
    ]);
  });

  it('no entity service CLASS is imported outside the package that owns it', () => {
    expect(hits(/import .*Service.*from '.*(entities|plugins)\//, isProduction)).toEqual([]);
  });

  it('no type-specific API route literal lives in the host', () => {
    // `/api/ui-views` is legitimate inside `src/client/entities/ui-view/` — that
    // IS the contributing package — and `hostSourceFiles` already excludes it.
    expect(hits(/['"`]\/api\/(endpoints|dtos)\b/, isProduction)).toEqual([]);
  });

  it('the host never names the endpoint↔dto junction', () => {
    // Item 5's acceptance criterion. `db/migrations/*.sql` is exempt and not
    // scanned here: those files are an applied ledger, replayed verbatim by every
    // installed database, and editing one would change history.
    expect(hits(/endpoint_dto/, isProduction)).toEqual([]);
  });
});
