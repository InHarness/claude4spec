import type { ComponentType } from 'react';
import type { EntityType } from '../../shared/entities.js';
import { legacyRegisterClientEntity } from '../core/plugin-host/legacy-adapter.js';
import { clientPluginHost } from '../core/plugin-host/host.js';

export interface EntityRowProps<T> {
  slug: string;
  entity: T;
  active?: boolean;
  onOpen?: () => void;
}

export interface EntityChipProps<T> {
  slug: string;
  entity: T | null;
  onOpen?: () => void;
}

export interface EntityCardProps<T> extends EntityChipProps<T> {}

export interface EntityDetailProps {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onBack: () => void;
}

export interface EntityDef<T = unknown> {
  type: EntityType;
  label: string;
  labelPlural: string;
  renderRow: ComponentType<EntityRowProps<T>>;
  renderChip: ComponentType<EntityChipProps<T>>;
  renderCard: ComponentType<EntityCardProps<T>>;
  detailPanel: ComponentType<EntityDetailProps>;
  useGetBySlug: (slug: string | null) => { data: T | null | undefined; isLoading: boolean };
}

const registry: Partial<Record<EntityType, EntityDef<any>>> = {};

export function registerEntity<T>(def: EntityDef<T>): void {
  registry[def.type] = def as EntityDef<any>;
  legacyRegisterClientEntity(def as EntityDef<unknown>);
}

export function getEntityDef<T = unknown>(type: string): EntityDef<T> | null {
  // Resolve from the client plugin host — the single source of truth that holds
  // BOTH built-in types (mirrored in via the legacy adapter) and plugin-registered
  // types (via registerFrontendModule). The old `registry` map only ever held
  // built-ins, so plugin entity types rendered as "unknown type" on pages.
  // `FrontendModule` is a structural superset of `EntityDef`, and `getEntity`
  // respects activation (inactive types resolve to null → broken-chip path).
  return (clientPluginHost.getEntity(type) as unknown as EntityDef<T> | null) ?? null;
}

export function listEntityDefs(): EntityDef[] {
  return Object.values(registry).filter((def): def is EntityDef => Boolean(def));
}
