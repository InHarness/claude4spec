// Registering entity modules — import order establishes registry.
import './endpoint/plugin.js';
import './dto/plugin.js';
// DISABLED: the external c4s-plugin-simple-database-tables plugin now owns the
// `database-table` frontend (entity def, slash command, `/database-tables` routes
// + create/edit popover). Removing this registration stops the in-host built-in
// from shadowing the plugin's routes. The server entity, MCP server, serializer
// and spec pages still live in-host — their removal is the separate database-table
// migration (brief 0-1-82-to-0-1-83).
// import './database-table/plugin.js';
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
