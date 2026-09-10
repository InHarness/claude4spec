/**
 * `/ac` — declared exactly ONCE, on the manifest.
 *
 * The trap this pins is not hypothetical here: before 0.2.80 the command was
 * declared on `FrontendModule.editorExtensions` (through the host's
 * `registerEditorExtension`, from `src/client/entities/ac/plugin.tsx`) AND
 * executed by a hardcoded `case 'ac'` in the host's `slashInvoke`. The move
 * replaces both with one manifest contribution carrying a `popoverKind`.
 *
 * Re-adding the `editorExtensions` half would look harmless and would break the
 * command silently: the palette filters by substring, so both entries match
 * `/ac`, and the module-borne one WINS because frontend modules mount before
 * plugin commands register. Choosing it deletes the typed text and opens
 * nothing, because it is the manifest entry that carries the `popoverKind`
 * `invokeSlash` dispatches on.
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { acCommands } from '../src/capabilities/commands.js';
import { acFrontendModule } from '../src/entity/ac/frontend/module.js';
import { AC_POPOVER_KIND } from '../src/identity.js';

describe('/ac', () => {
  it('the manifest declares exactly one command for the trigger', () => {
    expect(acCommands.filter((c) => c.trigger === 'ac')).toHaveLength(1);
  });

  it('that command carries the popoverKind invokeSlash dispatches on', () => {
    expect(acCommands.find((c) => c.trigger === 'ac')?.popoverKind).toBe(AC_POPOVER_KIND);
  });

  it('the frontend module declares NO slash command of its own', () => {
    const extensions = acFrontendModule.editorExtensions ?? [];
    expect(extensions.filter((e) => e.slashCommand)).toHaveLength(0);
  });
});

describe('the manifest as a whole', () => {
  it('reaches the loader through contributes.commands, not just the module', () => {
    expect(manifest.contributes?.commands).toBe(acCommands);
  });
});
