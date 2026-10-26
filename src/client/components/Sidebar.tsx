import { useCallback, useRef, useState, type ReactNode } from 'react';
import { stripBase } from '../lib/api-core.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { C4sLogoIcon } from './C4sLogoIcon.js';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileCode,
  FileCode2,
  FileText,
  Folder,
  GitCommit,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  StickyNote,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { PageNode, PageSearchHit, SidebarAccordion } from '../../shared/types.js';
import { markdownExtension, countFiles } from '../../shared/page-files.js';
import { usePages, usePagesSearch, useSidebarAccordions } from '../hooks/usePages.js';
import { accordionCollapseToken, subtreeOf } from '../lib/sidebar-accordions.js';
import { useMovePage } from '../hooks/usePage.js';
import { api } from '../lib/api.js';
import { useRoots } from '../hooks/useConfig.js';
import { useNewPageAction } from '../hooks/useNewPage.js';
import { usePersistedState, projectKey } from '../state/persisted.js';
import { UserSection } from './UserSection.js';
import { GitStatusBadge } from './GitStatusBadge.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { useRegistryVersion } from '../core/plugin-host/useRegistryVersion.js';
import { Popover } from '../host-ui-kit/overlay-feedback/Popover.js';
import { SidebarSideMenu } from './shell/SidebarSideMenu.js';

interface SidebarProps {
  width: number;
  cwdPath: string;
  projectName: string | null;
  headerLoading: boolean;
  /**
   * 0.1.96 multiroot: the sidebar now self-fetches one tree per accordion root
   * (see `RootAccordion`). Kept optional for the built-in `'pages'` root's tree
   * during the transition — no longer read for rendering.
   */
  tree?: PageNode[];
  /** 0.1.96: pages-root file count (legacy; per-root counts render on each accordion). */
  pageCount?: number;
  /** Per-plugin-type counts, keyed by `module.type`. */
  entityCounts: Record<string, number>;
  todoCount: number;
  todoCountByPath: Record<string, number>;
  brokenLinkCount: number;
  unresolvedMentionCount: number;
}

/**
 * 0.1.96 multiroot: per-root open/closed state. Value is the list of COLLAPSED
 * folder paths for that root (default is expanded, matching pre-multiroot UX).
 * 2.1.9: an accordion's own state is keyed `(rootId, key)` — stored under its
 * root as `accordionCollapseToken(key)`. Entries under a root that no longer
 * carries an accordion are ignored on read (only the current array is looked up).
 */
type SidebarOpenState = Record<string, string[]>;

