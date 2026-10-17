/**
 * The type's own list order (c4s-plugin-host-ui-kit-components `ctpko3bp`):
 * groups in the order of the `group` enum, a group without records hidden,
 * records inside a group sorted by `name` ascending. Search covers `name`,
 * `props[].name` and `types[].name`.
 *
 * Pure — the kit renders, the consumer forms the groups (`GroupedEntityList`).
 */

import { UI_KIT_GROUPS, type UiKitGroup } from '../../../identity.js';
import type { UiKitComponent } from '../../../types.js';

export interface UiKitListGroup {
  key: UiKitGroup;
  items: UiKitComponent[];
}

export function matchesSearch(record: UiKitComponent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const names = [
    record.name,
    ...(record.props ?? []).map((p) => p.name),
    ...(record.types ?? []).map((t) => t.name),
  ];
  return names.some((n) => typeof n === 'string' && n.toLowerCase().includes(needle));
}

export function groupRecords(records: readonly UiKitComponent[], query = ''): UiKitListGroup[] {
  const hits = records.filter((r) => matchesSearch(r, query));
  return UI_KIT_GROUPS.map((key) => ({
    key,
    items: hits.filter((r) => r.group === key).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  })).filter((g) => g.items.length > 0);
}

/** "<n> props · <binding>" — the list row subtitle. */
export function rowSubtitle(entity: Pick<UiKitComponent, 'props' | 'binding'>): string {
  const n = entity.props?.length ?? 0;
  return `${n} ${n === 1 ? 'prop' : 'props'} · ${entity.binding}`;
}
