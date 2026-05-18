import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { FileWarning, MessageSquare, MessageSquarePlus, Settings } from 'lucide-react';
import { usePatch, useCreatePatchThread, useUpdatePatchStatus } from '../hooks/usePatches.js';
import { encodeBriefPath } from '../lib/briefs-api.js';
import { useChatStore } from '../state/chat.js';
import { PatchEditor } from './PatchEditor.js';

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
            <Badge title="Patch resolved — the spec reflects its findings.">✅ completed</Badge>
          ) : (
            <Badge title="Patch awaiting resolution.">⏳ awaiting</Badge>
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
        <ViewTabs view={view} onChange={setView} />
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
              <span aria-hidden>{completed ? '⏳' : '✅'}</span>
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
        {view === 'artifact' && <PatchEditor patchPath={patchPath} />}
        {view === 'threads' && (
          <ThreadsPanel
            threads={patch.threads}
            onOpen={handleOpenThread}
            onCreate={handleNewThread}
            creating={createThread.isPending}
          />
        )}
      </div>
    </div>
  );
}

function ThreadsPanel({
  threads,
  onOpen,
  onCreate,
  creating,
}: {
  threads: Array<{ id: string; title: string | null; updatedAt: string; messageCount: number }>;
  onOpen(id: string): void;
  onCreate(): void;
  creating: boolean;
}) {
  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 720, padding: '24px 32px 48px' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--c-ink)' }}>
            Resolution threads
          </h3>
          <button
            onClick={onCreate}
            disabled={creating}
            className="rounded-md flex items-center gap-1 px-2 py-1 text-[11.5px]"
            style={{ background: 'var(--c-accent)', color: '#fff', opacity: creating ? 0.5 : 1 }}
          >
            <MessageSquarePlus size={11} />
            {creating ? 'Creating…' : 'Change spec according to patch'}
          </button>
        </div>
        {threads.length === 0 ? (
          <div
            className="text-center py-12 rounded-lg"
            style={{
              background: 'var(--c-card)',
              border: '1px dashed var(--c-hair-strong)',
              color: 'var(--c-subtle)',
            }}
          >
            <div className="text-[13px]">No resolution threads yet.</div>
            <div className="text-[11.5px] mt-1">
              Click "Change spec according to patch" to start one.
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onOpen(t.id)}
                  className="w-full text-left px-3 py-2 rounded-md flex items-center gap-2"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
                >
                  <MessageSquare size={12} style={{ color: 'var(--c-muted)' }} />
                  <span className="flex-1 text-[12.5px] truncate" style={{ color: 'var(--c-ink)' }}>
                    {t.title ?? '(untitled)'}
                  </span>
                  <span className="text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                    {t.messageCount} msg
                  </span>
                </button>
              </li>
            ))}
          </ul>
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

function ViewTabs({ view, onChange }: { view: ViewTab; onChange(v: ViewTab): void }) {
  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-md"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      {(['artifact', 'threads'] as ViewTab[]).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className="px-2 py-0.5 rounded text-[11.5px] font-medium capitalize"
          style={{
            background: view === v ? 'var(--c-card)' : 'transparent',
            color: view === v ? 'var(--c-ink)' : 'var(--c-muted)',
            border: view === v ? '1px solid var(--c-hair-strong)' : '1px solid transparent',
            cursor: 'pointer',
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
