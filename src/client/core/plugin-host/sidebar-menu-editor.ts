import {
  isElementsMenuGroup,
  type ElementsMenuEntry,
  type ElementsMenuGroupEntry,
} from '../../../shared/elements-menu.js';

/**
 * 2.1.50 (M13 `lbqrd6xh`) — the model of the Sidebar menu editor on the
 * `#entities` card: pure operations over the layout list, each returning a NEW
 * list. Nothing here removes a type the user did not remove: every action moves,
 * hides or restores, and only an explicit Remove drops a slug.
 */

/** Where a type sits in the list: a top-level entry, or member `member` of the group at `entry`. */
export type TypeLocation = { entry: number; member?: number };

/**
 * The editor's stable identity of a group, for React keys: it survives moves,
 * renames and the icon choice, so the focused control of a moved group is not
 * remounted. A symbol key — every clone (`{ ...g }`) carries it, JSON (the
 * draft's dirty check, the PATCH body) never sees it.
 */
const GROUP_ID = Symbol('elementsMenuGroupId');
type Identified = { [GROUP_ID]?: number };
/** Ids of groups read from the file (the draft's baseline): same object, same id. */
const fileGroupIds = new WeakMap<object, number>();
let lastGroupId = 0;

export function groupId(g: ElementsMenuGroupEntry): number {
  return (g as Identified)[GROUP_ID] ?? 0;
}

/**
 * The materialized layout: the file's entries, then every option the file does
 * not mention. A slug occupies at most one place — its first occurrence in file
 * order wins, the rule the ELEMENTS slot applies (`composeElementsSlot`) — so a
 * duplicate left by a merge is dropped here and the first edit saves the menu
 * without it, instead of holding [Save] on rule 5.
 */
export function materializeLayout(
  layout: readonly ElementsMenuEntry[] | null | undefined,
  /** The editor's type options, in the default order (`sidebarTab.order`). */
  options: readonly string[],
): ElementsMenuEntry[] {
  const placed = new Set<string>();
  const first = (type: string) => !placed.has(type) && (placed.add(type), true);
  const entries: ElementsMenuEntry[] = [];
  for (const e of layout ?? []) {
    if (isElementsMenuGroup(e)) {
      let id = (e as Identified)[GROUP_ID] ?? fileGroupIds.get(e);
      if (id === undefined) fileGroupIds.set(e, (id = ++lastGroupId));
      const group: ElementsMenuGroupEntry & Identified = {
        ...e,
        types: e.types.filter(first),
      };
      group[GROUP_ID] = id;
      entries.push(group);
    } else if (first(e.type)) {
      entries.push({ ...e });
    }
  }
  return [...entries, ...options.filter((t) => !placed.has(t)).map((type): ElementsMenuEntry => ({ type }))];
}

function cloneEntry(e: ElementsMenuEntry): ElementsMenuEntry {
  return isElementsMenuGroup(e) ? { ...e, types: [...e.types] } : { ...e };
}

const cloneAll = (list: readonly ElementsMenuEntry[]) => list.map(cloneEntry);

/** A top-level entry that stands in the tree — every entry except a hidden type. */
export function inTree(e: ElementsMenuEntry): boolean {
  return isElementsMenuGroup(e) || !e.hidden;
}

/** Moves the tree entry at `index` one place up (`-1`) or down (`1`) among the tree entries. */
export function moveEntry(list: readonly ElementsMenuEntry[], index: number, dir: -1 | 1): ElementsMenuEntry[] {
  const next = cloneAll(list);
  let other = index + dir;
  while (other >= 0 && other < next.length && !inTree(next[other]!)) other += dir;
  if (other < 0 || other >= next.length) return next;
  [next[index], next[other]] = [next[other]!, next[index]!];
  return next;
}

/** A label no group of the list uses yet (case-insensitive): `New group`, `New group 2`, … */
function freshLabel(list: readonly ElementsMenuEntry[]): string {
  const used = new Set(list.filter(isElementsMenuGroup).map((g) => g.group.trim().toLowerCase()));
  for (let n = 1; ; n += 1) {
    const label = n === 1 ? 'New group' : `New group ${n}`;
    if (!used.has(label.toLowerCase())) return label;
  }
}

/** Appends an empty group at the end of the tree. */
export function addGroup(list: readonly ElementsMenuEntry[]): ElementsMenuEntry[] {
  return [...cloneAll(list), { group: freshLabel(list), types: [] }];
}

/** Deletes the group at `index`; its types return to the top level in the group's place. */
export function deleteGroup(list: readonly ElementsMenuEntry[], index: number): ElementsMenuEntry[] {
  const next = cloneAll(list);
  const group = next[index];
  if (!group || !isElementsMenuGroup(group)) return next;
  next.splice(index, 1, ...group.types.map((type): ElementsMenuEntry => ({ type })));
  return next;
}

