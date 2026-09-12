/**
 * 0.2.85 — the slash palette is gated by the editor CONTEXT (L8
 * `EditorContextSpec.slashCommands`), not by "everything registered".
 *
 * Before this release the palette listed every registered command in every
 * editor: an entity description (`description` context) offered `/todo` and
 * `/section` although neither node was in its schema. This pins the whitelist
 * that `registrations.ts` declares for `description` — `/mention` only — and
 * that `page` still sees the full built-in set.
 */

import { describe, expect, it } from 'vitest';
import './registrations.js';
import { getRegisteredSlashCommandsForContext } from './registry.js';

describe('slash commands per editor context', () => {
  it('description offers /mention and nothing else built-in', () => {
    const ids = getRegisteredSlashCommandsForContext('description').map((c) => c.id);
    expect(ids).toContain('mention');
    for (const gone of ['todo', 'section', 'element', 'list', 'tagged', 'tagged-mixed']) {
      expect(ids).not.toContain(gone);
    }
  });

  it('page keeps the full built-in set', () => {
    const ids = getRegisteredSlashCommandsForContext('page').map((c) => c.id);
    for (const id of ['mention', 'todo', 'section', 'element', 'list', 'tagged', 'tagged-mixed']) {
      expect(ids).toContain(id);
    }
  });
});
