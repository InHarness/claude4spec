import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Folder,
  GitCommit,
  Link2,
  MoreHorizontal,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  StickyNote,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { PageNode, PageSearchHit } from '../../shared/types.js';
import { usePagesSearch } from '../hooks/usePages.js';
import { usePersistedState, projectKey } from '../state/persisted.js';
import { UserSection } from './UserSection.js';
import { clientPluginHost } from '../core/plugin-host/host.js';

interface SidebarProps {
  width: number;
  cwdLabel: string;
  projectName: string | null;
  tree: PageNode[];
  onNewPage: () => void;
  pageCount: number;
  /** Per-plugin-type counts, keyed by `module.type`. */
  entityCounts: Record<string, number>;
  todoCount: number;
  todoCountByPath: Record<string, number>;
  brokenLinkCount: number;
  unresolvedMentionCount: number;
}

export function Sidebar({
  width,
  cwdLabel,
  projectName,
  tree,
  onNewPage,
  pageCount,
  entityCounts,
  todoCount,
  todoCountByPath,
  brokenLinkCount,
  unresolvedMentionCount,
}: SidebarProps) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activePagePath = pathname.startsWith('/pages/')
    ? decodeURIComponent(pathname.slice('/pages/'.length))
    : null;
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const [openFolders, setOpenFolders] = usePersistedState<Record<string, boolean>>(
    projectKey('c4s:sidebar:pages-open'),
    {},
    1,
  );
  const toggleFolder = useCallback(
    (path: string) =>
      setOpenFolders({ ...openFolders, [path]: !(openFolders[path] ?? true) }),
    [openFolders, setOpenFolders],
  );
  const { data: searchHits = [], isFetching: searchFetching } = usePagesSearch(query);
  const filesActive = pathname === '/' || pathname.startsWith('/pages');
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
        <div
          className="rounded-md flex items-center justify-center"
          style={{ width: 22, height: 22, background: 'var(--c-accent)', color: '#fff' }}
        >
          <Sparkles size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold tracking-tight truncate">claude4spec</div>
          <div
            className="text-[10.5px] -mt-0.5 truncate"
            style={{ color: 'var(--c-subtle)' }}
            title={projectName ? `${projectName} · ${cwdLabel}` : cwdLabel}
          >
            {projectName ? `${projectName} · ${cwdLabel}` : cwdLabel}
          </div>
        </div>
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
        <div className="px-1.5">
          <NavLinkRow
            icon={FileText}
            label="Pages"
            count={pageCount}
            active={filesActive}
            to="/"
          />
        </div>

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
              activePath={activePagePath}
              onClose={() => setQuery('')}
            />
          ) : tree.length > 0 ? (
            <PagesTree
              nodes={tree}
              activePath={activePagePath}
              todoCountByPath={todoCountByPath}
              open={openFolders}
              onToggle={toggleFolder}
            />
          ) : (
            <div
              className="text-[11.5px] px-3 py-2 italic"
              style={{ color: 'var(--c-subtle)' }}
            >
              No pages yet — use + to create one.
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
  icon: ComponentType<{ className?: string; size?: number | string }>;
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
            to="/pages/$"
            params={{ _splat: hit.path }}
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

function PagesTree({
  nodes,
  depth = 0,
  activePath,
  todoCountByPath,
  open,
  onToggle,
}: {
  nodes: PageNode[];
  depth?: number;
  activePath: string | null;
  todoCountByPath?: Record<string, number>;
  open: Record<string, boolean>;
  onToggle: (path: string) => void;
}) {
  return (
    <div>
      {nodes.map((n) => {
        if (n.type === 'folder') {
          const isOpen = open[n.path] ?? true;
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
                  nodes={n.children}
                  depth={depth + 1}
                  activePath={activePath}
                  todoCountByPath={todoCountByPath}
                  open={open}
                  onToggle={onToggle}
                />
              )}
            </div>
          );
        }
        const active = activePath === n.path;
        const todoCount = todoCountByPath?.[n.path] ?? 0;
        return (
          <Link
            key={n.path}
            to="/pages/$"
            params={{ _splat: n.path }}
            className="w-full flex items-center gap-1.5 px-2 py-[3px] rounded text-[13px] transition text-left"
            style={{
              paddingLeft: 6 + depth * 12 + 14,
              color: active ? 'var(--c-ink)' : 'var(--c-muted)',
              background: active ? 'var(--c-accent-soft)' : 'transparent',
              fontWeight: active ? 600 : 400,
            }}
          >
            <FileText size={12} />
            <span className="truncate flex-1">{n.name}</span>
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
        );
      })}
    </div>
  );
}

const OTHERS_PATHS = ['/plans', '/releases', '/todos', '/tags', '/links'];

function OthersTrigger({
  todoCount,
  linkIssueCount,
  brokenLinkCount,
}: {
  todoCount: number;
  linkIssueCount: number;
  brokenLinkCount: number;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const inOthers = OTHERS_PATHS.some((p) => pathname.startsWith(p));

  const closeMenu = useCallback(() => {
    setOpen(false);
    setAnchor(null);
  }, []);

  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Trigger siedzi na dnie sidebara — kotwiczymy panel dolną krawędzią
    // do dolnej krawędzi triggera, żeby rósł w górę i pozycje były widoczne.
    setAnchor({
      left: rect.right + 4,
      bottom: window.innerHeight - rect.bottom,
    });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (triggerRef.current?.contains(t)) return;
      if (t.closest('[data-others-flyout]')) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closeMenu]);

  return (
    <>
      <div className="px-1.5 py-2" style={{ borderTop: '1px solid var(--c-hair)' }}>
        <button
          ref={triggerRef}
          onClick={() => (open ? closeMenu() : openMenu())}
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

      {open && anchor && (
        <OthersFlyout
          anchor={anchor}
          onNavigate={closeMenu}
          todoCount={todoCount}
          linkIssueCount={linkIssueCount}
          brokenLinkCount={brokenLinkCount}
        />
      )}
    </>
  );
}

function OthersFlyout({
  anchor,
  onNavigate,
  todoCount,
  linkIssueCount,
  brokenLinkCount,
}: {
  anchor: { left: number; bottom: number };
  onNavigate: () => void;
  todoCount: number;
  linkIssueCount: number;
  brokenLinkCount: number;
}) {
  return (
    <div
      data-others-flyout
      style={{
        position: 'fixed',
        left: anchor.left,
        bottom: anchor.bottom,
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        padding: 6,
        minWidth: 200,
        zIndex: 60,
      }}
    >
      <FlyoutLink to="/plans" icon={ClipboardList} label="Plans" onNavigate={onNavigate} />
      <FlyoutLink to="/releases" icon={GitCommit} label="Releases" onNavigate={onNavigate} />
      <FlyoutLink
        to="/todos"
        icon={StickyNote}
        label="TODOs"
        amberBadge={todoCount > 0 ? todoCount : null}
        onNavigate={onNavigate}
      />
      <FlyoutLink to="/tags" icon={Tag} label="Tags" onNavigate={onNavigate} />
      <FlyoutLink to="/briefs" icon={FileText} label="Briefs" onNavigate={onNavigate} />
      <FlyoutLink
        to="/links"
        icon={Link2}
        label="Links"
        amberBadge={linkIssueCount > 0 ? linkIssueCount : null}
        brokenCount={brokenLinkCount}
        onNavigate={onNavigate}
      />
    </div>
  );
};

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
