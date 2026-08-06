import type { PluginCommandContribution } from '@c4s/plugin-runtime';
import { DATABASE_TABLE_POPOVER_KIND } from '../identity.js';

/**
 * `/database-table` — declared HERE and nowhere else.
 *
 * There are two ways to put a slash command in the palette: this manifest
 * contribution, and a `slashCommand` on a `FrontendModule.editorExtensions`
 * entry. Declaring both for one trigger is a trap two envelopes have already
 * fallen into — and the retired plugin declared both, in
 * `capabilities/commands.ts` AND `entity/frontend/slash-command.ts`. The
 * palette filters by substring so both entries match, and the module-borne one
 * wins because frontend modules mount before plugin commands register.
 * Choosing it deletes the typed text and opens nothing, because it is the
 * manifest entry that carries the `popoverKind` `invokeSlash` dispatches on.
 */
export const databaseTableCommands: PluginCommandContribution[] = [
  {
    name: 'database-table-slash',
    trigger: 'database-table',
    label: '/database-table',
    description: 'Create a database table and embed it here',
    hint: 'name',
    popoverKind: DATABASE_TABLE_POPOVER_KIND,
  },
];
