/**
 * 2.1.1 — `<annotations>`, `<annotation_handling>` and `<task_tracking>` are the
 * chat module's (M05) contribution, no longer M48's own blocks. The emitted text
 * is unchanged; what this pins is the owner, and the emission rules M05 states.
 */

import { describe, expect, it } from 'vitest';
import { M05_PROMPT_BLOCKS } from './m05-agent-scope.js';
import { M48_PROMPT_BLOCKS } from './m48-own.js';
import type { PromptContext } from '../types.js';

const byName = (name: string) => M05_PROMPT_BLOCKS.find((b) => b.name === name)!;
const block = byName('annotations');
const handling = byName('annotation_handling');
const tracking = byName('task_tracking');

function ctx(over: Partial<PromptContext>): PromptContext {
  return { annotations: [], currentPagePath: null, currentPageRootId: 'pages', ...over } as PromptContext;
}

describe('the chat turn blocks — M05', () => {
  it('are declared by M05 and not among M48 own blocks', () => {
    const own = M48_PROMPT_BLOCKS.map((b) => b.name);
    for (const name of ['annotations', 'annotation_handling', 'task_tracking']) {
      expect(byName(name), name).toBeDefined();
      expect(own, name).not.toContain(name);
    }
  });

  it('<annotation_handling> stands exactly when <annotations> does', () => {
    const none = ctx({});
    const some = ctx({ annotations: [{ page: 'a.md', text: 'x', comment: '' }] as PromptContext['annotations'] });
    expect(handling.render(none, undefined)).toBeNull();
    expect(block.render(none, undefined)).toBeNull();
    expect(handling.render(some, undefined)).toContain('<annotation_handling>');
    expect(block.render(some, undefined)).toContain('<annotations>');
  });

  it('<task_tracking> is omitted only from the ask frame', () => {
    expect(tracking.render(ctx({ contextType: 'ask' } as Partial<PromptContext>), undefined)).toBeNull();
    expect(tracking.render(ctx({ contextType: 'chat' } as Partial<PromptContext>), undefined)).toContain('<task_tracking>');
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
