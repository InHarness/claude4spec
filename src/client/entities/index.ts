// Registering entity modules — import order establishes registry.
//
// ONE left. Every other type arrives as a plugin frontend bundle that
// self-registers (entity def, slash command, routes, create popover) at runtime
// through the M33 frontend-manifest boot loader: `endpoint`/`dto`,
// `database-table`, `spreadsheet`, `ui-view` and `design-system` (together in
// `c4s-plugin-frontend-mockups`, since 0.2.18), and — as of 0.2.80 — `ac`, in
// `c4s-plugin-ac` with the `ac-audit` subagent it cannot work without.
import './diagram/plugin.js';

export { getEntityDef, listActiveEntityTypes, registerEntity } from './registry.js';
export type {
  EntityDef,
  EntityRowProps,
  EntityChipProps,
  EntityCardProps,
  EntityDetailProps,
} from './registry.js';
