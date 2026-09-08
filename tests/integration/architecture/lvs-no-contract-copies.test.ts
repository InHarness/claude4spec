import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../../src/server/services/skill-registry.js';
import { validateWritingStyle } from '../../../src/server/core/plugin-host/manifest-adapter.js';
import { manifest } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/manifest.js';
import { DEFAULT_LIMITS } from '../../../src/server/discovery/pagination.js';
import { MAX_ANCHORS_PER_CALL } from '../../../src/server/discovery/budget.js';

/**
 * The style package documents DECISIONS; a tool description documents its
 * CONTRACT. The package once restated the contract — "the default is 20",
 * "50 is the ceiling", a nine-row table of error codes, one of which
 * (`BRIEF_ARCHIVED`) existed nowhere — and every such copy is a sentence that
 * turns false the day the constant moves, with nothing to say so.
 *
 * This test is the thing that says so. The constants are IMPORTED from `src/`
 * rather than written here, so a copy re-created in the package fails against
 * the live value, not against a second copy of it; and the error-code catalogue
 * is READ off the MCP sources, so a code the package names has to be one the
 * package is allowed to name — which is none of them. A step that depends on a
 * number points at the response field that carries it (`total`, `hasMore`,
 * `truncated`, `truncationHint`) instead.
 *
 * It lives here, beside `envelope-delivery-axes`, and not in the envelope's own
 * vitest: importing `src/server/discovery` from a plugin test would be the
 * cross-package import the envelope exists to avoid.
 */
describe('the layered-vertical-slices package restates no MCP contract', () => {
  const SLUG = 'layered-vertical-slices';
  const MCP_ROOT = path.join(import.meta.dirname, '../../../src/server/mcp');

  /** Every shipped string, by the address the agent loads it at. */
  let shipped: Array<[string, string]>;

  beforeAll(() => {
    const registry = SkillRegistry.load([]);
    for (const style of manifest.contributes.writingStyles ?? []) {
      registry.addPluginSkill(validateWritingStyle(style));
    }
    const resolved = registry.resolve(SLUG);
    shipped = [
      ['SKILL.md', resolved.content],
      ...Object.entries(resolved.files ?? {}).map(([rel, f]): [string, string] => [rel, f.content]),
    ];
    expect(shipped.length).toBeGreaterThan(1);
  });

  /**
   * Word boundary AND context: the package legitimately carries "1200
   * characters", "limit: 200" and "~250 lines", and a bare `\b20\b` would still
   * be satisfied by an unrelated count. The number only counts as a copy when
   * it sits within one sentence of a word that makes it the tool's default or
   * ceiling.
   */
  function copies(value: number, context: string): RegExp {
    return new RegExp(`\\b(?:${context})\\b[^.\\n]{0,80}\\b${value}\\b|\\b${value}\\b[^.\\n]{0,80}\\b(?:${context})\\b`, 'i');
  }

  it('never writes the search_pages default page size as a literal', () => {
    const re = copies(DEFAULT_LIMITS.searchPages, 'default|defaults|defaulted|by default');
    for (const [file, text] of shipped) {
      expect({ file, copy: re.exec(text)?.[0] ?? null }).toEqual({ file, copy: null });
    }
  });

  it('never writes the get_sections anchor ceiling as a literal', () => {
    const re = copies(MAX_ANCHORS_PER_CALL, 'ceiling|cap|capped|limit|maximum|at most|per call|per batch');
    for (const [file, text] of shipped) {
      expect({ file, copy: re.exec(text)?.[0] ?? null }).toEqual({ file, copy: null });
    }
  });

  /**
   * Every SCREAMING_SNAKE token that appears inside a string literal of an MCP
   * source file — the tool descriptions and the `code:` fields are both strings,
   * and error codes reach the agent only through them. Read, not listed: a code
   * added to the catalogue tomorrow is covered the same day.
   */
  function errorCodeCatalogue(): Set<string> {
    const codes = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          const source = fs.readFileSync(full, 'utf-8');
          for (const literal of source.matchAll(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/gs)) {
            for (const token of literal[0].matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
              codes.add(token[0]);
            }
          }
        }
      }
    };
    walk(MCP_ROOT);
    return codes;
  }

  it('names no error code of the MCP catalogue, and no code that is not in it', () => {
    const catalogue = errorCodeCatalogue();
    // Sanity on the reader itself: two codes the package used to copy.
    expect(catalogue.has('INVALID_ARGUMENT')).toBe(true);
    expect(catalogue.has('BRIEF_CONFLICT')).toBe(true);

    for (const [file, text] of shipped) {
      const named = [...text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)].map((m) => m[0]);
      const fromCatalogue = named.filter((t) => catalogue.has(t));
      expect({ file, codes: fromCatalogue }).toEqual({ file, codes: [] });
      // The invented one, by name: it was in the package and in no source file.
      expect({ file, phantom: text.includes('BRIEF_ARCHIVED') }).toEqual({ file, phantom: false });
    }
  });
});
