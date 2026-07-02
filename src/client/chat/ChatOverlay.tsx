import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { apiFetch } from '../lib/api-core.js';
import { useMatches, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Send, Square, X, Plus, MessageSquare, ChevronDown, FileText, FileWarning, Cpu, Trash2, ClipboardList, Clock, Loader2 } from 'lucide-react';
import { batchToolBlocks } from '@inharness-ai/agent-chat';
import { useChatStore, thinkingToConfig, configToThinking, isAdaptiveModel, isChatModel, type ChatModel, type ChatThinking } from '../state/chat.js';
import { usePersistedState, projectKey } from '../state/persisted.js';
import { ResizeHandle } from '../components/ResizeHandle.js';
import { useChat } from './useChat.js';
import { useThreadListContext } from './ThreadListContext.js';
import { BlockRenderer, QueuedMessageBubble } from './BlockRenderer.js';
import { TransagentPanel } from './TransagentPanel.js';
import { AnnotationPanel } from './AnnotationPanel.js';
import { CurrentTodoList } from './CurrentTodoList.js';
import { UsageBadge } from './UsageBadge.js';
import { UserInputRequestCard } from './UserInputRequestCard.js';
import { ChatInputEditor, type ChatInputEditorHandle } from './ChatInputEditor.js';
import { SystemPromptView } from './SystemPromptView.js';
import { confirmDestructive } from '../ui/events.js';
import { CHAT_PREFILL_EVENT, type ChatPrefillDetail } from './chatPrefill.js';
import { usePlan } from '../hooks/usePlan.js';
import { useBrief } from '../hooks/useBriefs.js';
import { usePatch } from '../hooks/usePatches.js';
import { encodeBriefPath } from '../lib/briefs-api.js';
import { encodePatchPath } from '../lib/patches-api.js';
import { chatConfigApi, type SessionResumeConstraint } from '../lib/api.js';

const NEW_THREAD_DRAFT_KEY = '__new__';

