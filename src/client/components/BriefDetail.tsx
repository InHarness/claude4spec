import { useState } from 'react';
import { SegmentedControl } from './SegmentedControl.js';
import { Link } from '@tanstack/react-router';
import { FileText, MessageSquare, MessageSquarePlus, Settings, Check, Circle, ChevronRight } from 'lucide-react';
import {
  useBrief,
  useCreateBriefThread,
  useSetBriefImplemented,
} from '../hooks/useBriefs.js';
import { useChatStore } from '../state/chat.js';
import { BriefEditor } from './BriefEditor.js';
import { BriefVersionHistory } from './BriefVersionHistory.js';

interface Props {
  briefPath: string;
}

type ViewTab = 'artifact' | 'threads' | 'history';

/**
 * M21 brief detail page. Three-pane layout zwiniety w taby (mniejszy ekran-real-estate
 * niz Plans, brief jest mocno read+chat, threads sa bardziej peryferyjne).
 *
 * Header pokazuje from→to badges + status (implemented/pending) w tinted bg.
 * Settings popover edytuje wyłącznie `implemented` (toggle); reszta frontmatter
 * to immutable badges read-only.
 */
export function BriefDetail({ briefPath }: Props) {
  const { data: brief, isLoading } = useBrief(briefPath);
  const setImplementedMutation = useSetBriefImplemented(briefPath);
  const createThread = useCreateBriefThread(briefPath);
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);
  const [view, setView] = useState<ViewTab>('artifact');
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (isLoading || !brief) {
    return (
      <div className="flex-1 flex items-center justify-center px-10">
        <div className="text-[13px]" style={{ color: 'var(--c-muted)' }}>
          {isLoading ? 'Loading brief…' : 'Brief not found'}
        </div>
      </div>
    );
  }

  const fm = brief.frontmatter;

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
        <FileText size={16} style={{ color: 'var(--c-accent)' }} />
        <div className="flex items-center gap-1.5 min-w-0 text-[12px]" style={{ color: 'var(--c-muted)' }}>
          <Link
            to="/briefs"
            className="inline-flex items-center rounded px-1 -mx-1 transition"
            style={{ color: 'var(--c-muted)' }}
          >
            Briefs
          </Link>
          <ChevronRight size={11} />
          <span
            className="font-mono truncate"
            style={{ color: 'var(--c-ink)', fontWeight: 600, maxWidth: 320 }}
          >
            {briefPath}
          </span>
          {fm.from_release === null ? (
            <Badge initial>initial</Badge>
          ) : (
            <Badge accent>{fm.from_release}</Badge>
          )}
          <span style={{ color: 'var(--c-subtle)', fontSize: 11 }}>→</span>
          <Badge accent>{fm.to_release}</Badge>
          {fm.implemented ? (
            <span
              className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
              style={{ background: 'var(--c-green-soft)', color: 'var(--c-green)' }}
              title="Brief implemented (declared by implementer-agent or user)"
            >
              implemented
            </span>
          ) : (
            <span
              className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
              style={{ background: 'var(--c-yellow)', color: 'var(--c-yellow-ink)' }}
              title="Brief pending — not yet implemented"
            >
              pending
            </span>
          )}
        </div>
        <span className="flex-1" />
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'artifact', label: 'Artifact' },
            { value: 'threads', label: 'Threads' },
            { value: 'history', label: 'History' },
          ]}
        />
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          className="rounded-md p-1 btn-ghost"
          style={{ color: 'var(--c-muted)' }}
          title="Brief settings"
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
              Brief settings
            </div>
            <div className="space-y-2">
              <button
                onClick={() => void setImplementedMutation.mutateAsync(!fm.implemented)}
                className="w-full text-left text-[12px] px-2 py-1 rounded btn-ghost flex items-center gap-2"
                style={{ color: 'var(--c-ink)' }}
                title="Toggle the public 'implemented' declaration. Set true when the brief has been realized in the target repo (committed, tested, accepted)."
              >
                {fm.implemented ? <Circle size={12} /> : <Check size={12} />}
                {fm.implemented ? 'Mark as pending' : 'Mark as implemented'}
              </button>
            </div>
            <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--c-hair)' }}>
              <div className="text-[10.5px] uppercase tracking-wide mb-1" style={{ color: 'var(--c-subtle)' }}>
                Immutable
              </div>
              <div className="text-[11px] font-mono space-y-0.5" style={{ color: 'var(--c-muted)' }}>
                <div>type: {String(fm.type)}</div>
                <div>from_release: {fm.from_release ?? '(initial)'}</div>
                <div>to_release: {String(fm.to_release)}</div>
                <div>generated_at: {String(fm.generated_at)}</div>
                <div>generator_version: {String(fm.generator_version)}</div>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 flex min-w-0 min-h-0">
        {view === 'artifact' && (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <BriefEditor briefPath={briefPath} />
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
          <ThreadsPanel
            threads={brief.threads}
            onOpen={handleOpenThread}
            onCreate={handleNewThread}
            creating={createThread.isPending}
          />
        )}
        {view === 'history' && (
          <div className="flex-1 overflow-auto">
            <BriefVersionHistory briefPath={briefPath} />
          </div>
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
            Editorial threads
          </h3>
          <button
            onClick={onCreate}
            disabled={creating}
            className="rounded-md flex items-center gap-1 px-2 py-1 text-[11.5px]"
            style={{ background: 'var(--c-accent)', color: '#fff', opacity: creating ? 0.5 : 1 }}
          >
            <MessageSquarePlus size={11} />
            {creating ? 'Creating…' : 'New conversation'}
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
            <div className="text-[13px]">No editorial threads yet.</div>
            <div className="text-[11.5px] mt-1">Click "New conversation" to start one with the brief author agent.</div>
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

function Badge({
  children,
  accent,
  initial,
  title,
}: {
  children: React.ReactNode;
  accent?: boolean;
  initial?: boolean;
  title?: string;
}) {
  if (initial) {
    return (
      <span
        className="font-mono text-[10.5px] uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center"
        style={{
          background: 'transparent',
          color: 'var(--c-muted)',
          border: '1px dashed var(--c-hair-strong)',
        }}
        title={title ?? 'Initial brief — no previous release; comparing against an empty baseline.'}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
      style={{
        background: accent ? 'var(--c-accent)' : 'var(--c-hair)',
        color: accent ? '#fff' : 'var(--c-muted)',
      }}
      title={title}
    >
      {children}
    </span>
  );
}

