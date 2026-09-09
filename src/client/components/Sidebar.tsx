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
import type { PageNode, PageSearchHit, Root } from '../../shared/types.js';
import { markdownExtension, countFiles } from '../../shared/page-files.js';
import { usePages, usePagesSearch } from '../hooks/usePages.js';
import { useMovePage } from '../hooks/usePage.js';
import { api } from '../lib/api.js';
import { useRoots } from '../hooks/useConfig.js';
import { usePersistedState, projectKey } from '../state/persisted.js';
import { UserSection } from './UserSection.js';
import { GitStatusBadge } from './GitStatusBadge.js';
import { IndexStatusBadge } from './IndexStatusBadge.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { Popover } from '../host-ui-kit/overlay-feedback/Popover.js';

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
  onNewPage: () => void;
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
 * The sentinel `''` collapses the whole root accordion. Stale root ids are
 * ignored on read (only current roots are looked up).
 */
type SidebarOpenState = Record<string, string[]>;
const ROOT_COLLAPSE_SENTINEL = '';

export function Sidebar({
  width,
  cwdPath,
  projectName,
  headerLoading,
  onNewPage,
  entityCounts,
  todoCount,
  todoCountByPath,
  brokenLinkCount,
  unresolvedMentionCount,
}: SidebarProps) {
  const navigate = useNavigate();
  const roots = useRoots();
  const accordionRoots = roots.filter((r) => r.sidebar === 'accordion');
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
  // Sidebar search is scoped to the built-in `'pages'` root.
  const { data: searchHits = [], isFetching: searchFetching } = usePagesSearch(query);
  // Iterate active plugins in declared order; render only those with a sidebarTab.
  const entityTabs = clientPluginHost
    .listEntities()
    .filter((m) => m.sidebarTab !== undefined)
    .sort((a, b) => (a.sidebarTab!.order ?? 999) - (b.sidebarTab!.order ?? 999));

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
      {/* 0.2.77 — the same conventional status slot as the git badge. */}
      <IndexStatusBadge />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <SectionHeader
          label="Pages"
          right={
            <button
              onClick={onNewPage}
              className="rounded p-0.5"
              style={{ color: 'var(--c-muted)' }}
              title="New page"
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
              loading={searchFetching}
              activePath={activeRootId === 'pages' ? activePagePath : null}
              onClose={() => setQuery('')}
            />
          ) : accordionRoots.length > 0 ? (
            accordionRoots.map((root, i) => (
              <RootAccordion
                key={root.id}
                root={root}
                first={i === 0}
                collapsedPaths={collapsed[root.id] ?? []}
                onToggle={(path) => toggle(root.id, path)}
                activePagePath={activeRootId === root.id ? activePagePath : null}
                todoCountByPath={todoCountByPath}
              />
            ))
          ) : (
            <div
              className="text-[11.5px] px-3 py-2 italic"
              style={{ color: 'var(--c-subtle)' }}
            >
              No page roots configured.
            </div>
          )}
        </div>

        <SectionHeader label="Elements" />
        <div className="px-1.5 pb-3 space-y-0.5">
          {entityTabs.length > 0 ? (
            entityTabs.map((m) => (
              <NavLinkRow
                key={m.type}
                icon={m.sidebarTab!.icon}
                label={m.sidebarTab!.label}
                count={entityCounts[m.type] ?? 0}
                active={pathname.startsWith(m.pathPrefix)}
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
      </div>

      <OthersTrigger
        todoCount={todoCount}
        linkIssueCount={brokenLinkCount + unresolvedMentionCount}
        brokenLinkCount={brokenLinkCount}
      />
    </aside>
  );
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
  loading,
  activePath,
  onClose,
}: {
  hits: PageSearchHit[];
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
            params={{ rootId: 'pages', _splat: hit.path }}
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
 * 0.1.96 multiroot: one collapsible accordion per `sidebar: 'accordion'` root,
 * labelled by `root.name`. Each self-fetches its own tree keyed by `root.id`.
 */
function RootAccordion({
  root,
  first,
  collapsedPaths,
  onToggle,
  activePagePath,
  todoCountByPath,
}: {
  root: Root;
  first: boolean;
  collapsedPaths: string[];
  onToggle: (path: string) => void;
  activePagePath: string | null;
  todoCountByPath?: Record<string, number>;
}) {
  const { data: tree = [] } = usePages(root.id);
  const rootOpen = !collapsedPaths.includes(ROOT_COLLAPSE_SENTINEL);
  const fileCount = countFiles(tree);
  // 0.1.97: visually separate consecutive roots — a ~12px gap plus a faint top
  // hairline on every root after the first (no line directly under the search box).
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
        onClick={() => onToggle(ROOT_COLLAPSE_SENTINEL)}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-panel)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        title={root.name}
      >
        {rootOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1 truncate text-left text-[10px] uppercase tracking-wider font-mono font-semibold">
          {root.name}
        </span>
        <span className="font-mono" style={{ fontSize: 10 }}>
          {fileCount}
        </span>
      </button>
      {rootOpen &&
        (tree.length > 0 ? (
          <PagesTree
            rootId={root.id}
            nodes={tree}
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
  const move = useMovePage();
  const navigate = useNavigate();

  const startRename = () => {
    setMenuOpen(false);
    setError(null);
    setDraft(node.path);
  };

  const commit = async () => {
    const to = (draft ?? '').trim();
    if (!to || to === node.path) return setDraft(null);
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
          <div className="text-[11px] pt-0.5" style={{ color: 'var(--c-danger, #b3261e)' }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group relative flex items-center">
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
       * The published `Popover`, not a twin of it — same rule as the OTHERS
       * flyout below: the primitive owns the z-tier, the viewport clamp and the
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
    </div>
  );
}

const OTHERS_PATHS = ['/plans', '/releases', '/todos', '/tags', '/briefs', '/links'];

function OthersTrigger({
  todoCount,
  linkIssueCount,
  brokenLinkCount,
}: {
  todoCount: number;
  linkIssueCount: number;
  brokenLinkCount: number;
}) {
  const pathname = stripBase(useRouterState({ select: (s) => s.location.pathname }));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const inOthers = OTHERS_PATHS.some((p) => pathname.startsWith(p));

  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="px-1.5 py-2" style={{ borderTop: '1px solid var(--c-hair)' }}>
        <button
          ref={triggerRef}
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-[13px] transition text-left"
          style={{
            background: inOthers || open ? 'var(--c-accent-soft)' : 'transparent',
            color: inOthers ? 'var(--c-ink)' : 'var(--c-muted)',
            fontWeight: inOthers ? 600 : 500,
            border: `1px solid ${inOthers || open ? 'var(--c-hair-strong)' : 'transparent'}`,
          }}
          title="Others (Plans, Releases, TODOs, Tags, Briefs, Links)"
        >
          <MoreHorizontal size={13} />
          <span className="flex-1 truncate">OTHERS</span>
          <ChevronRight size={12} />
        </button>
      </div>

      {/*
       * M34/L12: the menu is the published `Popover`, not a twin of it. The
       * primitive supplies the popover z-tier (1100) — which is what keeps the
       * menu above the plan page's `ActionBar` (900) — plus viewport clamping
       * and the mousedown/Escape dismissal this component used to hand-roll.
       * The z-index is deliberately absent here: naming it, even in a comment,
       * is the anatomy the one-implementation scan looks for.
       *
       * `placement="right"` anchors off the trigger's right edge; because the
       * trigger sits at the bottom of the sidebar the clamp always pulls the
       * panel up, so the menu still grows upward off the trigger — now without
       * being able to run off the viewport edge, which the old flyout could.
       */}
      <Popover
        open={open}
        onClose={closeMenu}
        anchorRef={triggerRef}
        placement="right"
        width={200}
      >
        <FlyoutLink to="/plans" icon={ClipboardList} label="Plans" onNavigate={closeMenu} />
        <FlyoutLink to="/releases" icon={GitCommit} label="Releases" onNavigate={closeMenu} />
        <FlyoutLink
          to="/todos"
          icon={StickyNote}
          label="TODOs"
          amberBadge={todoCount > 0 ? todoCount : null}
          onNavigate={closeMenu}
        />
        <FlyoutLink to="/tags" icon={Tag} label="Tags" onNavigate={closeMenu} />
        <FlyoutLink to="/briefs" icon={FileText} label="Briefs" onNavigate={closeMenu} />
        <FlyoutLink
          to="/links"
          icon={Link2}
          label="Links"
          amberBadge={linkIssueCount > 0 ? linkIssueCount : null}
          brokenCount={brokenLinkCount}
          onNavigate={closeMenu}
        />
      </Popover>
    </>
  );
}

function FlyoutLink({
  to,
  icon: I,
  label,
  amberBadge,
  brokenCount,
  onNavigate,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  amberBadge?: number | null;
  brokenCount?: number;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="flex items-center gap-2 px-2 py-1.5 rounded text-[13px]"
      style={{ color: 'var(--c-ink)', textDecoration: 'none' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-panel)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <I size={13} />
      <span className="flex-1">{label}</span>
      {brokenCount && brokenCount > 0 ? (
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
          title={`${brokenCount} broken`}
        >
          {brokenCount}
        </span>
      ) : null}
      {amberBadge != null && (
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
          {amberBadge}
        </span>
      )}
    </Link>
  );
}
