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

export interface EntityCardProps<T> extends EntityChipProps<T> {
  /**
   * 0.2.15 — the `caption` written on THIS `<single_element/>` reference.
   * Advisory prose belonging to the reference, not to the entity, so it is
   * never synced back and is absent whenever the tag omitted it.
   */
  caption?: string;
}

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
  /** Optional: a hidden type has no list row. */
  renderRow?: ComponentType<EntityRowProps<T>>;
  renderChip: ComponentType<EntityChipProps<T>>;
  renderCard: ComponentType<EntityCardProps<T>>;
  /** Optional: a hidden type has no detail route to put a panel on. */
  detailPanel?: ComponentType<EntityDetailProps>;
  /** Required on a hidden type (0.2.16); read-only fullscreen surface. */
  renderOverlay?: ComponentType<{ slug: string; caption?: string; onClose: () => void }>;
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

/**
 * The ACTIVE entity types, in display order.
 *
 * 0.2.11 — replaces `listEntityDefs()`, which read the local `registry` object
 * and therefore saw built-ins only: it was blind to exactly the plugin types
 * `getEntityDef` above had been fixed to resolve. It had no callers left, so
 * nothing depended on the wrong answer; this is the enumeration counterpart to
 * `getEntityDef`, reading the same single source of truth.
 */
export function listActiveEntityTypes(): EntityType[] {
  return clientPluginHost.listEntities().map((m) => m.type);
}
