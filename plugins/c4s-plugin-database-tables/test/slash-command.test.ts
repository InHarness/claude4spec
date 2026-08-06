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

import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { databaseTableFrontendModule } from '../src/entity/database-table/frontend/module.js';
import { DATABASE_TABLE_POPOVER_KIND } from '../src/identity.js';

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
