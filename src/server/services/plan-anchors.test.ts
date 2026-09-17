import { describe, expect, it } from 'vitest';
import { injectAnchors } from './plan.js';
import { artifactRegistry } from './artifact-registry.js';
import { ANCHOR_LINE_RE } from '../../shared/anchor-pattern.js';

/**
 * 0.2.89 — plan files are anchored, but never indexed; and an anchor is the line
 * directly above its heading, looking past blank lines the way the page indexer
 * does, so a re-run is a no-op rather than a second anchor.
 */
describe('plan anchor injection', () => {
  const anchorCount = (s: string) => s.split('\n').filter((l) => ANCHOR_LINE_RE.test(l)).length;

  it('anchors every section heading once, and a second pass changes nothing', () => {
    const once = injectAnchors(['# Plan', '', '## Step one', '', 'x', '', '### Detail', ''].join('\n'));
    expect(anchorCount(once)).toBe(2);
    expect(injectAnchors(once)).toBe(once);
  });

  it('does not add a second anchor when a blank line separates an existing one from its heading', () => {
    const src = ['<!-- anchor: q3v8n1zt -->', '', '## Step one', ''].join('\n');
    expect(injectAnchors(src)).toBe(src);
  });

  it('leaves a heading-like line inside a fenced code block alone', () => {
    const src = ['```md', '## not a section', '```', ''].join('\n');
    expect(injectAnchors(src)).toBe(src);
  });

  it('the registry says plans are anchored but not section-indexed', () => {
    expect(artifactRegistry.plan.anchorInjection).toBe(true);
    expect(artifactRegistry.plan.sectionIndexed).toBe(false);
  });
});
