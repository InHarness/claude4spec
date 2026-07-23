import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the "app typography does not style rendered diagram SVG" invariant in
 * `theme.css`.
 *
 * Mermaid renders flowchart labels as real HTML inside the SVG's <foreignObject>
 * (`<div class="label"><span class="nodeLabel"><p>…</p></span></div>`), so
 * `.prose-spec p` matches that <p> DIRECTLY while the diagram's own theme reaches
 * it only by inheritance — and a direct match always wins. Without containment the
 * labels take `--c-ink` regardless of what the diagram's `themeVariables` say.
 *
 * The real cascade can only be resolved by a browser (`tests/e2e/diagram-label-color.test.ts`
 * does that against a live app). This is the hermetic half: it asserts the rule is
 * still there, still keyed on the `c4s-diagram-svg` hook, and — the subtle part —
 * still OUTSIDE `@layer components`, where unlayered `.prose-spec p` would beat it
 * under native cascade layers.
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

const CONTAINMENT = /\.c4s-diagram-svg\s+svg\s+p\s*,[\s\S]{0,120}?\{/;

describe('theme.css — app typography does not reach inside diagram SVG', () => {
  it('hands label styling back to the diagram theme inside .c4s-diagram-svg', () => {
    const body = ruleBody(THEME_CSS, CONTAINMENT);
    expect(body, 'containment rule for .c4s-diagram-svg svg content is missing').not.toBeNull();
    const flat = body!.replace(/\s+/g, ' ');
    expect(flat).toContain('color: inherit');
    // `.prose-spec p` also sets these; leaving any of them behind distorts the
    // label box mermaid measured when it laid the diagram out
    expect(flat).toContain('font-size: inherit');
    expect(flat).toContain('line-height: inherit');
    expect(flat).toContain('margin: 0');
  });

  it('covers every element mermaid emits into <foreignObject>, not just <p>', () => {
    const m = CONTAINMENT.exec(THEME_CSS);
    expect(m).not.toBeNull();
    for (const el of ['p', 'div', 'span']) {
      expect(m![0]).toMatch(new RegExp(`\\.c4s-diagram-svg\\s+svg\\s+${el}\\b`));
    }
  });

  it('declares the rule OUTSIDE @layer components, where it would lose to the prose rules', () => {
    // `.prose-spec p` is unlayered; under native cascade layers an unlayered
    // declaration beats a layered one outright, whatever the specificity. Moving
    // this rule into the neighbouring `not-prose` block silently breaks it.
    expect(CONTAINMENT.test(stripLayerBlocks(THEME_CSS))).toBe(true);
  });

  it('still has something to contain — `.prose-spec p` colors prose with --c-ink', () => {
    const body = ruleBody(THEME_CSS, /(?<![\w.-])\.prose-spec p\s*\{/);
    expect(body).not.toBeNull();
    expect(body!.replace(/\s+/g, ' ')).toContain('color: var(--c-ink)');
  });
});
