import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch, stripBase } from './lib/api-core.js';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { ChatEdgeAffordance } from './components/ChatEdgeAffordance.js';
import { ChatOverlay } from './chat/ChatOverlay.js';
import { ThreadListProvider } from './chat/ThreadListContext.js';
import { ResizeHandle } from './components/ResizeHandle.js';
import { Sidebar } from './components/Sidebar.js';
import { useFileWatcher } from './hooks/useFileWatcher.js';
import { usePages } from './hooks/usePages.js';
import { useWritePage } from './hooks/usePage.js';
import { useEntityCounts } from './hooks/useEntityCounts.js';
import { useTodosCounts } from './hooks/useTodos.js';
import { usePageLinksCounts } from './hooks/usePageLinks.js';
import { NewUiViewPopover } from './components/NewUiViewPopover.js';
import { NewDesignSystemPopover } from './components/NewDesignSystemPopover.js';
import { TodoPopover } from './components/TodoPopover.js';
import { PopoverHost } from './ui/Popover.js';
import { ModalHost } from './ui/ConfirmModal.js';
import { GitErrorRecoveryModal } from './ui/GitErrorRecoveryModal.js';
import { ToastHost } from './ui/ToastHost.js';
import { TrustPluginsModal } from './components/TrustPluginsModal.js';
import { PageRefPopoverHost } from './tiptap/extensions/PageRefPopover.js';
import { openPopover, toast } from './ui/events.js';
import { usePersistedWidth, useTheme } from './state/tweaks.js';
import { useChatStore } from './state/chat.js';
import { useConfig } from './hooks/useConfig.js';
import { countFiles } from '../shared/page-files.js';

export function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: config, isError, error, refetch } = useConfig();
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

  // The build failure that used to deadlock the whole project (stale
  // config.json slug) is now soft-failed server-side, but any other build
  // failure still surfaces as PROJECT_BUILD_FAILED — show it instead of
  // silently falling through to MainShell with `config` undefined.
  if (isError) {
    return <ProjectLoadError error={error} onRetry={() => void refetch()} />;
  }

  return <MainShell projectName={config?.name ?? null} />;
}

function ProjectLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError && error.code === 'PROJECT_BUILD_FAILED'
      ? error.message
      : 'Could not load this project.';
  return (
    <div
      className="h-full w-full flex items-center justify-center"
      style={{ background: 'var(--c-bg)', color: 'var(--c-ink)' }}
    >
      <div className="flex flex-col items-center gap-3 max-w-md px-6 text-center">
        <p className="text-[13px]">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium"
          style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
        >
          Retry
        </button>
      </div>
    </div>
  );
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
  // Sidebar ELEMENTS badges: one light aggregate instead of five full entity lists.
  const { data: entityCounts } = useEntityCounts();
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
      // The global "new page" action targets the built-in pages root.
      await write.mutateAsync({
        rootId: 'pages',
        path: result.path,
        body: `# ${deriveTitle(result.path)}\n\n`,
      });
      navigate({ to: '/space/$rootId/$', params: { rootId: 'pages', _splat: result.path } });
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
    <ThreadListProvider>
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
          entityCounts={entityCounts ?? {}}
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
      <NewUiViewPopover />
      <NewDesignSystemPopover />
      <TodoPopover />
      <PopoverHost />
      <PageRefPopoverHost />
      <TrustPluginsModal />
      <ModalHost />
      <GitErrorRecoveryModal />
      <ToastHost />
    </div>
    </ThreadListProvider>
  );
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
      .catch((err) => console.warn('[cwd] failed to load /api/meta', err))
      .finally(() => setLoading(false));
  }, []);
  return { cwd, loading };
}

