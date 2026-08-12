import type { PluginCommandContribution } from '@c4s/plugin-runtime';
import { DESIGN_SYSTEM_POPOVER_KIND, UI_VIEW_POPOVER_KIND } from '../identity.js';

/**
 * `/uiview` and `/design-system` — declared HERE and nowhere else.
 *
 * There are two ways to put a slash command in the palette: this manifest
 * contribution, and a `slashCommand` on a `FrontendModule.editorExtensions`
 * entry. Declaring both for one trigger is a trap two envelopes have already
 * fallen into — and it is exactly what the host code these two commands replace
 * did, from `src/client/entities/<type>/plugin.tsx`. The palette filters by
 * substring so both entries match, and the module-borne one wins because
 * frontend modules mount before plugin commands register. Choosing it deletes
 * the typed text and opens nothing, because it is the manifest entry that
 * carries the `popoverKind` `invokeSlash` dispatches on.
 *
 * `label` and `description` are carried over verbatim from the host's retired
 * `registerEditorExtension` calls, so the palette reads the same after the move.
 */
export const frontendMockupCommands: PluginCommandContribution[] = [
  {
    name: 'ui-view-slash',
    trigger: 'uiview',
    label: '/uiview',
    description: 'Create a new UI view inline',
    hint: 'name',
    popoverKind: UI_VIEW_POPOVER_KIND,
  },
  {
    name: 'design-system-slash',
    trigger: 'design-system',
    label: '/design-system',
    description: 'Create a new design system inline',
    hint: 'name',
    popoverKind: DESIGN_SYSTEM_POPOVER_KIND,
  },
];