function updateGroup(
  list: readonly ElementsMenuEntry[],
  index: number,
  change: (g: ElementsMenuGroupEntry) => ElementsMenuGroupEntry,
): ElementsMenuEntry[] {
  return cloneAll(list).map((e, i) => (i === index && isElementsMenuGroup(e) ? change(e) : e));
}

export function renameGroup(list: readonly ElementsMenuEntry[], index: number, label: string): ElementsMenuEntry[] {
  return updateGroup(list, index, (g) => ({ ...g, group: label }));
}

/** `undefined` drops the icon — the group shows the default `folder`. */
export function setGroupIcon(
  list: readonly ElementsMenuEntry[],
  index: number,
  icon: string | undefined,
): ElementsMenuEntry[] {
  return updateGroup(list, index, (g) => {
    // Rebuilt by spread so the group keeps its editor id; key order stays group, icon, types.
    const { icon: _old, types, ...head } = g;
    return icon === undefined ? { ...head, types } : { ...head, icon, types };
  });
}

/** Moves member `member` of the group at `index` one place up or down inside the group. */
export function moveMember(
  list: readonly ElementsMenuEntry[],
  index: number,
  member: number,
  dir: -1 | 1,
): ElementsMenuEntry[] {
  return updateGroup(list, index, (g) => {
    const other = member + dir;
    if (other < 0 || other >= g.types.length) return g;
    const types = [...g.types];
    [types[member], types[other]] = [types[other]!, types[member]!];
    return { ...g, types };
  });
}

function slugAt(list: readonly ElementsMenuEntry[], at: TypeLocation): string | undefined {
  const e = list[at.entry];
  if (!e) return undefined;
  if (at.member === undefined) return isElementsMenuGroup(e) ? undefined : e.type;
  return isElementsMenuGroup(e) ? e.types[at.member] : undefined;
}

/**
 * Takes the type at `at` out of the list. A top-level entry is replaced by a
 * placeholder (`null`) so the other indices stay valid; the caller drops it.
 */
function take(list: ElementsMenuEntry[], at: TypeLocation): Array<ElementsMenuEntry | null> {
  const out: Array<ElementsMenuEntry | null> = [...list];
  if (at.member === undefined) {
    out[at.entry] = null;
    return out;
  }
  const g = out[at.entry] as ElementsMenuGroupEntry;
  out[at.entry] = { ...g, types: g.types.filter((_, j) => j !== at.member) };
  return out;
}

const compact = (list: Array<ElementsMenuEntry | null>): ElementsMenuEntry[] =>
  list.filter((e): e is ElementsMenuEntry => e !== null);

/**
 * Moves the type at `at` into the group at `target` (appended to its types), or
 * to the top level (`'top'`): a grouped type lands right after its group.
 */
export function moveType(
  list: readonly ElementsMenuEntry[],
  at: TypeLocation,
  target: number | 'top',
): ElementsMenuEntry[] {
  const slug = slugAt(list, at);
  if (slug === undefined || target === at.entry) return cloneAll(list);
  const next = take(cloneAll(list), at);
  if (target === 'top') {
    if (at.member === undefined) return compact(next);
    next.splice(at.entry + 1, 0, { type: slug });
    return compact(next);
  }
  const group = next[target];
  if (!group || !isElementsMenuGroup(group)) return cloneAll(list);
  next[target] = { ...group, types: [...group.types, slug] };
  return compact(next);
}

/**
 * Hides the type at `at`. A top-level type becomes a hidden entry in place; a
 * grouped type LEAVES its group (a hidden type belongs to no group, M13
 * `8mwihe60`) and becomes a hidden entry.
 */
export function hideType(list: readonly ElementsMenuEntry[], at: TypeLocation): ElementsMenuEntry[] {
  const slug = slugAt(list, at);
  if (slug === undefined) return cloneAll(list);
  if (at.member === undefined) {
    return cloneAll(list).map((e, i) => (i === at.entry ? { type: slug, hidden: true as const } : e));
  }
  return [...compact(take(cloneAll(list), at)), { type: slug, hidden: true }];
}

/** Restores the hidden entry at `index` to the end of the tree. */
export function restoreType(list: readonly ElementsMenuEntry[], index: number): ElementsMenuEntry[] {
  const e = list[index];
  if (!e || isElementsMenuGroup(e) || !e.hidden) return cloneAll(list);
  const next = cloneAll(list);
  next.splice(index, 1);
  return [...next, { type: e.type }];
}

/** Removes the type at `at` from the menu (an inactive or unknown slug). */
export function removeType(list: readonly ElementsMenuEntry[], at: TypeLocation): ElementsMenuEntry[] {
  if (slugAt(list, at) === undefined) return cloneAll(list);
  return compact(take(cloneAll(list), at));
}
