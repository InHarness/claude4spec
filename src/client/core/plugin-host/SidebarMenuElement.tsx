import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, EyeOff, Eye, Trash2, type LucideIcon } from 'lucide-react';
import {
  elementsMenuSaveIssues,
  isElementsMenuGroup,
  type ElementsMenuEntry,
  type ElementsMenuSaveIssue,
} from '../../../shared/elements-menu.js';
import { Feedback, inputStyle } from '../../components/settings/controls.js';
import type { ConfigKeyPath, ElementContext, SettingsElementDecl } from '../../components/settings/registry.js';
import { clientPluginHost } from './host.js';
import { GROUP_ICONS, byDefaultOrder, groupIcon, hasSidebarTab } from './elements-menu.js';
import { useRegistryVersion } from './useRegistryVersion.js';
import {
  addGroup,
  deleteGroup,
  groupId,
  hideType,
  inTree,
  materializeLayout,
  moveEntry,
  moveMember,
  moveType,
  removeType,
  renameGroup,
  restoreType,
  setGroupIcon,
  type TypeLocation,
} from './sidebar-menu-editor.js';

export const ELEMENTS_MENU_KEY: ConfigKeyPath = ['elementsMenu'];
const ENTITIES_KEY: ConfigKeyPath = ['entities'];

/** The helper text of the element (M13 `4ckqwi8t`, verbatim). */
export const SIDEBAR_MENU_HELP =
  'Arrange entity types and groups in any order, or hide a type from the sidebar. Hidden types stay active. Types you have not placed appear at the end.';

/**
 * How one slug shows in the editor: an option (ticked in the Entity types draft
 * and declaring a `sidebarTab`) with its tab's label and icon; an active type
 * unticked in the draft — greyed, with its label, staying in place; or an
 * inactive / unknown / tab-less slug — greyed, shown by its slug, kept on save
 * and removable.
 */
interface TypeView {
  slug: string;
  label: string;
  icon: LucideIcon | null;
  greyed: boolean;
  removable: boolean;
}

/** The message without the `elementsMenu[i]: ` prefix the API pins it with. */
const bare = (message: string) => message.replace(/^elementsMenu(\[\d+\])?: /, '');

/**
 * 2.1.50 (M13 `lbqrd6xh`) — the Sidebar menu element of the `#entities` card:
 * the ELEMENTS menu as the sidebar shows it (the file's entries, then the types
 * the menu does not place, in `sidebarTab.order`; no key — the flat default
 * list), with the Hidden list below. Every action edits the card's draft; the
 * card's shared [Save] writes the whole menu, the previously unplaced types
 * included. Reset to default order drafts the key's REMOVAL (`null`).
 */
