// No entity module registers here. Every type arrives as a plugin frontend
// bundle that self-registers (entity def, slash command, routes, create popover)
// at runtime through the M33 frontend-manifest boot loader — `diagram`, the last
// one built into the host, since 2.1.63 from the prebuilt `diagrams` envelope.

export { getEntityDef, listPickerEntityTypes, registerEntity } from './registry.js';
export type { EntityPickerKind } from './registry.js';
export type {
  EntityDef,
  EntityRowProps,
  EntityChipProps,
  EntityCardProps,
  EntityDetailProps,
} from './registry.js';
