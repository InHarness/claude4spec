// Registering entity modules — import order establishes registry.
//
// Two left. Every other type arrives as a plugin frontend bundle that
// self-registers (entity def, slash command, routes, create popover) at runtime
// through the M33 frontend-manifest boot loader: `endpoint`/`dto`,
// `database-table`, `spreadsheet`, and — as of 0.2.18 — `ui-view` and
// `design-system`, which travel together in `c4s-plugin-frontend-mockups`.
import './ac/plugin.js';
import './diagram/plugin.js';

export { getEntityDef, listActiveEntityTypes, registerEntity } from './registry.js';
export type {
  EntityDef,
  EntityRowProps,
  EntityChipProps,
  EntityCardProps,
  EntityDetailProps,
} from './registry.js';
