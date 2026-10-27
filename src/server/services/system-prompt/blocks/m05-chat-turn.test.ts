/**
 * 2.1.1 — `<annotations>` and `<annotation_handling>` are the turn module's (M05)
 * contribution, no longer M48's own blocks. What this pins is the owner, and the
 * emission rules M05 states. 2.1.56 — `<task_tracking>` is no longer declared.
 */

import { describe, expect, it } from 'vitest';
import { M05_PROMPT_BLOCKS } from './m05-agent-scope.js';
import { M48_PROMPT_BLOCKS } from './m48-own.js';
import type { PromptContext } from '../types.js';

const byName = (name: string) => M05_PROMPT_BLOCKS.find((b) => b.name === name)!;
const block = byName('annotations');
const handling = byName('annotation_handling');

function ctx(over: Partial<PromptContext>): PromptContext {
  return { annotations: [], currentPagePath: null, currentPageRootId: 'pages', ...over } as PromptContext;
}

describe('the chat turn blocks — M05', () => {
  it('are declared by M05 and not among M48 own blocks', () => {
    const own = M48_PROMPT_BLOCKS.map((b) => b.name);
    for (const name of ['annotations', 'annotation_handling']) {
      expect(byName(name), name).toBeDefined();
      expect(own, name).not.toContain(name);
    }
  });

  it('[entity:szablon-task-tracking] no module declares a <task_tracking> block any more', () => {
    const all = [...M05_PROMPT_BLOCKS, ...M48_PROMPT_BLOCKS].map((b) => b.name);
    expect(all).not.toContain('task_tracking');
  });

  it('<annotation_handling> stands exactly when <annotations> does', () => {
    const none = ctx({});
    const some = ctx({ annotations: [{ page: 'a.md', text: 'x', comment: '' }] as PromptContext['annotations'] });
    expect(handling.render(none, undefined)).toBeNull();
    expect(block.render(none, undefined)).toBeNull();
    expect(handling.render(some, undefined)).toContain('<annotation_handling>');
    expect(block.render(some, undefined)).toContain('<annotations>');
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
