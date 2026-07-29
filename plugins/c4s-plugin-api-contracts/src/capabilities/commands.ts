import type { PluginCommandContribution } from '@c4s/plugin-runtime';
import { DTO_POPOVER_KIND, ENDPOINT_POPOVER_KIND } from '../identity.js';

/**
 * The two slash commands, declared.
 *
 * `/endpoint` and `/dto` used to be hardcoded cases in the host's `slashInvoke`.
 * Declaring them here is what puts them back in the palette: the host renders
 * the menu entry and, on invoke, dispatches `c4s:plugin-command` with
 * `popoverKind`. Everything after that is this package's — see
 * `frontend-kit/slash-create.tsx`.
 *
 * The kinds are imported from `identity.ts` rather than restated, so a rename
 * cannot silently unhook the command from its handler. They live THERE and not
 * beside the popovers because this file is backend-reachable — see the note on
 * the constants; importing them from a `.tsx` dragged React onto the server's
 * plugin-load path.
 */
export const apiContractCommands: PluginCommandContribution[] = [
  // `description`/`hint` carry the copy the host's hardcoded entries had. Without
  // them the palette row renders the label three times.
  {
    name: 'endpoint-slash',
    trigger: 'endpoint',
    label: '/endpoint',
    description: 'Create a new endpoint inline',
    hint: 'METHOD /path',
    popoverKind: ENDPOINT_POPOVER_KIND,
  },
  {
    name: 'dto-slash',
    trigger: 'dto',
    label: '/dto',
    description: 'Create a new DTO inline',
    hint: 'name',
    popoverKind: DTO_POPOVER_KIND,
  },
];