export function Sidebar({
  width,
  cwdPath,
  projectName,
  headerLoading,
  entityCounts,
  todoCount,
  todoCountByPath,
  brokenLinkCount,
  unresolvedMentionCount,
}: SidebarProps) {
  const navigate = useNavigate();
  const roots = useRoots();
  // 2.1.9 (M02): the page-tree slot is fed by `GET /api/sidebar-accordions` —
  // one accordion per element, in the route's order, whatever the root's kind.
  const { data: accordions = [], isSuccess: accordionsLoaded } = useSidebarAccordions();
  const pathname = stripBase(useRouterState({ select: (s) => s.location.pathname }));
  // /space/<rootId>/<path…>
  const spaceMatch = /^\/space\/([^/]+)\/(.*)$/.exec(pathname);
  const activeRootId = spaceMatch ? decodeURIComponent(spaceMatch[1] ?? '') : null;
  const activePagePath = spaceMatch ? decodeURIComponent(spaceMatch[2] ?? '') : null;
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const [collapsed, setCollapsed] = usePersistedState<SidebarOpenState>(
    projectKey('c4s:sidebar:pages-open'),
    {},
    2,
  );
  const toggle = useCallback(
    (rootId: string, path: string) => {
      const cur = collapsed[rootId] ?? [];
      const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path];
      setCollapsed({ ...collapsed, [rootId]: next });
    },
    [collapsed, setCollapsed],
  );
  // Sidebar search is scoped to the BASE page root — 0.2.101: the entry carrying
  // `builtin: true`, whatever its identifier.
  const baseRootId = roots.find((r) => r.builtin)?.id ?? null;
  const { data: searchHits = [], isFetching: searchFetching } = usePagesSearch(query, baseRootId);
  // 2.1.17 (M02 `66se825m`): the only place a page is created from — always in
  // the base root, whatever accordions are open (see `useNewPageAction`).
  const newPage = useNewPageAction();
  const newPageRef = useRef<HTMLButtonElement>(null);

  return (
    <aside
      className="flex flex-col min-h-0 h-full"
      style={{ width, background: 'var(--c-panel)' }}
    >
      <div
        className="flex items-center gap-2 px-3.5 pt-3 pb-2"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <a
          href="https://claude4spec.inharness.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center"
          style={{ width: 22, height: 22, flexShrink: 0 }}
          title="claude4spec.inharness.ai"
        >
          <C4sLogoIcon size={22} />
        </a>
        <ProjectSwitcher projectName={projectName} cwdPath={cwdPath} loading={headerLoading} />
        <button
          onClick={() => navigate({ to: '/settings' })}
          className="rounded p-1"
          style={{ color: 'var(--c-muted)' }}
          title="Settings"
          aria-label="Open settings"
        >
          <SettingsIcon size={13} />
        </button>
      </div>

      <UserSection />
      <GitStatusBadge />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <SectionHeader
          label="Pages"
          right={
            <button
              ref={newPageRef}
              onClick={() => {
                const rect = newPageRef.current?.getBoundingClientRect();
                void newPage({ x: (rect?.left ?? 0) + 8, y: (rect?.bottom ?? 0) + 6 });
              }}
              className="rounded p-0.5"
              style={{ color: 'var(--c-muted)' }}
              title="New page"
              aria-label="New page"
            >
              <Plus size={12} />
            </button>
          }
        />

        <div className="px-2 pt-1 pb-1">
          <div
            className="flex items-center gap-1.5 rounded-md px-2 py-1"
            style={{
              background: 'var(--c-card)',
              border: `1px solid ${searching ? 'var(--c-accent)' : 'var(--c-hair)'}`,
            }}
          >
            <Search size={11} style={{ color: 'var(--c-subtle)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages…"
              spellCheck={false}
              className="flex-1 bg-transparent outline-none text-[11.5px] min-w-0"
              style={{ color: 'var(--c-ink)' }}
            />
            {searching && (
              <button
                onClick={() => setQuery('')}
                title="Clear"
                style={{ color: 'var(--c-muted)' }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto nice-scroll px-1.5 pt-1 pb-2">
          {searching ? (
            <SearchResults
              hits={searchHits}
              rootId={baseRootId}
              loading={searchFetching}
              activePath={activeRootId === baseRootId ? activePagePath : null}
              onClose={() => setQuery('')}
            />
          ) : accordions.length > 0 ? (
            accordions.map((accordion, i) => (
              <TreeAccordion
                key={`${accordion.rootId}\u0000${accordion.key}`}
                accordion={accordion}
                first={i === 0}
                collapsedPaths={collapsed[accordion.rootId] ?? []}
                onToggle={(path) => toggle(accordion.rootId, path)}
                activePagePath={activeRootId === accordion.rootId ? activePagePath : null}
                todoCountByPath={todoCountByPath}
              />
            ))
          ) : !accordionsLoaded ? null : (
            <div
              className="text-[11.5px] px-3 py-2 italic"
              style={{ color: 'var(--c-subtle)' }}
            >
              No page roots configured.
            </div>
          )}
        </div>

        <SidebarElements entityCounts={entityCounts} pathname={pathname} />
      </div>

      <OthersMenu
        pathname={pathname}
        todoCount={todoCount}
        linkIssueCount={brokenLinkCount + unresolvedMentionCount}
        brokenLinkCount={brokenLinkCount}
      />
    </aside>
  );
}

/**
 * ELEMENTS — the middle section of the sidebar: one tab per ACTIVE entity type
 * that declares a `sidebarTab`, in `sidebarTab.order`.
 *
 * Subscribed to the registry: plugin frontends register after the first paint
 * (non-blocking boot), and nothing else guarantees this component re-renders
 * then — until 0.2.110 an incidental root re-render on every router change hid
 * that the tabs never asked for one. The same signal carries activation: a save
 * on Settings → Entities re-applies it in this tab (`refreshPluginActivation`),
 * so the tabs follow without a reload or a server restart. A Trust plugins
 * answer rebuilds the context in-process too, but reloads the project's tabs
 * (the overlay layer changed, not only activation). Nothing else re-applies it
 * — a change made in another browser tab or by hand in `config.json` shows
 * after a page reload (M50 `8h2a734u`).
 *
 * 2.1.16: with no active type (`config.entities = []`) the section shows the
 * host's "No entity types configured." message. (2.1.20: `sidebarTab` carries
 * only `icon`, `label` and `order` — `emptyState` left the contract.)
 */
export function SidebarElements({
  entityCounts,
  pathname,
}: {
  entityCounts: Record<string, number>;
  pathname: string;
}) {
  useRegistryVersion();
  const entityTabs = clientPluginHost
    .listEntities()
    .filter((m) => m.sidebarTab !== undefined)
    .sort((a, b) => (a.sidebarTab!.order ?? 999) - (b.sidebarTab!.order ?? 999));
  return (
    <>
      <SectionHeader label="Elements" />
      <div className="px-1.5 pb-3 space-y-0.5">
        {entityTabs.length > 0 ? (
          entityTabs.map((m) => (
            <NavLinkRow
              key={m.type}
              icon={m.sidebarTab!.icon}
              label={m.sidebarTab!.label}
              count={entityCounts[m.type] ?? 0}
              active={isElementsEntryActive(pathname, [m.pathPrefix])}
              to={m.pathPrefix}
            />
          ))
        ) : (
          <div
            className="text-[11.5px] px-3 py-2 italic"
            style={{ color: 'var(--c-subtle)' }}
          >
            No entity types configured.
          </div>
        )}
      </div>
    </>
  );
}

/**
 * M50 `8h2a734u`: an ELEMENTS entry is active when the route path (without the
 * project prefix) starts with the route prefix of ANY type the entry covers.
 */
export function isElementsEntryActive(pathname: string, pathPrefixes: readonly string[]): boolean {
  return pathPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function SectionHeader({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-3 pt-2.5 pb-1">
      <span
        className="text-[10px] uppercase tracking-wider font-mono font-semibold"
        style={{ color: 'var(--c-subtle)' }}
      >
        {label}
      </span>
      <span className="flex-1" />
      {right}
    </div>
  );
}

function NavLinkRow({
  icon: I,
  label,
  count,
  active,
  to,
  disabled,
  disabledHint,
  staleCount = 0,
  brokenCount = 0,
  highlightCount = false,
  extra,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  to: string;
  disabled?: boolean;
  disabledHint?: string;
  staleCount?: number;
  brokenCount?: number;
  highlightCount?: boolean;
  extra?: ReactNode;
}) {
  const style: React.CSSProperties = {
    background: active ? 'var(--c-accent-soft)' : 'transparent',
    color: disabled ? 'var(--c-subtle)' : active ? 'var(--c-ink)' : 'var(--c-muted)',
    fontWeight: active ? 600 : 500,
    border: `1px solid ${active ? 'var(--c-hair-strong)' : 'transparent'}`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };

  const badge =
    brokenCount > 0 ? (
      <span
        className="inline-flex items-center justify-center rounded-full font-mono font-semibold"
        style={{
          fontSize: 9.5,
          minWidth: 14,
          height: 14,
          padding: '0 4px',
          background: 'rgba(196, 90, 59, 0.18)',
          color: '#c45a3b',
          border: '1px solid #c45a3b',
        }}
        title={`${brokenCount} broken`}
      >
        {brokenCount}
      </span>
    ) : staleCount > 0 ? (
      <span
        className="inline-flex items-center justify-center rounded-full font-mono font-semibold"
        style={{
          fontSize: 9.5,
          minWidth: 14,
          height: 14,
          padding: '0 4px',
          background: 'rgba(200, 150, 60, 0.2)',
          color: '#a87033',
          border: '1px solid #c99467',
        }}
        title={`${staleCount} stale`}
      >
        {staleCount}
      </span>
    ) : null;

  const countStyle: React.CSSProperties = highlightCount
    ? { fontSize: 10.5, color: '#a87033' }
    : { fontSize: 10.5, color: 'var(--c-subtle)' };

  const body = (
    <>
      <I size={13} />
      <span className="flex-1 truncate">{label}</span>
      {extra}
      {badge}
      <span className="font-mono" style={countStyle}>
        {count}
      </span>
    </>
  );

  const className =
    'w-full flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-[13px] transition text-left';

  if (disabled) {
    return (
      <button className={className} style={style} disabled title={disabledHint}>
        {body}
      </button>
    );
  }
  return (
    <Link to={to} className={className} style={style} title={label}>
      {body}
    </Link>
  );
}

function SearchResults({
  hits,
  rootId,
  loading,
  activePath,
  onClose,
}: {
  hits: PageSearchHit[];
  /** The searched space — the base root. Null only while the config is loading. */
  rootId: string | null;
  loading: boolean;
  activePath: string | null;
  onClose: () => void;
}) {
  if (loading && hits.length === 0) {
    return (
      <div className="text-[11.5px] px-3 py-2 italic" style={{ color: 'var(--c-subtle)' }}>
        Searching…
      </div>
    );
  }
  if (hits.length === 0) {
    return (
      <div className="text-[11.5px] px-3 py-2 italic" style={{ color: 'var(--c-subtle)' }}>
        No pages match.
      </div>
    );
  }
  return (
    <div>
      {hits.map((hit) => {
        const active = activePath === hit.path;
        return (
          <Link
            key={hit.path + hit.line}
            to="/space/$rootId/$"
            params={{ rootId: rootId ?? '', _splat: hit.path }}
            onClick={onClose}
            className="block px-2 py-1 rounded text-[12px]"
            style={{
              color: active ? 'var(--c-ink)' : 'var(--c-muted)',
              background: active ? 'var(--c-accent-soft)' : 'transparent',
              fontWeight: active ? 600 : 400,
              textDecoration: 'none',
            }}
          >
            <div className="flex items-center gap-1.5">
              <FileText size={11} style={{ color: 'var(--c-subtle)', flexShrink: 0 }} />
              <span className="truncate flex-1" title={hit.path}>
                {hit.path}
              </span>
              {hit.line > 0 && (
                <span
                  className="font-mono shrink-0"
                  style={{ fontSize: 9.5, color: 'var(--c-subtle)' }}
                >
                  L{hit.line}
                </span>
              )}
            </div>
            {hit.snippet && (
              <div
                className="text-[10.5px] mt-0.5 truncate pl-[18px]"
                style={{ color: 'var(--c-subtle)' }}
                title={hit.snippet}
              >
                {hit.snippet}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * 2.1.9 (M02 slot „Drzewa stron”) — one collapsible accordion per element of
 * `GET /api/sidebar-accordions`, labelled `label`, showing the subtree `path`
 * of root `rootId` cut out of that root's tree (`['pages', rootId]`, shared by
 * every accordion of the root). Files outside every accordion subtree of the
 * root have no node. Its open state is keyed `(rootId, key)`.
 * 2.1.17: no row creates or deletes an entry — a page is created only by the
 * `+` at the PAGES header, in the base root, never in the accordion's subtree.
 */
function TreeAccordion({
  accordion,
  first,
  collapsedPaths,
  onToggle,
  activePagePath,
  todoCountByPath,
}: {
  accordion: SidebarAccordion;
  first: boolean;
  collapsedPaths: string[];
  onToggle: (path: string) => void;
  activePagePath: string | null;
  todoCountByPath?: Record<string, number>;
}) {
  const { data: tree = [] } = usePages(accordion.rootId);
  const nodes = subtreeOf(tree, accordion.path);
  const token = accordionCollapseToken(accordion.key);
  const open = !collapsedPaths.includes(token);
  const fileCount = countFiles(nodes);
  // 0.1.97: visually separate consecutive accordions — a ~12px gap plus a faint
  // top hairline on every accordion after the first (no line under the search box).
  return (
    <div
      style={
        first
          ? undefined
          : { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-hair)' }
      }
    >
      <button
        className="w-full flex items-center gap-1.5 px-2 py-[3px] rounded transition"
        style={{ color: 'var(--c-subtle)' }}
        onClick={() => onToggle(token)}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-panel)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        title={accordion.label}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1 truncate text-left text-[10px] uppercase tracking-wider font-mono font-semibold">
          {accordion.label}
        </span>
        <span className="font-mono" style={{ fontSize: 10 }}>
          {fileCount}
        </span>
      </button>
      {open &&
        (nodes.length > 0 ? (
          <PagesTree
            rootId={accordion.rootId}
            nodes={nodes}
            activePath={activePagePath}
            todoCountByPath={todoCountByPath}
            collapsedPaths={collapsedPaths}
            onToggle={onToggle}
          />
        ) : (
          <div className="text-[11.5px] px-3 py-1.5 italic" style={{ color: 'var(--c-subtle)' }}>
            No pages yet.
          </div>
        ))}
    </div>
  );
}

function PagesTree({
  rootId,
  nodes,
  depth = 0,
  activePath,
  todoCountByPath,
  collapsedPaths,
  onToggle,
}: {
  rootId: string;
  nodes: PageNode[];
  depth?: number;
  activePath: string | null;
  todoCountByPath?: Record<string, number>;
  collapsedPaths: string[];
  onToggle: (path: string) => void;
}) {
  return (
    <div>
      {nodes.map((n) => {
        if (n.type === 'folder') {
          const isOpen = !collapsedPaths.includes(n.path);
          return (
            <div key={n.path}>
              <button
                className="w-full flex items-center gap-1.5 px-2 py-[3px] rounded text-[13px] transition"
                style={{ paddingLeft: 6 + depth * 12, color: 'var(--c-muted)' }}
                onClick={() => onToggle(n.path)}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-panel)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Folder size={13} />
                <span className="font-medium">{n.name}</span>
              </button>
              {isOpen && n.children && (
                <PagesTree
                  rootId={rootId}
                  nodes={n.children}
                  depth={depth + 1}
                  activePath={activePath}
                  todoCountByPath={todoCountByPath}
                  collapsedPaths={collapsedPaths}
                  onToggle={onToggle}
                />
              )}
            </div>
          );
        }
        const active = activePath === n.path;
        // 0.1.96: todos-indexer keys counts by `${rootId}:${path}`.
        const todoCount = todoCountByPath?.[`${rootId}:${n.path}`] ?? 0;
        return (
          <PageRow
            key={n.path}
            rootId={rootId}
            node={n}
            depth={depth}
            active={active}
            todoCount={todoCount}
          />
        );
      })}
    </div>
  );
}

/**
 * 0.2.78 — one file row, and the only place a page can be renamed from.
 *
 * 2.1.17 (M02 `66se825m`): the context menu (right click, or the row's `…`
 * trigger) has ONE item, Rename, and only on `.md` / `.mdx` rows. An `.html`
 * row is a read-only preview and has no menu at all; folders are not files and
 * have none either (`PagesTree` renders them without one). Nothing in a row
 * creates or deletes an entry.
 *
 * ## Why "Rename" is one menu item and not two
 *
 * The field takes a PATH relative to the root, not a bare filename, so typing
 * `guides/auth.md` over `auth.md` files the page into `guides/` and typing
 * `login.md` over `auth.md` renames it in place. Those are the same server
 * operation (`move_page` differs only in how `to` is filled), so offering them
 * as separate menu entries would be the UI inventing a distinction the model
 * does not have — and then having to explain it.
 *
 * Crossing roots is not offered, and it is the field's shape that withholds it
 * rather than a check: the value is read relative to THIS root, so another
 * accordion tree has no spelling here. A page's identity is `(rootId, path)`, so
 * a cross-root move would be a write in one store plus a delete in another —
 * which is not a move. A path that tries to climb out with `../` is refused by
 * the server as `INVALID_ARGUMENT` and surfaced inline below the field.
 */
function PageRow({
  rootId,
  node,
  depth,
  active,
  todoCount,
}: {
  rootId: string;
  node: PageNode;
  depth: number;
  active: boolean;
  todoCount: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * A ref, not state: it has to be readable by the very next synchronous call,
   * and a `setState` would not have landed yet when the disable-induced blur
   * re-enters `commit`.
   */
  const submitting = useRef(false);
  const move = useMovePage();
  const navigate = useNavigate();

  const startRename = () => {
    setMenuOpen(false);
    setError(null);
    setDraft(node.path);
  };

  const commit = async () => {
    /**
     * Re-entry guard, and the second half of it is the one that matters.
     *
     * The field is `disabled` while the mutation is in flight, and a browser
     * BLURS an element the moment it becomes disabled — so `onBlur` fires from
     * inside the first commit and starts a second one for the same row: another
     * read, another move. The loser answers NOT_FOUND or PAGE_EXISTS and paints
     * a failure over a rename that worked.
     */
    if (move.isPending || submitting.current) return;
    const to = (draft ?? '').trim();
    if (!to || to === node.path) return setDraft(null);
    submitting.current = true;
    /**
     * The guard value: this client's own record of the page if it has one, and
     * a read only when it does not.
     *
     * `useWritePage` refuses to read-for-the-hash, and rightly — writing back
     * bytes you re-read a moment ago guards nothing. A move is the opposite
     * case and the read is honest work: the operation never opens the file, so
     * `expectedHash` is the ONLY thing standing between a mistyped path and
     * relocating a page nobody looked at. Reading it here is how the tree, which
     * genuinely has not read the page, produces one.
     */
    try {
      const hash = (await api.read(rootId, node.path)).hash;
      const ack = await move.mutateAsync({ rootId, from: node.path, to, expectedHash: hash });
      setDraft(null);
      /**
       * If the page being renamed is the one on screen, FOLLOW IT.
       *
       * Without this the tree updates and the route does not: the reader is
       * left looking at a document under an address that now 404s, so the
       * rename appears to have worked until they reload — at which point the
       * page they are editing is "missing". Only the active row navigates;
       * renaming some other file must not yank the reader out of what they are
       * reading.
       */
      if (active) {
        void navigate({ to: '/space/$rootId/$', params: { rootId, _splat: ack.path } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'rename failed');
    } finally {
      submitting.current = false;
    }
  };

  if (draft !== null) {
    return (
      <div style={{ paddingLeft: 6 + depth * 12 + 14 }} className="px-2 py-[3px]">
        <input
          autoFocus
          value={draft}
          disabled={move.isPending}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') {
              setDraft(null);
              setError(null);
            }
          }}
          className="w-full bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--c-ink)', borderBottom: '1px solid var(--c-accent)' }}
          aria-label="New page path, relative to this root"
        />
        {error && (
          <div className="text-[11px] pt-0.5" style={{ color: 'var(--c-red)' }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // `.html` files are read-only previews: no menu, no trigger, no right click.
  const hasMenu = node.fileType !== 'html';

  return (
    <div
      className="group relative flex items-center"
      data-page-row={node.path}
      onContextMenu={
        hasMenu
          ? (e) => {
              e.preventDefault();
              setMenuOpen(true);
            }
          : undefined
      }
    >
      <Link
        to="/space/$rootId/$"
        params={{ rootId, _splat: node.path }}
        className="w-full flex items-center gap-1.5 px-2 py-[3px] rounded text-[13px] transition text-left"
        style={{
          paddingLeft: 6 + depth * 12 + 14,
          color: active ? 'var(--c-ink)' : 'var(--c-muted)',
          background: active ? 'var(--c-accent-soft)' : 'transparent',
          fontWeight: active ? 600 : 400,
        }}
      >
        {node.fileType === 'html' ? (
          <FileCode2 size={12} style={{ color: 'var(--c-accent)' }} />
        ) : markdownExtension(node.name) === 'mdx' ? (
          <FileCode size={12} style={{ color: 'var(--c-accent)' }} />
        ) : (
          <FileText size={12} />
        )}
        <span className="truncate flex-1">{node.name}</span>
        {todoCount > 0 && (
          <span
            className="font-mono shrink-0"
            style={{ fontSize: 10, color: '#a87033' }}
            title={`${todoCount} TODO${todoCount === 1 ? '' : 's'}`}
          >
            {todoCount}
          </span>
        )}
      </Link>
      {hasMenu && (
        <>
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.preventDefault();
              setMenuOpen((v) => !v);
            }}
            className="absolute right-1 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-0.5"
            style={{ color: 'var(--c-muted)', opacity: menuOpen ? 1 : undefined }}
            title={`Actions for ${node.name}`}
            aria-label={`Actions for ${node.name}`}
          >
            <MoreHorizontal size={12} />
          </button>
          {/*
           * The published `Popover`, not a twin of it: the primitive owns the z-tier, the viewport clamp and the
           * mousedown/Escape dismissal, and naming any of that here is the anatomy
           * the one-implementation scan looks for.
           */}
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={triggerRef}
            placement="right"
            width={180}
          >
            <button
              onClick={startRename}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[13px] text-left transition"
              style={{ color: 'var(--c-ink)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-panel)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Pencil size={13} />
              <span>Rename…</span>
            </button>
          </Popover>
        </>
      )}
    </div>
  );
}

/**
 * OTHERS (M50 `8h2a734u`) — a closed list of 6 items in a fixed order: Plans →
 * Releases → TODOs → Tags → Links → Briefs. An item is active when the route is
 * its own (or below it).
 */
const OTHERS_ITEMS: ReadonlyArray<{ to: string; icon: LucideIcon; label: string }> = [
  { to: '/plans', icon: ClipboardList, label: 'Plans' },
  { to: '/releases', icon: GitCommit, label: 'Releases' },
  { to: '/todos', icon: StickyNote, label: 'TODOs' },
  { to: '/tags', icon: Tag, label: 'Tags' },
  { to: '/links', icon: Link2, label: 'Links' },
  { to: '/briefs', icon: FileText, label: 'Briefs' },
];

const isOnRoute = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * The OTHERS link at the bottom of the sidebar — it opens the shell's sidebar
 * side menu (`SidebarSideMenu`), the same mechanism ELEMENTS entries use.
 */
function OthersMenu({
  pathname,
  todoCount,
  linkIssueCount,
  brokenLinkCount,
}: {
  pathname: string;
  todoCount: number;
  linkIssueCount: number;
  brokenLinkCount: number;
}) {
  const extras: Record<string, ReactNode> = {
    '/todos': todoCount > 0 ? <AmberBadge count={todoCount} /> : null,
    '/links': (
      <>
        {brokenLinkCount > 0 ? <BrokenBadge count={brokenLinkCount} /> : null}
        {linkIssueCount > 0 ? <AmberBadge count={linkIssueCount} /> : null}
      </>
    ),
  };
  const items = OTHERS_ITEMS.map((item) => ({
    ...item,
    active: isOnRoute(pathname, item.to),
    extra: extras[item.to],
  }));
  const inOthers = items.some((item) => item.active);

  return (
    <div className="px-1.5 py-2" style={{ borderTop: '1px solid var(--c-hair)' }}>
      <SidebarSideMenu
        label="Others"
        items={items}
        title="Others (Plans, Releases, TODOs, Tags, Links, Briefs)"
        triggerClassName="w-full flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-[13px] transition text-left"
        triggerStyle={(open) => ({
          background: inOthers || open ? 'var(--c-accent-soft)' : 'transparent',
          color: inOthers ? 'var(--c-ink)' : 'var(--c-muted)',
          fontWeight: inOthers ? 600 : 500,
          border: `1px solid ${inOthers || open ? 'var(--c-hair-strong)' : 'transparent'}`,
        })}
      >
        <MoreHorizontal size={13} />
        <span className="flex-1 truncate">OTHERS</span>
        <ChevronRight size={12} />
      </SidebarSideMenu>
    </div>
  );
}

function BrokenBadge({ count }: { count: number }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 9.5,
        color: '#c45a3b',
        border: '1px solid #c45a3b',
        borderRadius: 999,
        padding: '0 6px',
        background: 'rgba(196, 90, 59, 0.18)',
      }}
      title={`${count} broken`}
    >
      {count}
    </span>
  );
}

function AmberBadge({ count }: { count: number }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 9.5,
        color: '#a87033',
        border: '1px solid #c99467',
        borderRadius: 999,
        padding: '0 6px',
        background: 'rgba(200, 150, 60, 0.2)',
      }}
    >
      {count}
    </span>
  );
}