export function ChatOverlay() {
  const chatOpen = useChatStore((s) => s.chatOpen);
  const chatWidth = useChatStore((s) => s.chatWidth);
  const chatThreadId = useChatStore((s) => s.chatThreadId);
  const annotations = useChatStore((s) => s.annotations);
  const model = useChatStore((s) => s.model);
  const thinking = useChatStore((s) => s.thinking);
  const setChatOpen = useChatStore((s) => s.setChatOpen);
  const setChatWidth = useChatStore((s) => s.setChatWidth);
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setModel = useChatStore((s) => s.setModel);
  const setThinking = useChatStore((s) => s.setThinking);
  const clearAnnotations = useChatStore((s) => s.clearAnnotations);

  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputEditorHandle>(null);
  const stickToBottomRef = useRef(true); // start: przyklejony do dołu

  const [hasInput, setHasInput] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [systemPromptViewOpen, setSystemPromptViewOpen] = useState(false);
  const [systemPromptCache, setSystemPromptCache] = useState<Record<string, string | null>>({});
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);

  const [drafts, setDrafts] = usePersistedState<Record<string, string>>(
    projectKey('c4s:m05:chat-drafts'),
    {},
    1,
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const draftSaveTimer = useRef<number | null>(null);

  const routerPage = useCurrentPage();
  // Dismiss key is composite (`rootId::path`) so detaching a page in one root does
  // not also detach a same-named page in another.
  const routerPageKey = routerPage ? `${routerPage.rootId}::${routerPage.path}` : null;
  const [dismissedPageKey, setDismissedPageKey] = useState<string | null>(null);
  const activePage = routerPageKey && routerPageKey !== dismissedPageKey ? routerPage : null;
  // Path string drives the chip + "Page attached" label; rootId rides along to send.
  const currentPage = activePage?.path ?? null;
  const currentPageRootId = activePage?.rootId ?? null;

  const onThreadCreated = useCallback(
    (id: string) => {
      setChatThreadId(id);
    },
    [setChatThreadId],
  );

  const onThreadMissing = useCallback(() => {
    setChatThreadId(null);
  }, [setChatThreadId]);

  // M05 (D4): when the queue is cleared (Stop/abort/clear), restore the texts
  // into the composer. `@path.md` mentions re-parse via PageRefNode input rules.
  const handleQueueCleared = useCallback((texts: string[]) => {
    const handle = inputRef.current;
    if (!handle) return;
    const existing = handle.getMarkdown().trim();
    const restored = [...texts, existing].filter(Boolean).join('\n\n');
    handle.setMarkdown(restored);
    setHasInput(!handle.isEmpty());
  }, []);

  const {
    messages,
    isStreaming,
    isResuming,
    sendMessage,
    abort,
    usage,
    contextSize,
    pendingUserInputs,
    submitUserInput,
    currentTodoItems,
    userPlanModes,
    userAnnotations,
    queuedMessages,
    queueMessage,
    cancelQueued,
    clearQueue,
    transagents,
    activeThreadMeta,
  } = useChat({
    threadId: chatThreadId,
    onThreadCreated,
    onThreadMissing,
    model,
    thinking,
    planMode,
    onQueueCleared: handleQueueCleared,
  });

  // `isBusy` = aktywna tura w tym watku (lokalna lub server-side, do ktorej jestesmy podlaczeni
  // przez resume SSE). Steruje widocznoscia „streaming…" badge, Stop buttona i disabled inputu.
  const isBusy = isStreaming || isResuming;

  const threadList = useThreadListContext();
  // Prefer the thread from the (paginated) list when it's loaded — it stays reactive to
  // renames — but fall back to the meta fetched by GET /api/threads/:id so the header and
  // model-lock controls work for active threads beyond page 1 (which aren't in the list).
  const activeThread =
    threadList.threads.find((t) => t.id === chatThreadId) ??
    (activeThreadMeta?.id === chatThreadId ? activeThreadMeta : null);
  // M05 session-lock: which fields freeze once a thread has a session. Declared by the
  // adapter package, served via GET /api/chat/config (not hardcoded in the UI).
  const { data: chatConfig } = useQuery({ queryKey: ['chat-config'], queryFn: () => chatConfigApi.get() });
  const resumeConstraints = chatConfig?.sessionResumeConstraints ?? [];
  // M21: dla brief context naglowek pokazuje "Brief: <filename>" zamiast title.
  // Pozwala na szybka identyfikacje ze rozmowa ma whitelisted toolset (brief-tools).
  const activeTitle = activeThread?.contextType === 'brief' && activeThread.briefPath
    ? `Brief: ${activeThread.briefPath.replace(/\.md$/, '')}`
    : activeThread?.title ?? 'New conversation';
  const { data: activePlan } = usePlan(activeThread?.planId ?? null);
  const { data: activeBrief } = useBrief(
    activeThread?.contextType === 'brief' ? activeThread.briefPath : null,
  );
  const { data: activePatch } = usePatch(
    activeThread?.contextType === 'patch' ? activeThread.patchPath : null,
  );

  useEffect(() => {
    setPlanMode(activeThread?.planMode ?? false);
  }, [activeThread?.id, activeThread?.planMode]);

  // M05 0.1.61: a session-locked thread shows ITS OWN turn-1 config, not the global store's
  // leftover from another thread. Mirrors the planMode restore above. Fresh threads (no
  // snapshot) are left alone, so they inherit the current global choice. setModel runs first
  // so its max→high clamp can't override the snapshot-derived thinking level.
  useEffect(() => {
    const snap = activeThread?.initialArchitectureConfig;
    if (activeThread?.lastSessionId != null && snap) {
      if (isChatModel(snap.model)) setModel(snap.model);
      setThinking(configToThinking(snap.architectureConfig));
    }
  }, [activeThread?.id, activeThread?.lastSessionId, activeThread?.initialArchitectureConfig, setModel, setThinking]);

  // Reset trybu podgladu i cache przy switchu watku — snapshot jest per-thread,
  // wiec po zmianie threadId stary cache jest niewazny i toggle musi sie zamknac.
  // useThreadList trzyma local useState (nie React Query) — gdy ktos z zewnatrz
  // (np. PlansListPage → /create-thread) zmieni chatThreadId na nowo utworzony watek,
  // nasza kopia listy nie wie o nim. Refresh wyciaga swieze dane z /api/threads,
  // co odblokowuje render naglowka (title, plan icon).
  const refreshThreads = threadList.refresh;
  useEffect(() => {
    setSystemPromptViewOpen(false);
    setSystemPromptCache({});
    setSystemPromptLoading(false);
    if (chatThreadId) void refreshThreads();
  }, [chatThreadId, refreshThreads]);

  // Restore draft wpisanego promptu z localStorage przy zmianie watku.
  // Klucz `__new__` dla `chatThreadId === null`. Anulujemy in-flight save z poprzedniego watku,
  // zeby nie zapisac jego markdown'a pod nowym kluczem.
  // Defer setMarkdown przez setTimeout — editor Tiptap inicjalizuje sie async, na pierwszym
  // render handle ma metody no-op (analogicznie do CHAT_PREFILL_EVENT powyzej).
  useEffect(() => {
    if (draftSaveTimer.current) {
      window.clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    const key = chatThreadId ?? NEW_THREAD_DRAFT_KEY;
    const draft = draftsRef.current[key] ?? '';
    const t = window.setTimeout(() => {
      const handle = inputRef.current;
      if (!handle) return;
      // One-shot seed (np. „Run new thread" na patchu) ma pierwszenstwo nad
      // draftem/clear. Czytamy swiezo ze store (nie z closure), konsumujemy raz.
      const seed = useChatStore.getState().seedPrompt;
      if (seed) {
        handle.setMarkdown(seed);
        setHasInput(!handle.isEmpty());
        useChatStore.getState().setSeedPrompt(null);
      } else if (draft) {
        handle.setMarkdown(draft);
        setHasInput(!handle.isEmpty());
      } else {
        handle.clear();
        setHasInput(false);
      }
    }, 50);
    return () => window.clearTimeout(t);
    // celowo bez `drafts` w deps — restore tylko przy zmianie watku
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatThreadId]);

  useEffect(
    () => () => {
      if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current);
    },
    [],
  );

  const handleToggleSystemPrompt = useCallback(async () => {
    if (!chatThreadId || !activeThread?.hasSystemPrompt) return;
    const willOpen = !systemPromptViewOpen;
    setSystemPromptViewOpen(willOpen);
    if (willOpen && !(chatThreadId in systemPromptCache)) {
      setSystemPromptLoading(true);
      try {
        const res = await apiFetch(`/api/threads/${chatThreadId}/system-prompt`);
        if (!res.ok) return;
        const payload = (await res.json()) as { data: { initialSystemPrompt: string | null } };
        setSystemPromptCache((prev) => ({
          ...prev,
          [chatThreadId]: payload.data.initialSystemPrompt,
        }));
      } catch {
        // pozostawiam cache pusty — kolejne otwarcie zrobi retry
      } finally {
        setSystemPromptLoading(false);
      }
    }
  }, [chatThreadId, activeThread?.hasSystemPrompt, systemPromptViewOpen, systemPromptCache]);

  const togglePlanMode = useCallback(
    async (next: boolean) => {
      setPlanMode(next);
      if (!chatThreadId) return;
      try {
        await apiFetch(`/api/threads/${chatThreadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planMode: next }),
        });
        await threadList.refresh();
      } catch {
        // best-effort; next send will carry planMode in body and server reconciles.
      }
    },
    [chatThreadId, threadList],
  );

  const displayMessages = useMemo(
    () => messages.map((msg) => ({ ...msg, blocks: batchToolBlocks(msg.blocks) })),
    [messages],
  );

  const showStreamingBubble = isBusy;

  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayMessages, isBusy, pendingUserInputs.length]);

  // Idempotency-ref do auto-send: czytamy aktualną liczbę wiadomości w listenerze
  // bez re-rejestracji eventu przy każdej zmianie messages.
  const messageCountRef = useRef(messages.length);
  useEffect(() => {
    messageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<ChatPrefillDetail>).detail;
      if (!detail?.prompt) return;
      setChatOpen(true);
      // Defer so the editor has mounted before we try to populate it.
      setTimeout(() => {
        const handle = inputRef.current;
        if (!handle) return;
        handle.setMarkdown(detail.prompt);
        setHasInput(!handle.isEmpty());
        // Auto-send: pierwsza wiadomość w świeżym threadzie (np. initial-thread
        // po POST /api/briefs). Reload strony nie zdubluje wysyłki, bo thread
        // ma już wtedy messages.length > 0.
        if (detail.autoSend && messageCountRef.current === 0) {
          handle.clear();
          setHasInput(false);
          void sendMessage(detail.prompt, [], currentPage, currentPageRootId);
        }
      }, 50);
    };
    window.addEventListener(CHAT_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(CHAT_PREFILL_EVENT, onPrefill);
  }, [setChatOpen, sendMessage, currentPage, currentPageRootId]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  const handleSend = useCallback(async () => {
    const handle = inputRef.current;
    const text = handle?.getMarkdown().trim() ?? '';

    // Wyczysc draft dla biezacego watku — robimy to PRZED sendMessage, bo `onThreadCreated`
    // moze przelaczyc `chatThreadId` zanim handler wroci, a chcemy zlapac stary klucz.
    const clearDraft = () => {
      if (draftSaveTimer.current) {
        window.clearTimeout(draftSaveTimer.current);
        draftSaveTimer.current = null;
      }
      const draftKey = chatThreadId ?? NEW_THREAD_DRAFT_KEY;
      const currentDrafts = draftsRef.current;
      if (draftKey in currentDrafts) {
        const next = { ...currentDrafts };
        delete next[draftKey];
        setDrafts(next);
      }
    };

    // M05: during a live turn the composer stays unlocked; Send/↵ enqueues the
    // message (mid-turn push or after-turn merged dispatch) instead of starting
    // a new stream. Annotations are for fresh turns only.
    if (isBusy) {
      if (!text) return;
      const ok = await queueMessage(text);
      if (ok) {
        handle?.clear();
        setHasInput(false);
        clearDraft();
      }
      return;
    }

    if (!text && annotations.length === 0) return;
    const annotationsSnapshot = annotations;
    handle?.clear();
    setHasInput(false);
    clearAnnotations();
    setSystemPromptViewOpen(false);
    clearDraft();
    await sendMessage(text, annotationsSnapshot, currentPage, currentPageRootId);
    await threadList.refresh();
  }, [sendMessage, annotations, currentPage, currentPageRootId, clearAnnotations, threadList, chatThreadId, setDrafts, isBusy, queueMessage]);

  const handleCreateThread = useCallback(async () => {
    const t = await threadList.createThread();
    if (t) setChatThreadId(t.id);
    setThreadsOpen(false);
  }, [threadList, setChatThreadId]);

  const onResizeDrag = useCallback(
    (x: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setChatWidth(rect.right - x);
    },
    [setChatWidth],
  );

  const MODEL_LABELS: Record<ChatModel, string> = {
    'fable-5': 'Fable 5',
    'sonnet-4.6': 'Sonnet 4.6',
    'opus-4.8': 'Opus 4.8',
    'haiku-4.5': 'Haiku 4.5',
  };
  const modelLabel = MODEL_LABELS[model];

  if (!chatOpen) return null;

  return (
    <div
      ref={rootRef}
      className="h-full flex"
      style={{ width: chatWidth, flexShrink: 0 }}
    >
      <ResizeHandle onDrag={onResizeDrag} />
      <aside
        className="flex-1 flex flex-col min-w-0 min-h-0 relative"
        style={{ background: 'var(--c-bg)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-1 px-2.5 py-2 relative"
          style={{ borderBottom: '1px solid var(--c-hair)' }}
        >
          <button
            onClick={() => setThreadsOpen((o) => !o)}
            className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-md text-left min-w-0 btn-ghost"
            title="Switch thread"
          >
            <MessageSquare size={12} />
            <span className="text-[12.5px] font-medium truncate flex-1" style={{ color: 'var(--c-ink)' }}>
              {activeTitle}
            </span>
            <ChevronDown size={11} />
          </button>
          <UsageBadge
            usage={usage}
            contextSize={contextSize}
            model={model}
            architectureConfig={thinkingToConfig(thinking, model)}
          />
          <button
            onClick={() => void handleToggleSystemPrompt()}
            disabled={!activeThread?.hasSystemPrompt}
            aria-pressed={systemPromptViewOpen}
            className="h-7 w-7 rounded-md inline-flex items-center justify-center btn-ghost"
            style={{
              color: systemPromptViewOpen ? 'var(--c-ink)' : 'var(--c-muted)',
              background: systemPromptViewOpen ? 'var(--c-accent-soft)' : 'transparent',
              opacity: activeThread?.hasSystemPrompt ? 1 : 0.4,
              cursor: activeThread?.hasSystemPrompt ? 'pointer' : 'not-allowed',
            }}
            title={
              activeThread?.hasSystemPrompt
                ? 'Show system prompt'
                : 'System prompt will be rendered after the first message'
            }
          >
            <FileText size={14} />
          </button>
          <IconBtn icon={Plus} title="New conversation" onClick={handleCreateThread} />
          <IconBtn icon={X} title="Close chat" onClick={() => setChatOpen(false)} />
          {threadsOpen && (
            <ThreadDropdown
              threads={threadList.threads}
              activeId={chatThreadId}
              hasMore={threadList.hasMore}
              loadingMore={threadList.loadingMore}
              onSelect={(id) => {
                setChatThreadId(id);
                setThreadsOpen(false);
              }}
              onCreate={handleCreateThread}
              onDelete={async (id) => {
                await threadList.deleteThread(id);
                if (id === chatThreadId) setChatThreadId(null);
              }}
              onLoadMore={threadList.loadMore}
              onClose={() => setThreadsOpen(false)}
            />
          )}
        </div>

        {/* Message list — swap z <SystemPromptView /> gdy toggle aktywny */}
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className={`flex-1 overflow-auto nice-scroll ${systemPromptViewOpen ? '' : 'px-3 py-3'}`}
        >
          {systemPromptViewOpen ? (
            <SystemPromptView
              prompt={chatThreadId ? systemPromptCache[chatThreadId] : undefined}
              loading={systemPromptLoading}
            />
          ) : (
            <>
              {messages.length === 0 && !isBusy && (
                <div className="text-[13px] py-6" style={{ color: 'var(--c-muted)' }}>
                  Start a conversation. Try "Add endpoint GET /users returning UserResponse".
                </div>
              )}
              {(() => {
                let userIdx = 0;
                return displayMessages.map((msg) => {
                  const isUser = msg.role === 'user';
                  const thisIdx = isUser ? userIdx++ : -1;
                  const msgPlanMode = isUser ? userPlanModes[thisIdx] ?? false : false;
                  const msgAnnotations = isUser ? userAnnotations[thisIdx] : undefined;
                  return (
                    <div key={msg.id}>
                      {msg.blocks.map((block, i) => (
                        <BlockRenderer
                          key={i}
                          block={block}
                          siblings={msg.blocks}
                          side={msg.role}
                          annotations={msgAnnotations}
                          planMode={msgPlanMode}
                        />
                      ))}
                    </div>
                  );
                });
              })()}
              {/* 0.1.69 Transagents: nested child panels (live-join or persisted). */}
              {transagents.map((t) => (
                <TransagentPanel key={t.toolUseId} entry={t} model={model} />
              ))}
              {showStreamingBubble && (
                <div className="msg-enter mb-3 flex">
                  <div
                    className="inline-flex items-center gap-1.5 py-1 text-[10.5px] font-mono"
                    style={{ color: 'var(--c-muted)' }}
                    aria-live="polite"
                    aria-label="Agent is streaming"
                  >
                    <span className="dot-pulse">
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                    <span className="uppercase tracking-wider">streaming</span>
                  </div>
                </div>
              )}
              {/* Pending user_input_request cards — inline in the scrollable stream */}
              {pendingUserInputs.map((req) => (
                <UserInputRequestCard key={req.requestId} request={req} onSubmit={submitUserInput} />
              ))}
              {/* M05: queued messages as grey "ghost" bubbles — pending delivery
                  (mid-turn push or after-turn merge). Distinct from sent (solid) bubbles. */}
              {queuedMessages.map((q) => (
                <QueuedMessageBubble key={q.id} text={q.text} onCancel={() => cancelQueued(q.id)} />
              ))}
            </>
          )}
        </div>

        {/* Annotations */}
        <AnnotationPanel />

        {/* Sticky TODO snapshot (main agent only) */}
        <CurrentTodoList items={currentTodoItems} />

        {/* Input — hidden while a user_input_request is pending (answer via the card instead) */}
        {pendingUserInputs.length === 0 && !systemPromptViewOpen && (
        <div className="p-2.5 relative" style={{ borderTop: '1px solid var(--c-hair)' }}>
          {activeThread?.planId != null && (
            <ContextLinkBar
              icon={<ClipboardList size={11} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
              label={activePlan?.title ? `Plan: ${activePlan.title}` : 'Plan'}
              title={
                activePlan?.currentVersion
                  ? `${activePlan.title ?? 'Plan'} · v${activePlan.currentVersion}`
                  : 'Open plan'
              }
              badge={
                activePlan?.currentVersion ? (
                  <span
                    className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                    style={{
                      background: 'var(--c-hair)',
                      color: 'var(--c-muted)',
                      flexShrink: 0,
                      marginLeft: 'auto',
                    }}
                  >
                    v{activePlan.currentVersion}
                  </span>
                ) : null
              }
              onClick={() =>
                navigate({
                  to: '/plans/$planId',
                  params: { planId: String(activeThread.planId) },
                })
              }
            />
          )}
          {activeThread?.contextType === 'brief' && activeThread.briefPath && (
            <ContextLinkBar
              icon={<FileText size={11} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
              label={`Brief: ${
                (typeof activeBrief?.frontmatter.title === 'string' && activeBrief.frontmatter.title) ||
                activeThread.briefPath.replace(/\.md$/, '')
              }`}
              title="Open brief"
              onClick={() =>
                navigate({
                  to: '/briefs/$path',
                  params: { path: encodeBriefPath(activeThread.briefPath as string) },
                })
              }
            />
          )}
          {activeThread?.contextType === 'patch' && activeThread.patchPath && (
            <ContextLinkBar
              icon={<FileWarning size={11} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
              label={`Patch: ${activePatch?.title || activeThread.patchPath.replace(/\.md$/, '')}`}
              title="Open patch"
              onClick={() =>
                navigate({
                  to: '/patches/$path',
                  params: { path: encodePatchPath(activeThread.patchPath as string) },
                })
              }
            />
          )}
          <div
            className="rounded-lg"
            style={{
              background: 'var(--c-card)',
              border: `1px solid ${hasInput ? 'var(--c-accent)' : 'var(--c-hair-strong)'}`,
            }}
          >
            {/* Context chips row */}
            {currentPage && (
              <div className="flex items-center gap-1.5 px-2 pt-1.5 flex-wrap">
                <span
                  className="inline-flex items-center gap-1 rounded-md pl-1.5 pr-1 py-0.5 text-[10.5px] font-mono"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                  title={currentPage}
                >
                  <FileText size={10} />
                  <span className="truncate" style={{ maxWidth: 220 }}>
                    {currentPage}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded ml-0.5 hover:opacity-100"
                    style={{
                      width: 14,
                      height: 14,
                      color: 'var(--c-muted)',
                      background: 'transparent',
                      opacity: 0.7,
                    }}
                    onClick={() => setDismissedPageKey(routerPageKey)}
                    title="Detach current page"
                    aria-label="Detach current page"
                  >
                    <X size={10} />
                  </button>
                </span>
              </div>
            )}
            {/* M05: compact queue counter — full pending messages render as grey
                ghost bubbles in the conversation; this is a count + clear-all. */}
            {queuedMessages.length > 0 && (
              <div className="flex items-center gap-1.5 px-2 pt-1.5 flex-wrap">
                <span
                  className="inline-flex items-center gap-1 rounded-md pl-1.5 pr-1 py-0.5 text-[10.5px] font-mono"
                  style={{
                    background: 'var(--c-panel)',
                    border: '1px dashed var(--c-hair-strong)',
                    color: 'var(--c-muted)',
                  }}
                  title={`${queuedMessages.length} message${queuedMessages.length === 1 ? '' : 's'} queued`}
                >
                  <Clock size={10} />
                  <span>{queuedMessages.length} queued</span>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded ml-0.5 hover:opacity-100"
                    style={{
                      width: 14,
                      height: 14,
                      color: 'var(--c-muted)',
                      background: 'transparent',
                      opacity: 0.7,
                    }}
                    onClick={() => clearQueue()}
                    title="Clear queue"
                    aria-label="Clear queue"
                  >
                    <X size={10} />
                  </button>
                </span>
              </div>
            )}
            <div className="chat-input-wrap px-2.5 pt-1.5 pb-1" style={{ color: 'var(--c-ink)' }}>
              <ChatInputEditor
                ref={inputRef}
                // M05: composer stays unlocked during a live turn — Send/↵ queues.
                placeholder={
                  isBusy
                    ? 'Queue a message…'
                    : annotations.length > 0
                      ? 'Message (optional — annotations provide context)…'
                      : 'Message claude4spec…'
                }
                onSubmit={() => void handleSend()}
                onChange={(hasContent) => {
                  setHasInput(hasContent);
                  if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current);
                  draftSaveTimer.current = window.setTimeout(() => {
                    draftSaveTimer.current = null;
                    const md = inputRef.current?.getMarkdown() ?? '';
                    const key = chatThreadId ?? NEW_THREAD_DRAFT_KEY;
                    const current = draftsRef.current;
                    const trimmed = md.trim();
                    if (trimmed) {
                      if (current[key] === md) return;
                      setDrafts({ ...current, [key]: md });
                    } else if (key in current) {
                      const next = { ...current };
                      delete next[key];
                      setDrafts(next);
                    }
                  }, 250);
                }}
              />
            </div>
            <div className="flex items-center gap-1 px-1.5 pb-1.5">
              <button
                onClick={() => setSettingsOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-mono"
                style={{
                  color: 'var(--c-muted)',
                  background: settingsOpen ? 'var(--c-panel)' : 'transparent',
                }}
                title="Model, thinking level, plan mode, context settings"
              >
                <Cpu size={11} />
                <span style={{ color: 'var(--c-ink)' }}>{modelLabel}</span>
                <span>·</span>
                <span>thinking: {thinking}</span>
                {planMode && (
                  <>
                    <span>·</span>
                    <span
                      className="inline-flex items-center gap-0.5"
                      style={{ color: 'var(--c-accent)' }}
                    >
                      <ClipboardList size={10} /> plan
                    </span>
                  </>
                )}
                <ChevronDown size={10} />
              </button>
              <span className="flex-1" />
              {/* M05: during a live turn show Stop + a queueing Send (↵ also queues). */}
              {isBusy && (
                <button
                  onClick={abort}
                  className="rounded-md px-2 py-1 text-[11.5px] inline-flex items-center gap-1"
                  style={{ background: 'var(--c-red-soft)', color: 'var(--c-red)' }}
                  title="Stop"
                >
                  <Square size={11} /> Stop
                </button>
              )}
              <button
                onClick={() => void handleSend()}
                disabled={isBusy ? !hasInput : !hasInput && annotations.length === 0}
                className="rounded-md p-1.5 disabled:opacity-40"
                style={{ background: 'var(--c-accent)', color: '#fff' }}
                title={isBusy ? 'Queue (↵)' : 'Send (↵)'}
              >
                <Send size={12} />
              </button>
            </div>
          </div>
          {settingsOpen && (
            <ModelSettingsPopover
              model={model}
              setModel={setModel}
              thinking={thinking}
              setThinking={setThinking}
              planMode={planMode}
              setPlanMode={togglePlanMode}
              currentPage={currentPage}
              sessionLocked={activeThread?.lastSessionId != null}
              resumeConstraints={resumeConstraints}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
        )}
      </aside>
    </div>
  );
}

// --- Icon button helper ---

function IconBtn({
  icon: I,
  title,
  onClick,
}: {
  icon: typeof Plus;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="h-7 w-7 rounded-md inline-flex items-center justify-center btn-ghost"
      style={{ color: 'var(--c-muted)' }}
    >
      <I size={14} />
    </button>
  );
}

// --- Thread dropdown (absolute floating) ---

interface ThreadDropdownProps {
  threads: import('../../shared/entities.js').ChatThreadMeta[];
  activeId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect(id: string): void;
  onCreate(): void;
  onDelete(id: string): void;
  onLoadMore(): void;
  onClose(): void;
}

function ThreadDropdown({ threads, activeId, hasMore, loadingMore, onSelect, onCreate, onDelete, onLoadMore, onClose }: ThreadDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Infinite scroll: fetch the next page when scrolled near the bottom. useThreadList
  // serializes/guards loadMore, so firing on every qualifying scroll event is safe.
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    if (!hasMore) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) onLoadMore();
  };

  return (
    <div
      ref={ref}
      className="absolute z-30 rounded-lg shadow-xl"
      style={{
        top: 40,
        left: 12,
        width: 320,
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
      }}
    >
      <div
        className="p-2 flex items-center gap-2"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <button
          onClick={onCreate}
          className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={12} /> New conversation
        </button>
      </div>
      <div className="max-h-80 overflow-auto nice-scroll py-1" onScroll={onScroll}>
        {threads.length === 0 && (
          <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--c-muted)' }}>
            No previous conversations.
          </div>
        )}
        {threads.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              className="w-full text-left px-3 py-2 flex items-start gap-2 transition"
              style={{ background: active ? 'var(--c-accent-soft)' : 'transparent' }}
            >
              <MessageSquare size={12} style={{ color: 'var(--c-muted)', marginTop: 2 }} />
              <button onClick={() => onSelect(t.id)} className="flex-1 min-w-0 text-left">
                <div
                  className="text-[12.5px] truncate"
                  style={{ fontWeight: active ? 600 : 500, color: 'var(--c-ink)' }}
                >
                  {t.title ?? '(untitled)'}
                </div>
                <div
                  className="text-[10.5px] font-mono flex items-center gap-2"
                  style={{ color: 'var(--c-subtle)' }}
                >
                  <span>{relative(t.updatedAt)}</span>
                  <span>·</span>
                  <span>{t.messageCount} msgs</span>
                </div>
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await confirmDestructive({
                    title: 'Delete conversation?',
                    body: `Delete "${t.title ?? t.id}"? Message history cannot be recovered.`,
                    confirmLabel: 'Delete',
                  });
                  if (ok) onDelete(t.id);
                }}
                className="p-0.5 opacity-60 hover:opacity-100"
                title="Delete thread"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
        {loadingMore && (
          <div
            className="flex items-center justify-center gap-2 px-3 py-2 text-[11px]"
            style={{ color: 'var(--c-muted)' }}
          >
            <Loader2 size={12} className="animate-spin" />
            Loading more…
          </div>
        )}
      </div>
    </div>
  );
}

// --- Model settings popover ---

interface ModelSettingsPopoverProps {
  model: ChatModel;
  setModel(m: ChatModel): void;
  thinking: ChatThinking;
  setThinking(t: ChatThinking): void;
  planMode: boolean;
  setPlanMode(v: boolean): void;
  currentPage: string | null;
  /** M05 session-lock: true once the active thread has a session (`lastSessionId != null`). */
  sessionLocked: boolean;
  /** Locked fields declared by the adapter package (served via GET /api/chat/config). */
  resumeConstraints: SessionResumeConstraint[];
  onClose(): void;
}

function ModelSettingsPopover({ model, setModel, thinking, setThinking, planMode, setPlanMode, currentPage, sessionLocked, resumeConstraints, onClose }: ModelSettingsPopoverProps) {
  const models: Array<{ id: ChatModel; label: string; sub: string }> = [
    { id: 'fable-5', label: 'Fable 5', sub: 'Next-gen · deep reasoning' },
    { id: 'opus-4.8', label: 'Opus 4.8', sub: 'Deep reasoning · slow' },
    { id: 'sonnet-4.6', label: 'Sonnet 4.6', sub: 'Balanced · default' },
    { id: 'haiku-4.5', label: 'Haiku 4.5', sub: 'Fast · light' },
  ];
  // 'Max' reasoning effort is adaptive-models only (Opus 4.8, Fable 5).
  const levels: Array<{ id: ChatThinking; label: string }> = [
    { id: 'off', label: 'Off' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    ...(isAdaptiveModel(model) ? [{ id: 'max' as ChatThinking, label: 'Max' }] : []),
  ];

  // M05 session-lock: model + reasoning fields freeze once the thread has a session.
  // Locked paths come from the adapter package (via /api/chat/config), not hardcoded, so
  // new immutable fields in the package lock automatically. Plan Mode stays mutable per-turn.
  const constraints = sessionLocked ? resumeConstraints : [];
  const lockFor = (path: string) => constraints.find((c) => c.path === path);
  const modelLock = lockFor('model');
  const thinkingLock =
    lockFor('architectureConfig.claude_thinking') ??
    lockFor('architectureConfig.claude_thinking_budget') ??
    lockFor('architectureConfig.claude_effort');

  return (
    <div
      className="absolute z-40 rounded-lg shadow-2xl"
      style={{
        bottom: 56,
        right: 8,
        width: 280,
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
      }}
    >
      <div
        className="px-3 py-2 text-[10.5px] font-mono uppercase tracking-wider flex items-center gap-1.5"
        style={{ color: 'var(--c-subtle)', borderBottom: '1px solid var(--c-hair)' }}
      >
        <Cpu size={11} /> Agent settings
        <span className="flex-1" />
        <kbd>esc</kbd>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            borderRadius: 4,
            color: 'var(--c-muted)',
          }}
        >
          <X size={12} />
        </button>
      </div>

      <div className="p-2.5">
        {sessionLocked && (modelLock || thinkingLock) && (
          <div
            className="text-[10.5px] mb-2 px-2 py-1 rounded-md"
            style={{ color: 'var(--c-muted)', background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
          >
            Model & reasoning are locked for this session. Start a new conversation to change them.
          </div>
        )}
        <div
          className="text-[10.5px] uppercase tracking-wider font-mono mb-1.5"
          style={{ color: 'var(--c-subtle)' }}
        >
          Model
        </div>
        <div className="space-y-1 mb-3">
          {models.map((m) => {
            const active = model === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { if (!modelLock) setModel(m.id); }}
                disabled={Boolean(modelLock)}
                title={modelLock?.reason}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md disabled:cursor-not-allowed"
                style={{
                  background: active ? 'var(--c-accent-soft)' : 'var(--c-panel)',
                  border: `1px solid ${active ? 'var(--c-accent)' : 'var(--c-hair)'}`,
                  opacity: modelLock && !active ? 0.4 : 1,
                }}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: active ? 'var(--c-accent)' : 'var(--c-hair-strong)',
                  }}
                />
                <span className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium" style={{ color: 'var(--c-ink)' }}>
                    {m.label}
                  </div>
                  <div className="text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                    {m.sub}
                  </div>
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="text-[10.5px] uppercase tracking-wider font-mono mb-1.5"
          style={{ color: 'var(--c-subtle)' }}
        >
          Thinking level
          {isAdaptiveModel(model) && thinking !== 'off' && (
            <span className="ml-2 normal-case" style={{ color: 'var(--c-muted)' }}>
              (uses adaptive thinking; level sets reasoning effort)
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {levels.map((l) => {
            const active = thinking === l.id;
            return (
              <button
                key={l.id}
                onClick={() => { if (!thinkingLock) setThinking(l.id); }}
                disabled={Boolean(thinkingLock)}
                title={thinkingLock?.reason}
                className="flex-1 px-2 py-1 rounded-md text-[11.5px] font-medium disabled:cursor-not-allowed"
                style={{
                  background: active ? 'var(--c-accent)' : 'var(--c-panel)',
                  color: active ? '#fff' : 'var(--c-ink)',
                  border: `1px solid ${active ? 'var(--c-accent)' : 'var(--c-hair-strong)'}`,
                  opacity: thinkingLock && !active ? 0.4 : 1,
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        <div
          className="text-[10.5px] uppercase tracking-wider font-mono mb-1.5 mt-3"
          style={{ color: 'var(--c-subtle)' }}
        >
          Plan mode
        </div>
        <button
          onClick={() => setPlanMode(!planMode)}
          className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md"
          style={{
            background: planMode ? 'var(--c-accent-soft)' : 'var(--c-panel)',
            border: `1px solid ${planMode ? 'var(--c-accent)' : 'var(--c-hair)'}`,
          }}
        >
          <span
            className="rounded-full inline-flex items-center justify-center"
            style={{
              width: 18,
              height: 18,
              background: planMode ? 'var(--c-accent)' : 'var(--c-hair-strong)',
              color: '#fff',
            }}
          >
            <ClipboardList size={11} />
          </span>
          <span className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium" style={{ color: 'var(--c-ink)' }}>
              {planMode ? 'Plan mode ON' : 'Plan mode OFF'}
            </div>
            <div className="text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
              Agent proposes, doesn't modify
            </div>
          </span>
        </button>

        <div
          className="flex items-center gap-1.5 mt-3 text-[11px]"
          style={{ color: 'var(--c-muted)' }}
        >
          <FileText size={10} />
          <span className="flex-1 truncate">
            {currentPage ? `Page "${currentPage}" attached` : 'No page context'}
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Helpers ---

function relative(isoDate: string): string {
  const d = new Date(isoDate).getTime();
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

function ContextLinkBar({
  icon,
  label,
  badge,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="mb-2 w-full inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono btn-ghost min-w-0 transition-colors"
      style={{ border: '1px solid var(--c-hair)' }}
      title={title}
    >
      {icon}
      <span
        className="truncate min-w-0 whitespace-nowrap overflow-hidden"
        style={{ color: 'var(--c-ink)' }}
      >
        {label}
      </span>
      {badge}
    </button>
  );
}

// 0.1.96 multiroot renamed the page-viewing route `/pages/$` → `/space/$rootId/$`
// (legacy `/pages/$` is now only a redirect stub with no `rootId` param). Keying on
// `params.rootId` selects the live space route and yields both the root and the path.
function useCurrentPage(): { rootId: string; path: string } | null {
  const matches = useMatches();
  return useMemo(() => {
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      if (!m) continue;
      const params = m.params as { _splat?: string; rootId?: string } | undefined;
      if (m.routeId?.includes('$rootId') && params?.rootId && params?._splat)
        return { rootId: params.rootId, path: params._splat };
    }
    return null;
  }, [matches]);
}
