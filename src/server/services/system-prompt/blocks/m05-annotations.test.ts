/**
 * 2.1.1 — `<annotations>` is the chat module's (M05) contribution, no longer
 * one of M48's own blocks. The emitted text is unchanged; what this pins is the
 * owner, and the emission rules M05 now states for the block.
 */

import { describe, expect, it } from 'vitest';
import { M05_ANNOTATION_BLOCKS } from './m05-annotations.js';
import { M48_PROMPT_BLOCKS } from './m48-own.js';
import type { PromptContext } from '../types.js';

const block = M05_ANNOTATION_BLOCKS.find((b) => b.name === 'annotations')!;

function ctx(over: Partial<PromptContext>): PromptContext {
  return { annotations: [], currentPagePath: null, currentPageRootId: 'pages', ...over } as PromptContext;
}

describe('<annotations> — an M05 block', () => {
  it('is declared by M05 and not among M48 own blocks', () => {
    expect(block).toBeDefined();
    expect(M48_PROMPT_BLOCKS.map((b) => b.name)).not.toContain('annotations');
  });

  it('[ac:ac-system-prompt-agenta-zawiera-sformato] is emitted only when the turn carries annotations', () => {
    expect(block.render(ctx({}), undefined)).toBeNull();
    const out = block.render(
      ctx({ annotations: [{ page: 'a.md', text: 'x', comment: 'c' }] as PromptContext['annotations'] }),
      undefined,
    );
    expect(out).toContain('<annotations>');
  });

  it('gives `root` only to an annotation on the current page, and omits empty attributes', () => {
    const out = block.render(
      ctx({
        currentPagePath: 'here.md',
        currentPageRootId: 'adr',
        annotations: [
          { page: 'here.md', text: 'one', comment: 'tighten' },
          { page: 'there.md', text: 'two', comment: '' },
        ] as PromptContext['annotations'],
      }),
      undefined,
    )!;
    expect(out).toContain('<annotation page="here.md" root="adr" comment="tighten">');
    expect(out).toContain('<annotation page="there.md">');
    expect(out).not.toContain('comment=""');
  });
});
