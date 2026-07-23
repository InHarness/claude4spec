import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the mermaid-label containment rule in `theme.css`.
 *
 * Mermaid renders flowchart labels as real HTML inside the SVG's <foreignObject>
 * (`<div class="label"><span class="nodeLabel"><p>…</p></span></div>`), so
 * `.prose-spec p` matches that <p> DIRECTLY while the diagram's own theme reaches
 * it only by inheritance — and a direct match always wins. Without containment the
 * labels take `--c-ink`: invisible in light mode (it is coincidentally dark),
 * near-white and unreadable on the diagram's light background in dark mode.
 *
 * The real cascade can only be resolved by a browser (`tests/e2e/diagram-label-color.test.ts`
 * does that against a live app). This is the hermetic half: it asserts the rule is
 * still there, still keyed on the `c4s-diagram-svg` hook, and — the subtle part —
 * still OUTSIDE `@layer components`, where it would lose to the unlayered prose rules.
 */
const THEME_CSS = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

/** Drops every balanced `@layer … { … }` block, leaving only unlayered CSS. */
function stripLayerBlocks(source: string): string {
  // comments first — several of them mention `@layer` in prose, including the one
  // above the containment rule, and a bare scan would treat that as a block opener
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@layer', i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    const open = css.indexOf('{', at);
    const semi = css.indexOf(';', at);
    if (open === -1) {
      out += css.slice(i);
      break;
    }
    // statement form (`@layer base, components;`) declares order without a body —
    // without this, the scan would take the NEXT rule's `{` as the block opener and
    // silently delete that rule, quietly changing what the assertions below see
    if (semi !== -1 && semi < open) {
      out += css.slice(i, at);
      i = semi + 1;
      continue;
    }
    out += css.slice(i, at);
    let depth = 1;
    let j = open + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    i = j;
  }
  return out;
}

/** The rule body for the first selector list matching `pattern`, or null. */
function ruleBody(css: string, pattern: RegExp): string | null {
  const m = pattern.exec(css);
  if (!m) return null;
  const open = css.indexOf('{', m.index);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

const CONTAINMENT = /\.prose-spec\s+\.c4s-diagram-svg\s+p\s*,\s*\.prose-spec\s+\.c4s-diagram-svg\s+span\s*\{/;

describe('theme.css — mermaid label containment', () => {
  it('hands label color back to the diagram theme inside .c4s-diagram-svg', () => {
    const body = ruleBody(THEME_CSS, CONTAINMENT);
    expect(body, 'containment rule for .c4s-diagram-svg p/span is missing').not.toBeNull();
    expect(body!.replace(/\s+/g, ' ')).toContain('color: inherit');
  });

  it('keys the rule on both .prose-spec and .c4s-diagram-svg so it outranks `.prose-spec p`', () => {
    const m = CONTAINMENT.exec(THEME_CSS);
    expect(m).not.toBeNull();
    // two classes (0,2,1) beat the one-class `.prose-spec p` (0,1,1)
    expect(m![0]).toContain('.prose-spec');
    expect(m![0]).toContain('.c4s-diagram-svg');
  });

  it('declares the rule OUTSIDE @layer components, where it would lose to the prose rules', () => {
    // `.prose-spec p` is unlayered; tailwind v3 hoists `@layer components` content to
    // the `@tailwind components` position, so a layered copy of this rule would not
    // reliably win. Moving it into the neighbouring `not-prose` block silently breaks it.
    expect(CONTAINMENT.test(stripLayerBlocks(THEME_CSS))).toBe(true);
  });

  it('still has something to contain — `.prose-spec p` colors prose with --c-ink', () => {
    const body = ruleBody(THEME_CSS, /(?<![\w.-])\.prose-spec p\s*\{/);
    expect(body).not.toBeNull();
    expect(body!.replace(/\s+/g, ' ')).toContain('color: var(--c-ink)');
  });
});
