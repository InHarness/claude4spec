import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { requestChatPrefill } from '../chat/chatPrefill.js';
import { useChatStore } from '../state/chat.js';
import {
  usePlan,
  usePlanLastThread,
  usePlanVersions,
  useSavePlan,
  useCreateThreadFromPlan,
  useUpdatePlanTitle,
} from '../hooks/usePlan.js';
import { useArtifactThreads } from '../hooks/useArtifactThreads.js';
import { PlanEditor } from './PlanEditor.js';
import { ComparePanel } from './ComparePanel.js';
import { ArtifactThreadsPanel } from './ArtifactThreadsPanel.js';
import { ChatToggleButton } from './ChatToggleButton.js';
import { FileVersionHistory } from './FileVersionHistory.js';
import { ButtonGroup } from './ButtonGroup.js';
import { SegmentedControl } from './SegmentedControl.js';
import { OutlineButton } from './OutlineButton.js';
import { useOutlineStore } from '../state/outline.js';
import { stem } from '../lib/artifact-path.js';

interface Props {
  planPath: string;
}

/**
 * 0.1.138: running a plan is a pure chat workflow. Both footer buttons take the
 * SAME backend path (`POST /api/plans/:slug/create-thread` → new thread with
 * `plan_path` attached) and differ only in the draft they drop into the
 * composer. Nothing is auto-sent — the user edits and sends it themselves.
 */
const RUN_PLAN_PROMPT = 'Execute the attached plan';
const ANALYSE_PLAN_PROMPT = 'Analyse the plan 3 times';

/**
 * 0.1.139: the page went multi-panel, at parity with the brief detail page —
 * artifact / threads / version history, collapsed into a switcher the same way
 * `BriefDetail` and `PatchDetail` collapse theirs. The plan↔thread relation
 * used to be a "Used by N threads" badge with a dropdown wedged into the top
 * bar; it is a real panel now.
 *
 * 0.1.127: Blame removed along with the plan_version table it was built from
 * (see brief 0-1-126-to-0-1-127) — Compare stays, backed by the generic
 * file_version log.
 */
type PlanView = 'plan' | 'threads' | 'history' | 'compare';

