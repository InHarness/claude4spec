import type { ComponentType } from 'react';
import type { EntityType } from '../../shared/entities.js';
import { legacyRegisterClientEntity } from '../core/plugin-host/legacy-adapter.js';

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
  return (registry[type as EntityType] as EntityDef<T> | undefined) ?? null;
}

export function listEntityDefs(): EntityDef[] {
  return Object.values(registry).filter((def): def is EntityDef => Boolean(def));
}
