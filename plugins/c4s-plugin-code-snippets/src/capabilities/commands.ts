import type { PluginCommandContribution } from '@c4s/plugin-runtime';
import { CODE_SNIPPET_POPOVER_KIND } from '../identity.js';

/**
 * `/code-snippet` — declared HERE and nowhere else.
 *
 * There are two ways to put a slash command in the palette: this manifest
 * contribution, and a `slashCommand` on a `FrontendModule.editorExtensions`
 * entry. Declaring BOTH for one trigger is a trap the `api-contracts` envelope
 * already fell into: the palette filters by substring, so both entries match
 * `/code-snippet`, and the module-borne one wins by default because frontend
 * modules mount before plugin commands register. Choosing it deletes the typed
 * text and opens nothing, because it is the MANIFEST entry that carries the
 * `popoverKind` `invokeSlash` dispatches on.
 *
 * This type contributes no editor extension at all, so there is nothing to
 * collide with — but the rule is written down here because the next person to
 * add one will not otherwise know it.
 */
export const codeSnippetCommands: PluginCommandContribution[] = [
  {
    name: 'code-snippet-slash',
    trigger: 'code-snippet',
    label: '/code-snippet',
    description: 'Insert code snippet',
    hint: 'title',
    popoverKind: CODE_SNIPPET_POPOVER_KIND,
  },
];
