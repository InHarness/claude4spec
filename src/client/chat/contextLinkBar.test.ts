/**
 * 2.1.88 (M53 `64xb1u7b`) — the artifact link of the bar above the composer is
 * decided by the thread value's ROW of the project registry (`Wątek` column),
 * and its label by the artifact kind of that column. The rows here are the
 * ones the server derives from the real registry (`GET /api/config`).
 */
import { describe, expect, it } from 'vitest';
import { contextLinkLabel, contextLinkOf } from './contextLinkBar.js';
import { contextTypeShellRowsFor } from '../../server/services/chat-context.js';
import type { ContextTypeShellRow } from '../../shared/context-type-shell.js';

const ROWS = contextTypeShellRowsFor({ has: () => true });

describe('composer artifact link bar by registry row (2.1.88)', () => {
  it('[ac:ac-belka-context-link-nad-composerem-pok] the link is the artifact the row\'s `Wątek` column names, labelled by its kind', () => {
    // The registry rows as the server hands them.
    expect(ROWS.find((r) => r.value === 'chat')?.thread).toEqual({ column: 'plan_path', artifactKind: 'plan' });
    expect(ROWS.find((r) => r.value === 'brief')?.thread).toEqual({ column: 'brief_path', artifactKind: 'brief' });
    expect(ROWS.find((r) => r.value === 'patch')?.thread).toEqual({ column: 'patch_path', artifactKind: 'patch' });

    expect(contextLinkOf({ contextType: 'chat', planPath: 'p.md' }, ROWS)).toEqual({ kind: 'plan', column: 'plan_path', path: 'p.md' });
    expect(contextLinkOf({ contextType: 'brief', briefPath: 'b.md' }, ROWS)).toEqual({ kind: 'brief', column: 'brief_path', path: 'b.md' });
    expect(contextLinkOf({ contextType: 'patch', patchPath: 'x.md' }, ROWS)).toEqual({ kind: 'patch', column: 'patch_path', path: 'x.md' });
    // The row's column, not whatever else the thread carries.
    expect(contextLinkOf({ contextType: 'brief', briefPath: 'b.md', planPath: 'p.md' }, ROWS)?.column).toBe('brief_path');
    // A value this file names nowhere: its row alone decides, the label from the kind.
    const review: ContextTypeShellRow = { value: 'review', thread: { column: 'patch_path', artifactKind: 'patch' }, shell: 'overlay' };
    const link = contextLinkOf({ contextType: 'review', patchPath: 'd.md' }, [...ROWS, review]);
    expect(link).toEqual({ kind: 'patch', column: 'patch_path', path: 'd.md' });
    expect(contextLinkLabel(link!, 'Drift fix')).toBe('Patch: Drift fix');
    expect(contextLinkLabel(link!, null)).toBe('Patch: d');
    expect(contextLinkLabel({ kind: 'plan', column: 'plan_path', path: 'p.md' }, 'Cleanup', true)).toBe('Plan not found (moved or deleted)');
  });

  it('[ac:ac-belka-context-link-nie-renderuje-sie] no link in a thread whose value has `Wątek: —` (ask), even with a plan on the thread; none for a value with no row, nor for a thread without the artifact', () => {
    expect(ROWS.find((r) => r.value === 'ask')?.thread).toBeNull();
    expect(contextLinkOf({ contextType: 'ask', planPath: 'p.md' }, ROWS)).toBeNull();
    expect(contextLinkOf({ contextType: 'unknown', planPath: 'p.md', briefPath: 'b.md' }, ROWS)).toBeNull();
    expect(contextLinkOf({ contextType: 'chat', planPath: null }, ROWS)).toBeNull();
    // Registry not read yet: the shell does not know the value.
    expect(contextLinkOf({ contextType: 'chat', planPath: 'p.md' }, undefined)).toBeNull();
  });
});
