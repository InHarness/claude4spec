// Registering entity modules — import order establishes registry.
import './endpoint/plugin.js';
import './dto/plugin.js';
import './database-table/plugin.js';
import './ui-view/plugin.js';
import './ac/plugin.js';

export { getEntityDef, listEntityDefs, registerEntity } from './registry.js';
export type {
  EntityDef,
  EntityRowProps,
  EntityChipProps,
  EntityCardProps,
  EntityDetailProps,
} from './registry.js';
