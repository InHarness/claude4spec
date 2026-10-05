/**
 * The slash-create kit must notice a failed embed. A Tiptap chain reports a
 * refused insert by returning `false`; a throw leaves the same orphan entity.
 * Both are `false` here, and the report names the entity so the user can embed
 * it by hand. (The kit is vendored per plugin; this copy stands for all six.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  NOT_EMBEDDED_TOAST_MS,
  insertEmbed,
  notEmbeddedMessage,
  reportNotEmbedded,
  runInsert,
  type EmbedEditor,
} from '../../src/frontend-kit/slash-create.js';

const dispatched: Array<{ type: string; detail: Record<string, unknown> }> = [];
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  }
  g.window = { dispatchEvent: (e: (typeof dispatched)[number]) => dispatched.push(e) };
});

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
    dispatched.length = 0;
    reportNotEmbedded('GET /api/users', 'get-users');
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.type).toBe('c4s:toast');
    expect(dispatched[0]!.detail.variant).toBe('warning');
    expect(dispatched[0]!.detail.durationMs).toBe(NOT_EMBEDDED_TOAST_MS);
    expect(dispatched[0]!.detail.message).toBe(notEmbeddedMessage('GET /api/users', 'get-users'));
    expect(dispatched[0]!.detail.message).toMatch(/“GET \/api\/users” \(slug: get-users\) was created/);
  });
});
