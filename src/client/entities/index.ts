// Registering entity modules — import order establishes registry.
import './endpoint/plugin.js';
import './dto/plugin.js';
// `database-table` is no longer an in-app entity — it ships in the preinstalled
// `c4s-plugin-simple-database-tables` plugin, whose frontend bundle self-registers
// (entity def, slash command, `/database-tables` routes + create/edit popover) at
// runtime via the M33 frontend-manifest boot loader.
import './ui-view/plugin.js';
import './ac/plugin.js';
import './design-system/plugin.js';
import './diagram/plugin.js';

export { getEntityDef, listEntityDefs, registerEntity } from './registry.js';
export type {
  EntityDef,
  EntityRowProps,
  EntityChipProps,
  EntityCardProps,
  EntityDetailProps,
} from './registry.js';
