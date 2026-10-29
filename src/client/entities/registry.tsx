import type { ComponentType } from 'react';
import type { EntityType } from '../../shared/entities.js';
import { legacyRegisterClientEntity } from '../core/plugin-host/legacy-adapter.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import type { Tag } from '../../shared/plugin-host/tag.js';
import type { RefLookupEntry } from '../host-ui-kit/actions/EntityRefValue.js';

export interface EntityRowProps<T> {
  slug: string;
  entity: T;
  active?: boolean;
  onOpen?: () => void;
  /**
   * 2.1.40 — the project's tags, slug → `Tag`, from ONE host `['tags']` query
   * per list (`useListTagLookup`); the same instance for every row of a list.
   */
  tagLookup: ReadonlyMap<string, Tag>;
  /**
   * 2.1.41 — `${type}:${slug}` of a TARGET record → its `RefLookupEntry`, for every
   * value of this type's `ref` fields across the whole list (`useListRefLookup`):
   * one map per list, the same instance for every row, empty when there is
   * nothing to resolve. Draw a value with `EntityRefValue`.
   */
  refLookup: ReadonlyMap<string, RefLookupEntry>;
}

export interface EntityChipProps<T> {
  slug: string;
  entity: T | null;
  onOpen?: () => void;
}

export interface EntityCardProps<T> extends EntityChipProps<T> {
  /**
   * 0.2.15 — the `caption` written on THIS `<single_element/>` reference.
   * Advisory prose belonging to the reference, not to the entity, and absent
   * whenever the tag omitted it (no prop, not `''`). It is never written onto
   * the entity — two embeds of one entity may carry two different captions.
   */
  caption?: string;
  /**
   * 2.1.63 — write the caption back onto the REFERENCE this card was rendered
   * from: the host stores it in the `caption` attribute of the page's
   * `single_element` tag, never on the entity. Supplied only where there is a
   * reference to write to (the editor's `single_element` node view); a read-only
   * context (chat, a release diff, a tool card) gets no callback.
   *
   * `null` clears the attribute rather than storing `''`, which is what keeps
   * the serializer from emitting `caption=""` on the round-trip.
   */
  onCaptionChange?: (caption: string | null) => void;
  /** 2.1.41 — the `refLookup` built for this card's one entity (`useRefLookup`); empty when nothing resolves. */
  refLookup: ReadonlyMap<string, RefLookupEntry>;
}

/**
 * 2.1.63 — props of the `renderOverlay` slot, the content of the host's
 * `<type>-expand` window (M13 chipprops). `caption` is the reference's own
 * caption when the window opens from a card carrying one — absent otherwise;
 * `onClose` closes the window.
 */
export interface EntityOverlayProps {
  slug: string;
  caption?: string;
  onClose: () => void;
}

/**
 * `detailPanel` props — four REQUIRED fields (2.1.16). The host never renders the
 * slot and calls none of the callbacks; the plugin's detail route passes them to
 * its own panel. `onBack` is unused. No `onOpenEntity` / `onOpenPage`: navigation
 * to a related entity or page goes through `editorBridge.openEntity(type, slug)` /
 * `editorBridge.openSection(...)` (re-exported from `@c4s/plugin-runtime`, M13
 * xr8fs8dc / z7l89jhf, 2.1.28), not through the slot's props.
 */
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
  renderOverlay?: ComponentType<EntityOverlayProps>;
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
 * Which picker a type is offered in.
 *
 *  - `element` — `/element`, `/mention` and the edit popover of a chip or card:
 *    every ACTIVE type, hidden ones (e.g. `spreadsheet`) included. A hidden type
 *    has no route, but it does have a card and a chip.
 *  - `list` — `/list`, `/tagged` and the edit popover of a list node: only the
 *    active types that render a list row. A type without `renderRow` (e.g.
 *    `code-snippet`) has no list view and would only ever produce the host's
 *    "has no list view" information block.
 */
export type EntityPickerKind = 'element' | 'list';

/** 2.1.1 — the active types a type picker of `kind` offers, in the client host's listing order. */
export function listPickerEntityTypes(kind: EntityPickerKind): EntityType[] {
  const active = clientPluginHost.listEntities();
  return (kind === 'list' ? active.filter((m) => m.renderRow) : active).map((m) => m.type);
}
