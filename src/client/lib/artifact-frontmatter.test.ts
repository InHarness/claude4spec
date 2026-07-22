import { describe, it, expect } from 'vitest';
import { withFrontmatterOf } from './artifact-frontmatter.js';

/**
 * The regression this guards is subtle and was live on `main`: both artifact
 * editors used `gray-matter.stringify` client-side, which throws
 * `Buffer is not defined` in the browser and killed every save from inside the
 * handler. These cases pin the browser-safe replacement.
 */
describe('withFrontmatterOf', () => {
  const file = ['---', 'type: plan', 'title: Smoke plan', '---', '# Body', '', 'text'].join('\n');

  it('carries the original frontmatter block onto a new body', () => {
    expect(withFrontmatterOf(file, '# Edited\n')).toBe(
      ['---', 'type: plan', 'title: Smoke plan', '---', '# Edited', ''].join('\n'),
    );
  });

  it('copies the frontmatter bytes verbatim rather than re-serializing them', () => {
    // Quoting style, key order and date formatting must survive a body-only
    // edit — re-serializing through a YAML writer would silently rewrite them.
    const fussy = ["---", "b: 'single'", 'a: 2026-07-22T10:00:00.000Z', '---', 'body'].join('\n');
    expect(withFrontmatterOf(fussy, 'new')).toContain("b: 'single'\na: 2026-07-22T10:00:00.000Z");
  });

  it('stops at the FIRST closing delimiter, so a body containing --- is safe', () => {
    const withRule = withFrontmatterOf(file, 'intro\n\n---\n\noutro');
    expect(withRule).toBe(
      ['---', 'type: plan', 'title: Smoke plan', '---', 'intro', '', '---', '', 'outro'].join('\n'),
    );
  });

  it('treats a file with no frontmatter as body-only', () => {
    expect(withFrontmatterOf('# Just a body\n', 'replaced')).toBe('replaced');
  });

  it('tolerates CRLF line endings', () => {
    expect(withFrontmatterOf('---\r\ntype: plan\r\n---\r\nold', 'new')).toBe(
      '---\r\ntype: plan\r\n---\r\nnew',
    );
  });
});
