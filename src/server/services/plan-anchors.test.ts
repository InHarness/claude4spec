import { describe, expect, it } from 'vitest';
import { injectArtifactAnchors as injectAnchors, injectAnchorsFor, injectsAnchors } from './anchor-injection.js';
import { kindSelects } from '../../shared/root-kinds.js';
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

  it('the plans kind says plans are anchored but not section-indexed', () => {
    // 2.1.8: decided by the root kind's reactions, not by a registry flag.
    expect(injectsAnchors('plan')).toBe(true);
    expect(injectsAnchors('brief')).toBe(false);
    expect(injectsAnchors('patch')).toBe(false);
    expect(kindSelects('plans', 'm06-anchor-injection')).toBe(true);
    expect(kindSelects('plans', 'm06-section-indexer')).toBe(false);
  });
});

describe('anchor injection — 2.0.0, on the shared section parser (M06)', () => {
  it('leaves a heading inside a multi-line HTML comment alone, and never splits the comment', () => {
    const src = ['# Plan', '', '<!--', '## Commented out', '-->', '', '## Real', ''].join('\n');
    const out = injectAnchors(src);
    const lines = out.split('\n');
    expect(lines.slice(2, 5)).toEqual(['<!--', '## Commented out', '-->']);
    expect(lines[lines.indexOf('## Real') - 1]).toMatch(/^<!-- anchor: [a-z0-9]{8} -->$/);
  });

  it('leaves a heading inside a ~~~ fence alone', () => {
    const src = ['~~~md', '## Example', '~~~', ''].join('\n');
    expect(injectAnchors(src)).toBe(src);
  });

  it('is declared by the registry: plans get anchors, briefs and patches never do', () => {
    const src = '## Step\n';
    expect(injectAnchorsFor('plan', src)).not.toBe(src);
    expect(injectAnchorsFor('brief', src)).toBe(src);
    expect(injectAnchorsFor('patch', src)).toBe(src);
  });
});
