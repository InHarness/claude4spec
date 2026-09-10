import type { PluginCommandContribution } from '@c4s/plugin-runtime';
import { AC_POPOVER_KIND } from '../identity.js';

/**
 * `/ac` — declared HERE and nowhere else.
 *
 * There are two ways to put a slash command in the palette: this manifest
 * contribution, and a `slashCommand` on a `FrontendModule.editorExtensions`
 * entry. Declaring both for one trigger is a trap two envelopes have already
 * fallen into — and it is exactly what the host code this command replaces did,
 * from `src/client/entities/ac/plugin.tsx`. The palette filters by substring so
 * both entries match, and the module-borne one wins because frontend modules
 * mount before plugin commands register. Choosing it deletes the typed text and
 * opens nothing, because it is the manifest entry that carries the
 * `popoverKind` `invokeSlash` dispatches on.
 *
 * `label`, `description` and `hint` are carried over verbatim from the host's
 * retired `registerEditorExtension` call, so the palette reads the same after
 * the move.
 */
export const acCommands: PluginCommandContribution[] = [
  {
    name: 'ac-slash',
    trigger: 'ac',
    label: '/ac',
    description: 'Create a new acceptance criterion inline',
    hint: 'observable behavior…',
    popoverKind: AC_POPOVER_KIND,
  },
];
