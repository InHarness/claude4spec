import type { PluginCommandContribution } from '@c4s/plugin-runtime';
import { SPREADSHEET_POPOVER_KIND } from '../identity.js';

/**
 * `/spreadsheet` — declared HERE and nowhere else.
 *
 * There are two ways to put a slash command in the palette: this manifest
 * contribution, and a `slashCommand` on a `FrontendModule.editorExtensions`
 * entry. Declaring both for one trigger is a trap the `api-contracts` envelope
 * already fell into: the palette filters by substring, so both entries match
 * `/spreadsheet`, and the module-borne one is selected by default because
 * frontend modules mount before plugin commands register. Choosing it deletes
 * the typed text and opens nothing, because it is the manifest entry that
 * carries the `popoverKind` `invokeSlash` dispatches on.
 *
 * So the editor extension registers the Tiptap node and NOTHING else.
 */
export const spreadsheetCommands: PluginCommandContribution[] = [
  {
    name: 'spreadsheet-slash',
    trigger: 'spreadsheet',
    label: '/spreadsheet',
    description: 'Create a spreadsheet and embed it here',
    hint: 'name',
    popoverKind: SPREADSHEET_POPOVER_KIND,
  },
];
