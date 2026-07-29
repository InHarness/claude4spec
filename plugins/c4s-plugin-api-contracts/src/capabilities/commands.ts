import type { PluginCommandContribution } from '@c4s/plugin-runtime';
import { DTO_POPOVER_KIND } from '../entity/dto/frontend/slash-create.js';
import { ENDPOINT_POPOVER_KIND } from '../entity/endpoint/frontend/slash-create.js';

/**
 * The two slash commands, declared.
 *
 * `/endpoint` and `/dto` used to be hardcoded cases in the host's `slashInvoke`.
 * Declaring them here is what puts them back in the palette: the host renders
 * the menu entry and, on invoke, dispatches `c4s:plugin-command` with
 * `popoverKind`. Everything after that is this package's — see
 * `frontend-kit/slash-create.tsx`.
 *
 * The kinds are imported from the popovers themselves rather than restated, so
 * a rename cannot silently unhook the command from its handler.
 */
export const apiContractCommands: PluginCommandContribution[] = [
  {
    name: 'endpoint-slash',
    trigger: 'endpoint',
    label: '/endpoint',
    popoverKind: ENDPOINT_POPOVER_KIND,
  },
  {
    name: 'dto-slash',
    trigger: 'dto',
    label: '/dto',
    popoverKind: DTO_POPOVER_KIND,
  },
];
