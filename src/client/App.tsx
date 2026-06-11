import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, stripBase } from './lib/api-core.js';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { ChatEdgeAffordance } from './components/ChatEdgeAffordance.js';
import { ChatOverlay } from './chat/ChatOverlay.js';
import { ResizeHandle } from './components/ResizeHandle.js';
import { Sidebar } from './components/Sidebar.js';
import { useFileWatcher } from './hooks/useFileWatcher.js';
import { usePages } from './hooks/usePages.js';
import { useWritePage } from './hooks/usePage.js';
import { useEndpoints } from './hooks/useEndpoints.js';
import { useDtos } from './hooks/useDtos.js';
import { useDatabaseTables } from './hooks/useDatabaseTables.js';
import { useUiViews } from './hooks/useUiViews.js';
import { useAcs } from './hooks/useAcs.js';
import { useTodosCounts } from './hooks/useTodos.js';
import { usePageLinksCounts } from './hooks/usePageLinks.js';
import { NewDatabaseTablePopover } from './components/NewDatabaseTablePopover.js';
import { NewUiViewPopover } from './components/NewUiViewPopover.js';
import { TodoPopover } from './components/TodoPopover.js';
import { PopoverHost } from './ui/Popover.js';
import { ModalHost } from './ui/ConfirmModal.js';
import { ToastHost } from './ui/ToastHost.js';
import { PageRefPopoverHost } from './tiptap/extensions/PageRefPopover.js';
import { openPopover, toast } from './ui/events.js';
import { usePersistedWidth, useTheme } from './state/tweaks.js';
import { useChatStore } from './state/chat.js';
import { useConfig } from './hooks/useConfig.js';
import type { PageNode } from '../shared/types.js';

export function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: config } = useConfig();
  const currentPath = stripBase(location.pathname);
  const isOnboardingPath = currentPath === '/onboarding';
  // Decision #11: `/welcome` runs project-less — no config fetch, no project
  // shell. Rendered in the same minimal container as onboarding.
  const isWelcomePath = currentPath === '/welcome';

  // M16 mount-time guard: jezeli config swiezy (onboardingCompleted=false),
  // przekierowujemy na /onboarding zanim user zobaczy edytor.
  useEffect(() => {
    if (!config) return;
    if (!config.onboarding.completed && !isOnboardingPath) {
      navigate({ to: '/onboarding', replace: true });
    }
  }, [config, isOnboardingPath, navigate]);

  useEffect(() => {
    document.title = config?.name ? `${config.name} | claude4spec` : 'claude4spec';
  }, [config?.name]);

  // Minimalny shell dla onboardingu i welcome (bez sidebara, chatu, watchera).
  // MainShell nie mountuje sie, wiec useFileWatcher / pages-tree query nie
  // ruszaja — istotne dla `/welcome`, ktore dziala bez aktywnego projektu.
  if (isOnboardingPath || isWelcomePath) {
    return (
      <div
        className="h-full w-full"
        style={{ background: 'var(--c-bg)', color: 'var(--c-ink)' }}
      >
        <Outlet />
        <ModalHost />
        <ToastHost />
      </div>
    );
  }

  return <MainShell projectName={config?.name ?? null} />;
}

function MainShell({ projectName }: { projectName: string | null }) {
  // M26 §7 — mount the theme hook here for its side-effects (subscribes to
  // OS-level `prefers-color-scheme` changes, toggles the `.dark` class on
  // <html>). The selectable UI lives in /settings → Appearance.
  useTheme();
  const [sidebarW, setSidebarW] = usePersistedWidth('sidebar', 300);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useFileWatcher();

  const { data: tree = [] } = usePages();
  const { data: allEndpoints = [] } = useEndpoints();
  const { data: allDtos = [] } = useDtos();
  const { data: allDatabaseTables = [] } = useDatabaseTables();
  const { data: allUiViews = [] } = useUiViews();
  const { data: allAcs = [] } = useAcs();
  const { data: todoCounts } = useTodosCounts();
  const { data: pageLinkCounts } = usePageLinksCounts();
  const write = useWritePage();

  const { cwd: cwdPath, loading: cwdLoading } = useCwdLabel();
  const headerLoading = projectName === null || cwdLoading;
  const pageCount = countFiles(tree);

  const onSidebarDrag = useCallback(
    (x: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const w = Math.max(220, Math.min(540, x - rect.left));
      setSidebarW(w);
    },
    [setSidebarW]
  );

  const handleNewPage = useCallback(async () => {
    const rect = rootRef.current?.getBoundingClientRect();
    const result = await openPopover(
      'new-page',
      { x: (rect?.left ?? 0) + 40, y: (rect?.top ?? 0) + 80 },
      {},
    );
    if (!result) return;
    try {
      await write.mutateAsync({
        path: result.path,
        body: `# ${deriveTitle(result.path)}\n\n`,
      });
      navigate({ to: '/pages/$', params: { _splat: result.path } });
      toast.success(`Page ${result.path} created`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [write, navigate]);

  useEffect(() => {
    const onNewPage = () => {
      void handleNewPage();
    };
    window.addEventListener('c4s:new-page', onNewPage);
    return () => window.removeEventListener('c4s:new-page', onNewPage);
  }, [handleNewPage]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useChatStore.getState().toggleChat();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      ref={rootRef}
      className="h-full w-full flex"
      style={{ color: 'var(--c-ink)' }}
    >
      <div style={{ width: sidebarW, flexShrink: 0 }} className="flex">
        <Sidebar
          width={sidebarW}
          cwdPath={cwdPath}
          projectName={projectName}
          headerLoading={headerLoading}
          tree={tree}
          onNewPage={handleNewPage}
          pageCount={pageCount}
          entityCounts={{
            endpoint: allEndpoints.length,
            dto: allDtos.length,
            'database-table': allDatabaseTables.length,
            'ui-view': allUiViews.length,
            ac: allAcs.length,
          }}
          todoCount={todoCounts?.total ?? 0}
          todoCountByPath={todoCounts?.byPath ?? {}}
          brokenLinkCount={pageLinkCounts?.brokenLinkCount ?? 0}
          unresolvedMentionCount={pageLinkCounts?.unresolvedMentionCount ?? 0}
        />
      </div>
      <ResizeHandle onDrag={onSidebarDrag} />

      <Outlet />

      <ChatEdgeAffordance />
      <ChatOverlay />
      <NewDatabaseTablePopover />
      <NewUiViewPopover />
      <TodoPopover />
      <PopoverHost />
      <PageRefPopoverHost />
      <ModalHost />
      <ToastHost />
    </div>
  );
}

function countFiles(nodes: PageNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === 'file') n++;
    else if (node.children) n += countFiles(node.children);
  }
  return n;
}

function deriveTitle(filePath: string): string {
  const base = filePath.split('/').pop() ?? 'untitled';
  return base.replace(/\.md$/, '').replaceAll('-', ' ');
}

function useCwdLabel(): { cwd: string; loading: boolean } {
  const [cwd, setCwd] = useState('workspace');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch('/api/meta')
      .then((r) => r.json())
      .then((d: { cwd?: string }) => d.cwd && setCwd(d.cwd))
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => setLoading(false));
  }, []);
  return { cwd, loading };
}

