/**
 * M39's structural claims, as falsifiable tests.
 *
 * The brief states four rules that are easy to say and easy to erode: the core
 * is the only caller of the serialization registry, it is read-only from a hard
 * boundary, it addresses pages only as `(rootId, relPath)`, and it has no
 * address at all for briefs, patches, plans or the entity catalogue. Each of
 * those is a claim about code that does NOT exist, and a claim like that rots
 * silently unless something fails a build over it.
 *
 * Style follows `single-abstraction.test.ts` deliberately: comment-stripped
 * source greps with an explicit, commented allow-list, so an intentional
 * exception has to be argued for in the diff rather than slipped in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const SRC = path.join(REPO_ROOT, 'src');
const CORE = path.join(SRC, 'server/discovery');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(entry.name)) out.push(abs);
    }
  };
  walk(dir);
  return out;
}

/** Comments are stripped: every rule below is discussed in prose that quotes it. */
function codeLines(file: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let inBlock = false;
  fs.readFileSync(file, 'utf-8')
    .split('\n')
    .forEach((text, i) => {
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

function hits(files: string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const { line, text } of codeLines(file)) {
      if (pattern.test(text)) found.push(`${path.relative(REPO_ROOT, file)}:${line}: ${text.trim()}`);
    }
  }
  return found;
}

const isProduction = (file: string) => !/\.test\.tsx?$/.test(file) && !file.includes('__fixtures__');

describe('M39 — Discovery Core', () => {
  it('the serialization registry is invoked only from the core', () => {
    const outside = sourceFiles(SRC).filter(
      (f) =>
        isProduction(f) &&
        !f.startsWith(CORE) &&
        // The engine IS the registry — it defines these, it does not consume them.
        !f.endsWith('core/plugin-host/serialization-engine.ts'),
    );
    expect(hits(outside, /\.serialize(Entity|Section)\(|\.serializer\.schema/)).toEqual([]);
  });

  it('the core never writes', () => {
    // Read-only from a HARD boundary, not by policy: an external agent finds no
    // write tool because there is no path to one, and a `readonly: true` handle
    // would turn any slip here into a runtime error rather than a data loss.
    // Tests are exempt — a fixture builds the database it then reads.
    const files = sourceFiles(CORE).filter(isProduction);
    expect(hits(files, /\b(INSERT|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i)).toEqual([]);
    expect(hits(files, /\bnew Database\(/)).toEqual([]);
    expect(hits(files, /\bfs\.(write|append|unlink|rm|mkdir)/)).toEqual([]);
  });

  it('the core has no default page root and no branch on one', () => {
    // `resolve_page({ path })` answered from the built-in root whenever the
    // caller did not name one, which is a confidently wrong answer rather than
    // an error. A page position is `(rootId, relPath)`; there is no fallback.
    const files = sourceFiles(CORE).filter(isProduction);
    expect(hits(files, /rootId\s*[=:]\s*['"]pages['"]/)).toEqual([]);
    expect(hits(files, /rootId\s*===\s*['"]pages['"]|dir\s*===\s*['"]pages['"]/)).toEqual([]);
    expect(hits(files, /\?\?\s*['"]pages['"]/)).toEqual([]);
  });

  it('the core has no address for briefs, patches, plans or the entity catalogue', () => {
    // A barrier by CONSTRUCTION, not a rule in a prompt: the core only ever
    // sees `config.roots[]`, and those directories are artifact mounts rather
    // than page roots, so no parameter of any operation can name one.
    expect(hits(sourceFiles(CORE).filter(isProduction), /briefsDir|patchesDir|plansDir|entitiesDir/)).toEqual([]);
  });

  it('every operation named in the brief exists on the core', () => {
    // Guards against a rename drifting the surface away from the contract the
    // transports and the skill documentation are written against.
    const source = fs.readFileSync(path.join(CORE, 'index.ts'), 'utf-8');
    for (const op of [
      'overview',
      'describeTypes',
      'listPages',
      'listSections',
      'getSection',
      'getPage',
      'searchPages',
      'searchEntities',
      'listEntities',
      'getEntities',
      'listTags',
      'findReferences',
      'checkConsistency',
      'resolveIdentity',
    ]) {
      expect(source).toContain(`${op}:`);
    }
  });
});
