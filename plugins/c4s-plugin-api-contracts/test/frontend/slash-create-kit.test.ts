/**
 * The slash-create kit must notice a failed embed. A Tiptap chain reports a
 * refused insert by returning `false`; a throw leaves the same orphan entity.
 * Both are `false` here, and the report names the entity so the user can embed
 * it by hand. (The kit is vendored per plugin; this copy stands for all six.)
 */
import { describe, expect, it, vi } from 'vitest';

// 2.1.20 (M50 `tbeatf5z`): the kit toasts through the `toast` facade of
// `@c4s/plugin-runtime` (browser leg); the host behind it puts the toast on its
// own bus. The runner's alias resolves the bare specifier to the backend leg, so
// the browser facade is stood in for here — at the package boundary, without a
// path into the host repo (the envelope must move to its own repo unchanged).
const toastCalls = vi.hoisted(() => [] as Array<{ variant: string; message: string; arg: unknown }>);
vi.mock('@c4s/plugin-runtime', () => {
  const record = (variant: string) => (message: string, arg?: unknown) => {
    toastCalls.push({ variant, message, arg });
  };
  return { toast: { success: record('success'), error: record('error'), warning: record('warning') } };
});
import {
  NOT_EMBEDDED_TOAST_MS,
  insertEmbed,
  notEmbeddedMessage,
  reportNotEmbedded,
  runInsert,
  type EmbedEditor,
} from '../../src/frontend-kit/slash-create.js';

function editor(run: () => boolean): EmbedEditor & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    inserted,
    chain: () => ({
      focus: () => ({
        insertContent: (content: unknown) => {
          inserted.push(content);
          return { run };
        },
      }),
    }),
  };
}

describe('slash-create kit — embed result', () => {
  it('insertEmbed returns true when the insert lands', () => {
    const ed = editor(() => true);
    expect(insertEmbed(ed, 'endpoint', 'get-users')).toBe(true);
    expect(ed.inserted).toEqual([{ type: 'single_element', attrs: { type: 'endpoint', slug: 'get-users' } }]);
  });

  it('insertEmbed returns false when the chain refuses', () => {
    expect(insertEmbed(editor(() => false), 'endpoint', 'get-users')).toBe(false);
  });

  it('a throwing insert counts as not embedded', () => {
    const ed = editor(() => {
      throw new Error('boom');
    });
    expect(runInsert(ed, { type: 'inline_mention' })).toBe(false);
  });

  it('a destroyed editor counts as not embedded, without touching the chain', () => {
    // Tiptap drops a destroyed editor's transaction yet its chain answers `true`.
    const ed = { ...editor(() => true), isDestroyed: true };
    expect(insertEmbed(ed, 'endpoint', 'get-users')).toBe(false);
    expect(ed.inserted).toEqual([]);
  });

  it('reportNotEmbedded fires a warning toast naming the entity and slug', () => {
    toastCalls.length = 0;
    reportNotEmbedded('GET /api/users', 'get-users');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]!.variant).toBe('warning');
    expect(toastCalls[0]!.arg).toEqual({ durationMs: NOT_EMBEDDED_TOAST_MS });
    expect(toastCalls[0]!.message).toBe(notEmbeddedMessage('GET /api/users', 'get-users'));
    expect(toastCalls[0]!.message).toMatch(/“GET \/api\/users” \(slug: get-users\) was created/);
  });
});
