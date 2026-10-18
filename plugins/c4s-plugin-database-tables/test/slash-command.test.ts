/**
 * The slash command is declared ONCE, and that is a structural fact worth
 * asserting structurally.
 *
 * The trap: a trigger can be declared both on the manifest's `commands`
 * contribution and as a `slashCommand` on a `FrontendModule.editorExtensions`
 * entry. The palette filters by substring so both match, and the module-borne
 * one wins because frontend modules mount before plugin commands register — but
 * only the manifest entry carries the `popoverKind` that `invokeSlash`
 * dispatches on, so choosing it deletes the typed text and opens nothing. The
 * retired plugin declared both.
 *
 * A browser assertion on "how many palette rows match" cannot express this: the
 * row is nested markup, so counting elements counts containers and labels too.
 * The declaration is the thing that must be single, so the declaration is what
 * this checks.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { databaseTableFrontendModule } from '../src/entity/database-table/frontend/module.js';
import { DATABASE_TABLE_POPOVER_KIND } from '../src/identity.js';
import { databaseTableEmbedNode } from '../src/entity/database-table/frontend/slash-create.js';

describe('/database-table — declared once', () => {
  const commands = manifest.contributes?.commands ?? [];

  it('the manifest declares exactly one command for the trigger', () => {
    expect(commands.filter((c) => c.trigger === 'database-table')).toHaveLength(1);
  });

  it('that command carries the popoverKind invokeSlash dispatches on', () => {
    expect(commands[0]?.popoverKind).toBe(DATABASE_TABLE_POPOVER_KIND);
  });

  it('the frontend module declares NO slash command of its own', () => {
    const extensions = (databaseTableFrontendModule.editorExtensions ?? []) as Array<{
      slashCommand?: unknown;
    }>;
    expect(extensions.filter((e) => e.slashCommand)).toHaveLength(0);
  });
});

// ── per-entity items of the `wklad-do-edytora-entity-database-table` sheet ──

describe('wklad-do-edytora-entity-database-table — the two editor contributions', () => {
  const commands = manifest.contributes?.commands ?? [];
  const SRC = join(import.meta.dirname, '../src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

  it('[entity:wklad-do-edytora-entity-database-table#`/database-table`] the slash command is declared once, in contributes.commands of the package envelope, carrying the popover discriminator database-table-create', () => {
    const own = commands.filter((c) => c.trigger === 'database-table');
    expect(own).toHaveLength(1);
    expect(own[0]!.popoverKind).toBe('database-table-create');
    expect(own[0]!.popoverKind).toBe(DATABASE_TABLE_POPOVER_KIND);
    // `frontend.editorExtensions` deliberately carries no second declaration.
    const extensions = (databaseTableFrontendModule.editorExtensions ?? []) as Array<{ slashCommand?: unknown }>;
    expect(extensions.filter((e) => e.slashCommand)).toHaveLength(0);
  });

  it('[entity:wklad-do-edytora-entity-database-table#generyczne osadzenie `type: "database-table"` — popover `database-table-create`] the package draws the database-table-create popover itself — not the kit Dialog — and inserts the generic embed carrying only { type, slug }', () => {
    const popover = read('entity/database-table/frontend/slash-create.tsx');
    // Mounted under the discriminator the command carries.
    expect(popover).toMatch(/mountSlashCreatePopover\(DATABASE_TABLE_POPOVER_KIND\b/);
    expect(popover).toMatch(/data-plugin-popover=\{DATABASE_TABLE_POPOVER_KIND\}/);
    // Drawn by the package: no catalog Dialog in the popover or its frame.
    for (const src of [popover, read('frontend-kit/slash-create.tsx')]) {
      expect(src).not.toMatch(/import[^;]*\bDialog\b[^;]*from '@c4s\/plugin-runtime\/ui'/);
      expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/<Dialog\b/);
    }
    // A new table goes out with an explicitly empty `columns`.
    expect(popover).toMatch(/columns: \[\]/);
    // The inserted node is the generic embed with nothing but { type, slug }.
    const node = databaseTableEmbedNode('orders');
    expect(node.attrs).toEqual({ type: 'database-table', slug: 'orders' });
  });
});
