import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatches, useNavigate } from '@tanstack/react-router';
import { Send, Square, X, Plus, MessageSquare, ChevronDown, FileText, Cpu, Trash2, ClipboardList } from 'lucide-react';
import { batchToolBlocks } from '@inharness-ai/agent-chat';
import { useChatStore, thinkingToConfig, type ChatModel, type ChatThinking } from '../state/chat.js';
import { usePersistedState } from '../state/persisted.js';
import { ResizeHandle } from '../components/ResizeHandle.js';
import { useChat } from './useChat.js';
import { useThreadList } from './useThreadList.js';
import { BlockRenderer } from './BlockRenderer.js';
import { AnnotationPanel } from './AnnotationPanel.js';
import { CurrentTodoList } from './CurrentTodoList.js';
import { UsageBadge } from './UsageBadge.js';
import { UserInputRequestCard } from './UserInputRequestCard.js';
import { ChatInputEditor, type ChatInputEditorHandle } from './ChatInputEditor.js';
import { SystemPromptView } from './SystemPromptView.js';
import { confirmDestructive } from '../ui/events.js';
import { CHAT_PREFILL_EVENT, type ChatPrefillDetail } from './chatPrefill.js';
import { usePlan } from '../hooks/usePlan.js';

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

  const [hasInput, setHasInput] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [systemPromptViewOpen, setSystemPromptViewOpen] = useState(false);
  const [systemPromptCache, setSystemPromptCache] = useState<Record<string, string | null>>({});
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);

  const [drafts, setDrafts] = usePersistedState<Record<string, string>>(
    'c4s:m05:chat-drafts',
    {},
    1,
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const draftSaveTimer = useRef<number | null>(null);

  const routerPagePath = useCurrentPagePath();
  const [dismissedPagePath, setDismissedPagePath] = useState<string | null>(null);
  const currentPage =
    routerPagePath && routerPagePath !== dismissedPagePath ? routerPagePath : null;

  const onThreadCreated = useCallback(
    (id: string) => {
      setChatThreadId(id);
    },
    [setChatThreadId],
  );

  const onThreadMissing = useCallback(() => {
    setChatThreadId(null);
  }, [setChatThreadId]);

  const {
    messages,
    isStreaming,
    isResuming,
    sendMessage,
    abort,
    abortResume,
    usage,
    contextSize,
    pendingUserInputs,
    submitUserInput,
    currentTodoItems,
    userPlanModes,
    userAnnotations,
  } = useChat({
    threadId: chatThreadId,
    onThreadCreated,
    onThreadMissing,
    model,
    thinking,
    planMode,
  });

  // `isBusy` = aktywna tura w tym watku (lokalna lub server-side, do ktorej jestesmy podlaczeni
  // przez resume SSE). Steruje widocznoscia „streaming…" badge, Stop buttona i disabled inputu.
  const isBusy = isStreaming || isResuming;

  const threadList = useThreadList();
  const activeThread = threadList.threads.find((t) => t.id === chatThreadId) ?? null;
  // M21: dla brief context naglowek pokazuje "Brief: <filename>" zamiast title.
  // Pozwala na szybka identyfikacje ze rozmowa ma whitelisted toolset (brief-tools).
  const activeTitle = activeThread?.contextType === 'brief' && activeThread.briefPath
    ? `Brief: ${activeThread.briefPath.replace(/\.md$/, '')}`
    : activeThread?.title ?? 'New conversation';
  const { data: activePlan } = usePlan(activeThread?.planId ?? null);

  useEffect(() => {
    setPlanMode(activeThread?.planMode ?? false);
  }, [activeThread?.id, activeThread?.planMode]);

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
      if (draft) {
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
        const res = await fetch(`/api/threads/${chatThreadId}/system-prompt`);
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
        await fetch(`/api/threads/${chatThreadId}`, {
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

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isBusy, pendingUserInputs.length]);

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
          void sendMessage(detail.prompt, [], currentPage);
        }
      }, 50);
    };
    window.addEventListener(CHAT_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(CHAT_PREFILL_EVENT, onPrefill);
  }, [setChatOpen, sendMessage, currentPage]);

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
    if (!text && annotations.length === 0) return;
    const annotationsSnapshot = annotations;
    handle?.clear();
    setHasInput(false);
    clearAnnotations();
    setSystemPromptViewOpen(false);
    // Wyczysc draft dla biezacego watku — robimy to PRZED sendMessage, bo `onThreadCreated`
    // moze przelaczyc `chatThreadId` zanim handler wroci, a chcemy zlapac stary klucz.
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
    await sendMessage(text, annotationsSnapshot, currentPage);
    await threadList.refresh();
  }, [sendMessage, annotations, currentPage, clearAnnotations, threadList, chatThreadId, setDrafts]);

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

  const modelLabel = model === 'sonnet-4.6' ? 'Sonnet 4.6' : model === 'opus-4.7' ? 'Opus 4.7' : 'Haiku 4.5';

  if (!chatOpen) return null;

  return (
    <div
      ref={rootRef}
      className="h-full flex"
      style={{ width: chatWidth, flexShrink: 0, borderLeft: '1px solid var(--c-hair)' }}
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
                ? 'Pokaz system prompt (snapshot z pierwszej tury)'
                : 'System prompt zostanie wyrenderowany po pierwszej wiadomosci'
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
              onSelect={(id) => {
                setChatThreadId(id);
                setThreadsOpen(false);
              }}
              onCreate={handleCreateThread}
              onDelete={async (id) => {
                await threadList.deleteThread(id);
                if (id === chatThreadId) setChatThreadId(null);
              }}
              onClose={() => setThreadsOpen(false)}
            />
          )}
        </div>

        {/* Message list — swap z <SystemPromptView /> gdy toggle aktywny */}
        <div ref={listRef} className="flex-1 overflow-auto nice-scroll px-3 py-3">
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
            </>
          )}
        </div>

        {/* Annotations */}
        <AnnotationPanel />

        {/* Sticky TODO snapshot (main agent only) */}
        <CurrentTodoList items={currentTodoItems} />

        {/* Input — hidden while a user_input_request is pending (answer via the card instead) */}
        {pendingUserInputs.length === 0 && (
        <div className="p-2.5 relative" style={{ borderTop: '1px solid var(--c-hair)' }}>
          {activeThread?.planId != null && (
            <button
              onClick={() =>
                navigate({
                  to: '/plans/$planId',
                  params: { planId: String(activeThread.planId) },
                })
              }
              className="mb-2 w-full inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono btn-ghost min-w-0 transition-colors"
              style={{
                border: '1px solid var(--c-hair)',
              }}
              title={
                activePlan?.currentVersion
                  ? `${activePlan.title ?? 'Plan'} · v${activePlan.currentVersion}`
                  : 'Open plan'
              }
            >
              <ClipboardList
                size={11}
                style={{ color: 'var(--c-accent)', flexShrink: 0 }}
              />
              <span
                className="truncate min-w-0 whitespace-nowrap overflow-hidden"
                style={{ color: 'var(--c-ink)' }}
              >
                {activePlan?.title ?? 'Plan'}
              </span>
              {activePlan?.currentVersion ? (
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
              ) : null}
            </button>
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
                    onClick={() => setDismissedPagePath(routerPagePath)}
                    title="Detach current page"
                    aria-label="Detach current page"
                  >
                    <X size={10} />
                  </button>
                </span>
              </div>
            )}
            <div className="chat-input-wrap px-2.5 pt-1.5 pb-1" style={{ color: 'var(--c-ink)' }}>
              <ChatInputEditor
                ref={inputRef}
                disabled={isBusy}
                placeholder={
                  annotations.length > 0
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
              {isBusy ? (
                <button
                  onClick={isStreaming ? abort : () => void abortResume()}
                  className="rounded-md px-2 py-1 text-[11.5px] inline-flex items-center gap-1"
                  style={{ background: 'var(--c-red-soft)', color: 'var(--c-red)' }}
                  title="Stop"
                >
                  <Square size={11} /> Stop
                </button>
              ) : (
                <button
                  onClick={() => void handleSend()}
                  disabled={!hasInput && annotations.length === 0}
                  className="rounded-md p-1.5 disabled:opacity-40"
                  style={{ background: 'var(--c-accent)', color: '#fff' }}
                  title="Send (↵)"
                >
                  <Send size={12} />
                </button>
              )}
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
  onSelect(id: string): void;
  onCreate(): void;
  onDelete(id: string): void;
  onClose(): void;
}

function ThreadDropdown({ threads, activeId, onSelect, onCreate, onDelete, onClose }: ThreadDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

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
      <div className="max-h-80 overflow-auto nice-scroll py-1">
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
  onClose(): void;
}

function ModelSettingsPopover({ model, setModel, thinking, setThinking, planMode, setPlanMode, currentPage, onClose }: ModelSettingsPopoverProps) {
  const models: Array<{ id: ChatModel; label: string; sub: string }> = [
    { id: 'sonnet-4.6', label: 'Sonnet 4.6', sub: 'Balanced · default' },
    { id: 'opus-4.7', label: 'Opus 4.7', sub: 'Deep reasoning · slow' },
    { id: 'haiku-4.5', label: 'Haiku 4.5', sub: 'Fast · light' },
  ];
  const levels: Array<{ id: ChatThinking; label: string }> = [
    { id: 'off', label: 'Off' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ];

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
                onClick={() => setModel(m.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md"
                style={{
                  background: active ? 'var(--c-accent-soft)' : 'var(--c-panel)',
                  border: `1px solid ${active ? 'var(--c-accent)' : 'var(--c-hair)'}`,
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
          {model === 'opus-4.7' && thinking !== 'off' && (
            <span className="ml-2 normal-case" style={{ color: 'var(--c-muted)' }}>
              (opus only supports adaptive)
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {levels.map((l) => {
            const active = thinking === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setThinking(l.id)}
                className="flex-1 px-2 py-1 rounded-md text-[11.5px] font-medium"
                style={{
                  background: active ? 'var(--c-accent)' : 'var(--c-panel)',
                  color: active ? '#fff' : 'var(--c-ink)',
                  border: `1px solid ${active ? 'var(--c-accent)' : 'var(--c-hair-strong)'}`,
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

function useCurrentPagePath(): string | null {
  const matches = useMatches();
  return useMemo(() => {
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      if (!m) continue;
      const params = m.params as { _splat?: string; slug?: string } | undefined;
      if (m.routeId?.includes('pages/$') && params?._splat) return params._splat;
    }
    return null;
  }, [matches]);
}