export function PlanPage({ planPath }: Props) {
  const { data: plan, isLoading } = usePlan(planPath);
  const savePlan = useSavePlan();
  const createThread = useCreateThreadFromPlan();
  const updateTitle = useUpdatePlanTitle();
  // 0.1.139: the generic artifact listing — one query shared with the brief and
  // patch panels, not a plan-specific projection.
  const { data: attachedThreads = [] } = useArtifactThreads('plan', planPath);
  const { data: lastThreadId = null } = usePlanLastThread(planPath);
  // currentVersion isn't part of the generic artifact detail response (no
  // stored column backs it anymore) — derive it from the version log's most
  // recent entry (listVersions sorts DESC).
  const { data: versionsData } = usePlanVersions(planPath);
  const currentVersion = versionsData?.versions[0]?.version ?? 0;
  const editor = useOutlineStore((s) => s.editor);
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);
  /** Guards against a second create-thread before `isPending` has re-rendered. */
  const runInFlightRef = useRef(false);

  const [dirtyContent, setDirtyContent] = useState<string | null>(null);
  const [view, setView] = useState<PlanView>('plan');
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Reset dirty when plan refetches to a newer version. `currentVersion`
  // comes from a query (usePlanVersions) independent of the one supplying the
  // editor's content (usePlan) — it resolves from a `0` placeholder to the
  // real version asynchronously, which could otherwise fire this effect and
  // wipe an in-progress edit the moment the user starts typing before that
  // query settles. Skip the first observed value (query settling) and only
  // clear on a genuine subsequent version change.
  const lastSeenVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (versionsData === undefined) return;
    if (lastSeenVersionRef.current !== null && lastSeenVersionRef.current !== currentVersion) {
      setDirtyContent(null);
    }
    lastSeenVersionRef.current = currentVersion;
  }, [currentVersion, versionsData]);

  const handleSave = useCallback(async () => {
    if (!plan || dirtyContent === null) return;
    try {
      await savePlan.mutateAsync({
        planPath: plan.path,
        content: dirtyContent,
        expectedHash: plan.hash,
      });
      setDirtyContent(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [plan, dirtyContent, savePlan]);

  const runWithPrompt = useCallback(
    async (prompt: string) => {
      if (!plan) return;
      // `createThread.isPending` only flips on the next render, so two clicks
      // landing in the same tick (Run plan, then Analyse plan) would each POST
      // create-thread and leave one of the two new threads orphaned. The ref
      // closes that window.
      if (runInFlightRef.current) return;
      runInFlightRef.current = true;
      try {
        // Always a NEW thread with the plan attached (plan_path reference — the
        // plan body is never copied into the thread). Query invalidation is
        // handled by useCreateThreadFromPlan.
        const { threadId } = await createThread.mutateAsync({ planPath: plan.path });
        setError(null);
        setChatThreadId(threadId);
        setChatOpen(true);
        // The draft is editable and NOT sent — ChatOverlay holds the prompt
        // across the thread switch above (see its pendingPrefillRef).
        requestChatPrefill({ prompt, autoSend: false });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        runInFlightRef.current = false;
      }
    },
    [plan, createThread, setChatThreadId, setChatOpen],
  );

  const handleStartEditTitle = useCallback(() => {
    if (!plan) return;
    setTitleDraft(plan.frontmatter.title);
    setEditingTitle(true);
  }, [plan]);

  const handleSaveTitle = useCallback(async () => {
    if (!plan) return;
    const next = titleDraft.trim();
    if (!next || next === plan.frontmatter.title) {
      setEditingTitle(false);
      return;
    }
    try {
      await updateTitle.mutateAsync({ planPath: plan.path, title: next });
      setEditingTitle(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [plan, titleDraft, updateTitle]);

  const handleOpenThread = useCallback(
    (threadId: string) => {
      setChatThreadId(threadId);
      setChatOpen(true);
    },
    [setChatThreadId, setChatOpen],
  );

  /** Threads panel's "New conversation" — same attach path as Run/Analyse, no draft. */
  const handleNewThread = useCallback(async () => {
    if (!plan) return;
    try {
      const { threadId } = await createThread.mutateAsync({ planPath: plan.path });
      setError(null);
      handleOpenThread(threadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [plan, createThread, handleOpenThread]);

  if (isLoading || !plan) {
    return (
      <div className="flex-1 flex items-center justify-center px-10">
        <div className="text-[13px]" style={{ color: 'var(--c-muted)' }}>
          {isLoading ? 'Loading plan…' : 'Plan not found'}
        </div>
      </div>
    );
  }

  const isDirty = dirtyContent !== null && dirtyContent !== plan.body;
  const displayContent = dirtyContent ?? plan.body;
  const canExecute = plan.body.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header
        className="flex items-center gap-2 px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {editingTitle ? (
            <input
              type="text"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSaveTitle();
                } else if (e.key === 'Escape') {
                  setEditingTitle(false);
                }
              }}
              placeholder={plan.path}
              className="text-[13px] font-semibold bg-transparent outline-none"
              style={{
                color: 'var(--c-ink)',
                borderBottom: '1px solid var(--c-accent)',
                minWidth: 220,
              }}
            />
          ) : (
            <button
              onClick={handleStartEditTitle}
              className="text-[13px] font-semibold btn-ghost rounded px-1 py-0.5 inline-flex items-center gap-1.5"
              style={{ color: 'var(--c-ink)' }}
              title="Click to rename plan"
            >
              <span className="truncate" style={{ maxWidth: 360 }}>
                {/* A plan written by an agent can land without a title — fall back
                    to the filename rather than rendering an empty header. */}
                {plan.frontmatter.title || stem(plan.path)}
              </span>
              <Pencil size={10} style={{ color: 'var(--c-subtle)' }} />
            </button>
          )}
          <span
            className="font-mono text-[11px] px-1.5 py-0.5 rounded"
            style={{
              background: 'var(--c-hair)',
              color: 'var(--c-muted)',
            }}
          >
            Plan v{currentVersion}
          </span>
        </div>
        <span className="flex-1" />
        <ChatToggleButton />
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'plan', label: 'Plan' },
            { value: 'threads', label: 'Threads' },
            { value: 'history', label: 'History' },
            { value: 'compare', label: 'Compare' },
          ]}
        />
        {editor && (
          <ButtonGroup>
            <OutlineButton />
          </ButtonGroup>
        )}
      </header>

      {error ? (
        <div
          className="px-5 py-2 text-[12px]"
          style={{
            background: 'rgba(179, 58, 58, 0.08)',
            color: '#b33a3a',
            borderBottom: '1px solid var(--c-hair)',
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex-1 flex min-w-0 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {view === 'plan' ? (
            <>
              <PlanEditor
                content={displayContent}
                onChange={(md, dirty) => setDirtyContent(dirty ? md : null)}
                currentPage={`/plans/${plan.path}`}
              />
              {(isDirty || canExecute) && (
                <footer
                  className="px-5 py-2.5 flex items-center gap-2"
                  style={{ borderTop: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
                >
                  {isDirty ? (
                    <button
                      onClick={handleSave}
                      disabled={savePlan.isPending}
                      className="text-[12.5px] px-3 py-1.5 rounded"
                      style={{
                        background: 'var(--c-accent)',
                        color: '#fff',
                        opacity: savePlan.isPending ? 0.6 : 1,
                      }}
                    >
                      {savePlan.isPending ? 'Saving…' : 'Save'}
                    </button>
                  ) : null}
                  {isDirty ? (
                    <button
                      onClick={() => setDirtyContent(null)}
                      disabled={savePlan.isPending}
                      className="text-[12.5px] px-2.5 py-1 rounded btn-ghost"
                      style={{ color: 'var(--c-muted)' }}
                    >
                      Discard
                    </button>
                  ) : null}
                  <div className="flex-1" />
                  {canExecute ? (
                    <>
                      <button
                        onClick={() => void runWithPrompt(RUN_PLAN_PROMPT)}
                        disabled={createThread.isPending}
                        title="Open a new thread with this plan attached and draft the run prompt"
                        className="text-[12.5px] px-3 py-1.5 rounded"
                        style={{
                          background: 'var(--c-accent)',
                          color: '#fff',
                          opacity: createThread.isPending ? 0.6 : 1,
                        }}
                      >
                        Run plan
                      </button>
                      <button
                        onClick={() => void runWithPrompt(ANALYSE_PLAN_PROMPT)}
                        disabled={createThread.isPending}
                        title="Open a new thread with this plan attached and draft the analysis prompt"
                        className="text-[12.5px] px-3 py-1.5 rounded"
                        style={{
                          background: 'var(--c-card)',
                          border: '1px solid var(--c-hair-strong)',
                          color: 'var(--c-ink)',
                          opacity: createThread.isPending ? 0.6 : 1,
                        }}
                      >
                        Analyse plan
                      </button>
                    </>
                  ) : null}
                </footer>
              )}
            </>
          ) : view === 'threads' ? (
            <ArtifactThreadsPanel
              title="Attached threads"
              emptyHint='Click "New conversation" to start one with this plan attached.'
              threads={attachedThreads}
              onOpen={handleOpenThread}
              onCreate={() => void handleNewThread()}
              creating={createThread.isPending}
              lastThreadId={lastThreadId}
            />
          ) : view === 'history' ? (
            <FileVersionHistory kind="plan" path={plan.path} />
          ) : (
            <ComparePanel planPath={plan.path} currentVersion={currentVersion} />
          )}
        </div>
      </div>

    </div>
  );
}
