/**
 * One case per bug a review found in the first cut of this envelope.
 *
 * Grouped in one file on purpose: they share no subject beyond having been
 * missed, and what they have in common is worth stating — each is a guardrail
 * that existed in v1 or in the host and was dropped in translation, and each
 * failed in a way that looked like nothing was wrong.
 */

import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown } from '../src/entity/spreadsheet/frontend/inline-markdown.js';
import { denseCellsToSparse } from '../src/entity/spreadsheet/upgrades.js';
import { spreadsheetData } from '../src/entity/spreadsheet/schema.js';
import { SPREADSHEET_ATTR_ORDER, MAX_WINDOW_CELLS } from '../src/identity.js';
import { buildCreateShape } from '../../../src/server/core/plugin-host/crud-schema-gen.js';
import { z } from 'zod';

/** The href of the first `<a>` in a rendered node list, or null when none was emitted. */
function hrefOf(nodes: unknown[]): string | null {
  for (const node of nodes) {
    const el = node as { type?: unknown; props?: { href?: string } } | null;
    if (el && typeof el === 'object' && el.type === 'a') return el.props?.href ?? null;
  }
  return null;
}

describe('inline markdown — href sanitising', () => {
  it('allows the safe schemes', () => {
    expect(hrefOf(renderInlineMarkdown('[x](https://example.com)'))).toBe('https://example.com');
    expect(hrefOf(renderInlineMarkdown('[x](mailto:a@b.c)'))).toBe('mailto:a@b.c');
  });

  it('drops a javascript: link, keeping its visible text', () => {
    const nodes = renderInlineMarkdown('[click](javascript:alert(1))');
    expect(hrefOf(nodes)).toBeNull();
  });

  it('drops javascript: hidden behind a LEADING CONTROL CHARACTER', () => {
    /**
     * The bypass. `trim()` removes whitespace and nothing else, so a leading
     * `` left the value looking schemeless to the allowlist — while the
     * browser strips exactly that byte when parsing an href and executes the
     * URL. Cell values arrive from agents via `set_cell`, so this is reachable.
     */
    for (const prefix of ['\u0001', '\u0000', '\u001f', '\u007f', '\u0020']) {
      const nodes = renderInlineMarkdown(`[click](${prefix}javascript:alert(1))`);
      expect(hrefOf(nodes), `prefix ${JSON.stringify(prefix)}`).toBeNull();
    }
  });

  it('emits the STRIPPED value, never the original', () => {
    // Returning the original would hand the browser back the exact string that
    // got past the check.
    expect(hrefOf(renderInlineMarkdown('[x](https://example.com)'))).toBe('https://example.com');
  });

  it('still allows a schemeless value', () => {
    expect(hrefOf(renderInlineMarkdown('[x](/pages/index.md)'))).toBe('/pages/index.md');
    expect(hrefOf(renderInlineMarkdown('[x](#anchor)'))).toBe('#anchor');
  });
});

describe('markdown serialization of the embed', () => {
  /**
   * 0.2.15 — these four cases pinned `serializeSpreadsheetTag`, a mirror of the
   * host's `serializeXmlTag` that this envelope had to carry because it owned a
   * `<spreadsheet slug caption/>` tag of its own.
   *
   * The tag is gone and so is the mirror. A sheet is embedded as
   * `<single_element type="spreadsheet" …/>`, serialized by the HOST, which
   * means the drift these cases guarded against — two copies of one attribute
   * order, one of them rewriting a page's tags on every save — is now
   * structurally impossible rather than tested for. The host's own coverage of
   * the self-closing form, empty-caption omission and quote escaping lives in
   * `src/shared/xml-tags.test.ts`.
   */
  it('no longer exists — the host serializes the embed', () => {
    // `SPREADSHEET_ATTR_ORDER` survives only as the MCP-facing declaration of
    // which attributes a sheet reference carries; nothing serializes from it.
    expect([...SPREADSHEET_ATTR_ORDER]).toEqual(['slug', 'caption']);
  });
});

describe('dense → sparse upgrade — the idempotence guard', () => {
  const up = (p: unknown) => denseCellsToSparse(p) as Record<string, unknown>;

  it('migrates a dense payload whose FIRST row is not an array', () => {
    /**
     * Judging by `cells[0]` alone read this as already-sparse and returned it
     * unmigrated — after which the host stamped it v2 and the miss became
     * permanent: the upgrade never runs again, so no rebuild recovers content
     * that is still sitting in the file.
     */
    const out = up({ nRows: 3, nCols: 2, cells: [null, ['Plik', 'Opisuje'], ['a', 'b']] });
    expect(out.cells).toEqual([
      { r: 2, c: 1, value: 'Plik' },
      { r: 2, c: 2, value: 'Opisuje' },
      { r: 3, c: 1, value: 'a' },
      { r: 3, c: 2, value: 'b' },
    ]);
  });

  it('still treats a fully sparse payload as already migrated', () => {
    const sparse = { nRows: 1, nCols: 1, cells: [{ r: 1, c: 1, value: 'a' }] };
    expect(up(sparse)).toEqual(sparse);
  });

  it('reads a MIXED array as dense, because dense is the recoverable reading', () => {
    // `dense()` skips a malformed row; treating it as sparse would swallow a
    // real one and lose it for good.
    const out = up({ cells: [['a'], { r: 9, c: 9, value: 'x' }] });
    expect(out.cells).toEqual([{ r: 1, c: 1, value: 'a' }]);
  });
});

describe('generated create shape — numeric bounds', () => {
  const shape = z.object(buildCreateShape(spreadsheetData, [{ op: 'slugify', field: 'name' }]) as never);
  const base = { name: 'Q1', nCols: 3 };

  it('accepts a sane grid', () => {
    expect(shape.safeParse({ ...base, nRows: 4 }).success).toBe(true);
  });

  it('refuses a NEGATIVE extent', () => {
    /**
     * v1 declared `z.number().int().nonnegative()`; the first translation of the
     * schema dropped it. An extent of -1 is not merely odd — it makes the sheet
     * unusable by construction: every cell write is refused (no coordinate
     * satisfies `at <= extent`) and every axis insert is refused (the highest
     * legal position is `extent + 1 = 0`, below the 1-based floor). The row is
     * created, accepts no content, and can only be deleted.
     */
    expect(shape.safeParse({ ...base, nRows: -1 }).success).toBe(false);
  });

  it('refuses a FRACTIONAL extent', () => {
    expect(shape.safeParse({ ...base, nRows: 2.5 }).success).toBe(false);
  });

  it('applies the same rule to both axes', () => {
    expect(shape.safeParse({ name: 'Q1', nRows: 2, nCols: -3 }).success).toBe(false);
    expect(shape.safeParse({ name: 'Q1', nRows: 2, nCols: 1.5 }).success).toBe(false);
  });

  it('allows zero — an empty grid is a legitimate sheet', () => {
    expect(shape.safeParse({ name: 'Q1', nRows: 0, nCols: 0 }).success).toBe(true);
  });
});

describe('the window cap the envelope carries', () => {
  it('matches the discovery core’s, so the two read doors agree', () => {
    // The MCP tool reads through `ctx.reader` and the embed reads over HTTP.
    // A caller should not discover that one of them is stricter by hitting it.
    expect(MAX_WINDOW_CELLS).toBe(10_000);
  });
});
