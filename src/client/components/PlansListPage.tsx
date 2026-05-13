import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ClipboardList, MessageSquare, MessageSquarePlus, Search } from 'lucide-react';
import { useChatStore } from '../state/chat.js';
import { useCreateThreadFromPlan, usePlans } from '../hooks/usePlan.js';

export function PlansListPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = usePlans({ search: search.trim() || undefined });
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);
  const createThread = useCreateThreadFromPlan();

  const plans = data?.plans ?? [];

  const handleCreateThread = (planId: number) => {
    createThread.mutate(
      { planId },
      {
        onSuccess: ({ threadId }) => {
          setChatThreadId(threadId);
          setChatOpen(true);
        },
      },
    );
  };

  const handleOpenLastThread = (threadId: string) => {
    setChatThreadId(threadId);
    setChatOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <ClipboardList size={18} style={{ color: 'var(--c-accent)' }} />
        <h2
          className="text-[18px] font-semibold tracking-tight"
          style={{ color: 'var(--c-ink)' }}
        >
          Plans
        </h2>
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {plans.length} {plans.length === 1 ? 'plan' : 'plans'}
        </span>
        <span className="flex-1" />
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-md"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
        >
          <Search size={12} style={{ color: 'var(--c-subtle)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plans..."
            className="bg-transparent outline-none text-[12.5px] w-48"
            style={{ color: 'var(--c-ink)' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 900, padding: '24px 32px 48px' }}>
          {isLoading && (
            <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
              Loading…
            </div>
          )}
          {!isLoading && plans.length === 0 && (
            <div
              className="text-center py-20 rounded-lg"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              <div className="text-[14px]">No plans yet.</div>
              <div className="text-[12px] mt-1">
                Plans are created automatically when an agent calls{' '}
                <code style={{ color: 'var(--c-accent)' }}>update_plan</code> in a thread.
              </div>
            </div>
          )}
          <div className="space-y-2">
            {plans.map((p) => {
              const title = p.title ?? `Plan #${p.id}`;
              const isShared = p.threadCount > 1;
              return (
                <div
                  key={p.id}
                  className="flex items-start gap-3 px-4 py-3 rounded-md"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
                >
                  <ClipboardList
                    size={14}
                    style={{ color: 'var(--c-accent)', marginTop: 3 }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <Link
                        to="/plans/$planId"
                        params={{ planId: String(p.id) }}
                        className="text-[14px] font-semibold"
                        style={{ color: 'var(--c-ink)' }}
                      >
                        {title}
                      </Link>
                      <span
                        className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                        style={{
                          background: 'var(--c-hair)',
                          color: 'var(--c-muted)',
                        }}
                      >
                        v{p.currentVersion}
                      </span>
                      <span
                        className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                        style={{
                          background: isShared ? 'var(--c-accent)' : 'transparent',
                          color: isShared ? '#fff' : 'var(--c-subtle)',
                          border: isShared ? 'none' : '1px solid var(--c-hair)',
                        }}
                        title={
                          isShared
                            ? `Plan referenced by ${p.threadCount} threads`
                            : 'Single thread'
                        }
                      >
                        {p.threadCount === 0
                          ? 'orphan'
                          : `${p.threadCount} ${p.threadCount === 1 ? 'thread' : 'threads'}`}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: 'var(--c-subtle)' }}
                      >
                        updated {formatRelative(p.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleCreateThread(p.id)}
                      disabled={createThread.isPending}
                      className="rounded-md flex items-center gap-1 px-2 py-1 text-[11.5px]"
                      style={{
                        background: 'var(--c-accent)',
                        color: '#fff',
                        opacity: createThread.isPending ? 0.5 : 1,
                      }}
                      title="Create new thread referencing this plan"
                    >
                      <MessageSquarePlus size={11} />
                      New thread
                    </button>
                    <button
                      onClick={() =>
                        p.lastThreadId && handleOpenLastThread(p.lastThreadId)
                      }
                      disabled={p.lastThreadId === null}
                      className="rounded-md flex items-center gap-1 px-2 py-1 text-[11.5px]"
                      style={{
                        background: 'transparent',
                        color: p.lastThreadId
                          ? 'var(--c-ink)'
                          : 'var(--c-subtle)',
                        border: '1px solid var(--c-hair)',
                        cursor: p.lastThreadId ? 'pointer' : 'not-allowed',
                      }}
                      title={
                        p.lastThreadId
                          ? 'Open most recently active thread for this plan'
                          : 'No threads attached to this plan'
                      }
                    >
                      <MessageSquare size={11} />
                      Last thread
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const ts = new Date(iso.replace(' ', 'T') + 'Z').getTime();
    const diff = Date.now() - ts;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(ts).toLocaleDateString();
  } catch {
    return iso;
  }
}
