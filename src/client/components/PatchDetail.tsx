import { useState } from 'react';
import { SegmentedControl } from './SegmentedControl.js';
import { Link } from '@tanstack/react-router';
import { FileWarning, Settings, Check, Circle } from 'lucide-react';
import { usePatch, useCreatePatchThread, useUpdatePatchStatus } from '../hooks/usePatches.js';
import { encodeBriefPath } from '../lib/briefs-api.js';
import { useChatStore } from '../state/chat.js';
import { useArtifactThreads } from '../hooks/useArtifactThreads.js';
import { PatchEditor } from './PatchEditor.js';
import { ArtifactThreadsPanel } from './ArtifactThreadsPanel.js';

interface Props {
  patchPath: string;
}

type ViewTab = 'artifact' | 'threads';

/**
 * M23 patch detail page. Modelled on BriefDetail — two panes (artifact +
 * threads) collapsed into tabs. A patch has no version history endpoint, so
 * there is no `history` tab. The settings popover toggles the only mutable
 * frontmatter field, `status`.
 */
export function PatchDetail({ patchPath }: Props) {
  const { data: patch, isLoading } = usePatch(patchPath);
  const createThread = useCreatePatchThread(patchPath);
  // 0.1.139: the panel owns its list (generic GET /api/artifacts/patch/:path/threads)
  // instead of reading `.threads` off the detail response.
  const threadsQuery = useArtifactThreads('patch', patchPath);
  const setStatus = useUpdatePatchStatus(patchPath);
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);
  const [view, setView] = useState<ViewTab>('artifact');
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (isLoading || !patch) {
    return (
      <div className="flex-1 flex items-center justify-center px-10">
        <div className="text-[13px]" style={{ color: 'var(--c-muted)' }}>
          {isLoading ? 'Loading patch…' : 'Patch not found'}
        </div>
      </div>
    );
  }

  const fm = patch.frontmatter;
  const completed = fm.status === 'completed';
  const briefPath = typeof fm.brief === 'string' && fm.brief.length > 0 ? fm.brief : null;

  const handleNewThread = async () => {
    const result = await createThread.mutateAsync(undefined);
    setChatThreadId(result.threadId);
    setChatOpen(true);
  };

  const handleOpenThread = (threadId: string) => {
    setChatThreadId(threadId);
    setChatOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header
        className="flex items-center gap-2 px-5 py-2.5 relative"
        style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
      >
        <FileWarning size={16} style={{ color: 'var(--c-accent)' }} />
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[13px] font-semibold truncate"
            style={{ color: 'var(--c-ink)', maxWidth: 320 }}
          >
            {patch.title}
          </span>
          <Badge>{String(fm.patch_kind ?? 'patch')}</Badge>
          {completed ? (
            <span
              className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
              style={{ background: 'var(--c-green-soft)', color: 'var(--c-green)' }}
              title="Patch resolved — the spec reflects its findings."
            >
              completed
            </span>
          ) : (
            <span
              className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
              style={{ background: 'var(--c-yellow)', color: 'var(--c-yellow-ink)' }}
              title="Patch awaiting resolution."
            >
              awaiting
            </span>
          )}
        </div>
        <span className="flex-1" />
        {briefPath && (
          <Link
            to="/briefs/$path"
            params={{ path: encodeBriefPath(briefPath) }}
            className="text-[11.5px] font-mono"
            style={{ color: 'var(--c-accent)' }}
            title="Open the brief this patch belongs to"
          >
            ↗ {briefPath}
          </Link>
        )}
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'artifact', label: 'Artifact' },
            { value: 'threads', label: 'Threads' },
          ]}
        />
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          className="rounded-md p-1 btn-ghost"
          style={{ color: 'var(--c-muted)' }}
          title="Patch settings"
        >
          <Settings size={14} />
        </button>
        {settingsOpen && (
          <div
            className="absolute right-3 top-12 z-30 rounded-md min-w-[260px] p-3"
            style={{
              background: 'var(--c-card)',
              border: '1px solid var(--c-hair-strong)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
            }}
          >
            <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--c-ink)' }}>
              Patch settings
            </div>
            <button
              onClick={() => void setStatus.mutateAsync(completed ? 'awaiting' : 'completed')}
              className="w-full text-left text-[12px] px-2 py-1 rounded btn-ghost flex items-center gap-2"
              style={{ color: 'var(--c-ink)' }}
            >
              {completed ? <Circle size={12} /> : <Check size={12} />}
              {completed ? 'Mark as awaiting' : 'Mark as completed'}
            </button>
            <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--c-hair)' }}>
              <div
                className="text-[10.5px] uppercase tracking-wide mb-1"
                style={{ color: 'var(--c-subtle)' }}
              >
                Immutable
              </div>
              <div className="text-[11px] font-mono space-y-0.5" style={{ color: 'var(--c-muted)' }}>
                <div>type: {String(fm.type)}</div>
                <div>brief: {briefPath ?? '(unresolved)'}</div>
                <div>patch_kind: {String(fm.patch_kind)}</div>
                <div>created_at: {String(fm.created_at)}</div>
                <div>created_by: {String(fm.created_by)}</div>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 flex min-w-0 min-h-0">
        {view === 'artifact' && (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <PatchEditor patchPath={patchPath} />
            <footer
              className="px-5 py-2.5 flex items-center gap-2"
              style={{ borderTop: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
            >
              <div className="flex-1" />
              <button
                onClick={handleNewThread}
                disabled={createThread.isPending}
                className="text-[12.5px] px-3 py-1.5 rounded"
                style={{
                  background: 'var(--c-accent)',
                  color: '#fff',
                  opacity: createThread.isPending ? 0.6 : 1,
                }}
              >
                {createThread.isPending ? 'Starting…' : 'Run in new thread'}
              </button>
            </footer>
          </div>
        )}
        {view === 'threads' && (
          <ArtifactThreadsPanel
            title="Resolution threads"
            emptyHint='Click "New conversation" to start one with the spec author agent.'
            threads={threadsQuery.threads}
            onOpen={handleOpenThread}
            onCreate={handleNewThread}
            creating={createThread.isPending}
            loading={threadsQuery.isPending}
            hasMore={threadsQuery.hasNextPage}
            loadingMore={threadsQuery.isFetchingNextPage}
            onLoadMore={() => void threadsQuery.fetchNextPage()}
          />
        )}
      </div>
    </div>
  );
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
      style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
      title={title}
    >
      {children}
    </span>
  );
}