export function SidebarMenuElement({ draft }: ElementContext & { decl: SettingsElementDecl }) {
  const registryVersion = useRegistryVersion();
  const raw = draft.get(ELEMENTS_MENU_KEY) as ElementsMenuEntry[] | null | undefined;
  const ticked = draft.get(ENTITIES_KEY) as string[] | undefined;

  // The options: types ticked in the Entity types draft (absent ⇒ every type of
  // the pool) that declare a sidebarTab, in the default order.
  const options = useMemo(() => {
    const pool = Array.isArray(ticked) ? ticked : clientPluginHost.listAvailable().map((m) => m.type);
    return byDefaultOrder(pool.map((t) => clientPluginHost.getAvailable(t)).filter(hasSidebarTab)).map((m) => m.type);
  }, [ticked, registryVersion]);

  const list = useMemo(() => materializeLayout(raw, options), [raw, options]);
  const dirty = draft.isDirty(ELEMENTS_MENU_KEY);
  const issues = useMemo(() => (Array.isArray(raw) ? elementsMenuSaveIssues(list) : []), [raw, list]);
  const firstIssue = dirty ? (issues[0]?.message ?? null) : null;

  // A broken rule (2–5) holds the card's [Save] — only once the menu is edited,
  // so a file broken by a merge never blocks a save of the Entity types.
  // The draft object is rebuilt on every edit; its setters are not, so the
  // effects read it through a ref and run only when the issue itself changes.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    draftRef.current.setLiveError(ELEMENTS_MENU_KEY, firstIssue);
  }, [firstIssue]);
  useEffect(() => () => draftRef.current.setLiveError(ELEMENTS_MENU_KEY, null), []);

  const view = (slug: string): TypeView => {
    const m = clientPluginHost.getAvailable(slug);
    const tab = clientPluginHost.isActive(slug) ? m?.sidebarTab : undefined;
    if (options.includes(slug)) {
      const t = m!.sidebarTab!;
      return { slug, label: t.label, icon: t.icon, greyed: false, removable: false };
    }
    if (tab) return { slug, label: tab.label, icon: tab.icon, greyed: true, removable: false };
    return { slug, label: slug, icon: null, greyed: true, removable: true };
  };

  const set = (next: ElementsMenuEntry[]) => draft.set(ELEMENTS_MENU_KEY, next);

  // Rows are keyed by slug / group id, so a moved row keeps its DOM; a browser
  // may still drop focus when React re-inserts a node, so after a move the
  // row's Move button gets focus back (the other one once it hits an end) and a
  // keyboard user can press it again.
  const rootRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ row: string; dir: 'up' | 'down' } | null>(null);
  const move = (row: string, dir: 'up' | 'down', next: ElementsMenuEntry[]) => {
    refocus.current = { row, dir };
    set(next);
  };
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('button[data-order-for]') ?? [],
    ).filter((b) => b.getAttribute('data-order-for') === want.row);
    const pick = (dir: 'up' | 'down') => buttons.find((b) => b.getAttribute('data-order-dir') === dir && !b.disabled);
    const target = pick(want.dir) ?? pick(want.dir === 'up' ? 'down' : 'up');
    if (target && document.activeElement !== target) target.focus();
  }, [list]);
  const disabled = draft.saving;
  const groups = list.map((e, i) => [e, i] as const).filter(([e]) => isElementsMenuGroup(e));
  const tree = list.map((e, i) => [e, i] as const).filter(([e]) => inTree(e));
  const hidden = list.flatMap((e, i) => (isElementsMenuGroup(e) || inTree(e) ? [] : [[e.type, i] as const]));
  const issuesAt = (index: number, at: ElementsMenuSaveIssue['at']) =>
    issues.filter((x) => x.index === index && x.at === at).map((x) => bare(x.message));
  const serverError = draft.error(ELEMENTS_MENU_KEY);
  const strayError = serverError !== null && serverError !== firstIssue ? serverError : null;

  const typeRow = (slug: string, at: TypeLocation, extra: { up?: () => void; down?: () => void }) => {
    const v = view(slug);
    const Icon = v.icon;
    const here = at.member === undefined ? 'top' : String(at.entry);
    const row = `t:${slug}`;
    return (
      <div
        key={row}
        data-menu-type={slug}
        data-greyed={v.greyed ? 'true' : undefined}
        className="flex items-center gap-2 rounded-md px-2 py-1"
        style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', opacity: v.greyed ? 0.55 : 1 }}
      >
        {Icon ? <Icon size={14} aria-hidden /> : null}
        <span className={`flex-1 text-[13px]${Icon ? '' : ' font-mono'}`} style={{ color: 'var(--c-ink)' }}>
          {v.label}
        </span>
        <OrderButtons row={row} up={extra.up} down={extra.down} disabled={disabled} />
        <select
          aria-label={`Move ${v.label} to`}
          value={here}
          disabled={disabled}
          onChange={(e) => set(moveType(list, at, e.target.value === 'top' ? 'top' : Number(e.target.value)))}
          className="rounded-md px-1.5 py-0.5 text-[12px]"
          style={inputStyle}
        >
          <option value="top">Top level</option>
          {groups.map(([g, gi]) => (
            <option key={gi} value={String(gi)}>
              {isElementsMenuGroup(g) ? g.group || '(no label)' : ''}
            </option>
          ))}
        </select>
        <IconButton label={`Hide ${v.label}`} icon={EyeOff} disabled={disabled} onClick={() => set(hideType(list, at))} />
        {v.removable ? (
          <IconButton label={`Remove ${v.label}`} icon={Trash2} disabled={disabled} onClick={() => set(removeType(list, at))} />
        ) : null}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5" data-testid="sidebar-menu-editor">
      <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        Sidebar menu
      </span>
      <div className="flex flex-col gap-1.5" data-menu-tree="">
        {tree.map(([entry, index], pos) => {
          const row = isElementsMenuGroup(entry) ? `g:${groupId(entry)}` : `t:${entry.type}`;
          const up = pos > 0 ? () => move(row, 'up', moveEntry(list, index, -1)) : undefined;
          const down = pos < tree.length - 1 ? () => move(row, 'down', moveEntry(list, index, 1)) : undefined;
          if (!isElementsMenuGroup(entry)) return typeRow(entry.type, { entry: index }, { up, down });
          const labelErrors = issuesAt(index, 'label');
          const typeErrors = issuesAt(index, 'types');
          const GroupIcon = groupIcon(entry.icon);
          return (
            <div
              key={row}
              data-menu-group={entry.group}
              className="flex flex-col gap-1.5 rounded-md px-2 py-2"
              style={{ border: '1px solid var(--c-hair)' }}
            >
              <div className="flex items-center gap-2">
                <GroupIcon size={14} aria-hidden />
                <input
                  type="text"
                  aria-label="Group label"
                  value={entry.group}
                  disabled={disabled}
                  onChange={(e) => set(renameGroup(list, index, e.target.value))}
                  className="flex-1 rounded-md px-2 py-0.5 text-[13px]"
                  style={inputStyle}
                />
                <select
                  aria-label="Group icon"
                  value={entry.icon !== undefined && Object.hasOwn(GROUP_ICONS, entry.icon) ? entry.icon : ''}
                  disabled={disabled}
                  onChange={(e) => set(setGroupIcon(list, index, e.target.value === '' ? undefined : e.target.value))}
                  className="rounded-md px-1.5 py-0.5 text-[12px]"
                  style={inputStyle}
                >
                  <option value="">Default (folder)</option>
                  {Object.keys(GROUP_ICONS).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <OrderButtons row={row} up={up} down={down} disabled={disabled} />
                <IconButton
                  label={`Delete group ${entry.group}`}
                  icon={Trash2}
                  disabled={disabled}
                  onClick={() => set(deleteGroup(list, index))}
                />
              </div>
              {labelErrors.map((m) => (
                <Feedback key={m} error={m} />
              ))}
              <div className="flex flex-col gap-1 pl-5" data-menu-group-types="">
                {entry.types.map((slug, member) =>
                  typeRow(
                    slug,
                    { entry: index, member },
                    {
                      up: member > 0 ? () => move(`t:${slug}`, 'up', moveMember(list, index, member, -1)) : undefined,
                      down:
                        member < entry.types.length - 1
                          ? () => move(`t:${slug}`, 'down', moveMember(list, index, member, 1))
                          : undefined,
                    },
                  ),
                )}
                {typeErrors.map((m) => (
                  <Feedback key={m} error={m} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => set(addGroup(list))}
          className="rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
          style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
        >
          New group
        </button>
        <button
          type="button"
          disabled={disabled || raw === undefined || raw === null}
          onClick={() => draft.set(ELEMENTS_MENU_KEY, null)}
          className="rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
          style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
        >
          Reset to default order
        </button>
      </div>
      <div className="flex flex-col gap-1" data-menu-hidden="">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--c-muted)' }}>
          Hidden
        </span>
        {hidden.length === 0 ? (
          <span className="text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
            No hidden types.
          </span>
        ) : (
          hidden.map(([slug, index]) => {
            const v = view(slug);
            const Icon = v.icon;
            return (
              <div
                key={`h:${v.slug}`}
                data-menu-hidden-type={v.slug}
                data-greyed={v.greyed ? 'true' : undefined}
                className="flex items-center gap-2 rounded-md px-2 py-1"
                style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', opacity: v.greyed ? 0.55 : 1 }}
              >
                {Icon ? <Icon size={14} aria-hidden /> : null}
                <span className={`flex-1 text-[13px]${Icon ? '' : ' font-mono'}`} style={{ color: 'var(--c-ink)' }}>
                  {v.label}
                </span>
                <IconButton label={`Restore ${v.label}`} icon={Eye} disabled={disabled} onClick={() => set(restoreType(list, index))} />
                {v.removable ? (
                  <IconButton
                    label={`Remove ${v.label}`}
                    icon={Trash2}
                    disabled={disabled}
                    onClick={() => set(removeType(list, { entry: index }))}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {strayError ? (
        <Feedback error={strayError} />
      ) : (
        <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          {SIDEBAR_MENU_HELP}
        </span>
      )}
    </div>
  );
}

function OrderButtons({
  row,
  up,
  down,
  disabled,
}: {
  /** The row's React key — the focus restore finds the row's buttons by it. */
  row: string;
  up?: () => void;
  down?: () => void;
  disabled: boolean;
}) {
  return (
    <>
      <IconButton
        label="Move up"
        icon={ArrowUp}
        disabled={disabled || !up}
        onClick={() => up?.()}
        order={[row, 'up']}
      />
      <IconButton
        label="Move down"
        icon={ArrowDown}
        disabled={disabled || !down}
        onClick={() => down?.()}
        order={[row, 'down']}
      />
    </>
  );
}

function IconButton({
  label,
  icon: Icon,
  disabled,
  onClick,
  order,
}: {
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  onClick: () => void;
  /** A Move button: its row and direction. */
  order?: readonly [string, 'up' | 'down'];
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-order-for={order?.[0]}
      data-order-dir={order?.[1]}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 disabled:opacity-30"
      style={{ color: 'var(--c-muted)' }}
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}
