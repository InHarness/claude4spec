import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, API_BASE } from '../lib/api-core.js';
import { useEventStream, useMessageReducer } from '@inharness-ai/agent-chat';
import type { QueuedMessage, UsageStats, WireEvent } from '@inharness-ai/agent-chat';
import type { NormalizedMessage, TodoItem, UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';
import type {
  Annotation,
  ChatBackgroundTask,
  ChatMessage as ChatMessageRow,
  ChatSubagentTask,
  ChatThread,
} from '../../shared/entities.js';
import { thinkingToConfig, type ChatModel, type ChatThinking } from '../state/chat.js';
import { toast } from '../ui/events.js';

/**
 * claude4spec's own annotation on a replayed `user_input_request`, added by the
 * server when the question is no longer answerable — answered, cancelled, or
 * its in-memory `pendingInputs` entry gone with a restart. It never rides a LIVE
 * event: a live one is by definition still answerable.
 *
 * Kept as a separate type rather than widening the union member, because the
 * library's own `WireEvent` already carries a `user_input_request` variant and a
 * second one would only make every field access ambiguous.
 */
type ResolvedUserInputAnnotation = {
  resolved?: boolean;
  response?: UserInputResponse | null;
};

type WireEventExtended =
  | WireEvent
  | { type: 'user_input_request'; request: UserInputRequest }
  | { type: 'todo_list_updated'; items: TodoItem[]; isSubagent: boolean }
  // 0.1.69 Transagents: bracket markers for a hidden child banka turn. The panel
  // nested-live-joins GET /api/chat/stream/:childThreadId between these.
  | { type: 'transagent_started'; childThreadId: string; toolUseId: string; contextType: string }
  | { type: 'transagent_completed'; childThreadId: string; toolUseId: string; status?: string }
  // M17: engine-backgrounded tasks (a `run_in_background` shell, a Monitor, a
  // workflow). agent-adapters 0.9.1 emits these instead of mislabelling the work
  // as `subagent_*`. agent-chat's reducer doesn't know them (unknown → identity),
  // so this panel is driven entirely from onEvent + custom state, transagent-style.
  | { type: 'background_task_started'; taskId: string; taskType: string; description: string }
  | {
      type: 'background_task_progress';
      taskId: string;
      taskType: string;
      description?: string;
      status?: string;
      outputFile?: string;
    }
  | {
      type: 'background_task_completed';
      taskId: string;
      taskType: string;
      status: string;
      outputFile?: string;
      summary?: string;
    }
  // Runtime shape of SSE `error` events is looser than the library's WireEvent:
  // adapter pass-through (agent-turn.ts) yields `{ error: <object>, phase }` with
  // NO `code`, while the server catch-block yields `{ error: string, code }`.
  | { type: 'error'; error: unknown; code?: string; phase?: string }
  // C21: the adapter's runtime warning — a filesystem scope degraded from a hard
  // OS sandbox to a soft one, an execute param this architecture ignores. The
  // library's reducer has no notion of it, so it is translated below.
  | { type: 'warning'; message: string };

/**
 * 0.1.69 Transagents: a child banka surfaced in the parent panel. Keyed by the
 * parent's `tool_use(runTransagent)` id; `childThreadId` drives the nested
 * live-join. `status` flips to 'completed'/'error' on `transagent_completed`.
 */
export interface TransagentEntry {
  toolUseId: string;
  childThreadId: string;
  contextType: string;
  status: 'running' | 'completed' | 'error';
}

/**
 * M17: an engine-backgrounded task surfaced in the panel, keyed by `taskId`.
 * `status` is 'running' until a `background_task_completed` sets the terminal
 * value the engine reports (e.g. 'success' / 'failed'). Rebuilt live from the
 * `background_task_*` events and, on cold reload, from the persisted
 * `chat_background_task` rows.
 */
export interface BackgroundTaskEntry {
  taskId: string;
  taskType: string;
  description: string;
  status: string;
  outputFile: string | null;
  summary: string | null;
}

/**
 * Upsert a background-task entry by taskId: apply `make` to the existing entry,
 * or seed a new one from `make(null)` when the taskId is not present yet. Every
 * background_task_* handler routes through this so an out-of-order progress /
 * completed event (replay buffer, completed-only fast task) inserts rather than
 * being silently dropped.
 */
function upsertBackgroundTask(
  prev: BackgroundTaskEntry[],
  taskId: string,
  make: (existing: BackgroundTaskEntry | null) => BackgroundTaskEntry,
): BackgroundTaskEntry[] {
  return prev.some((t) => t.taskId === taskId)
    ? prev.map((t) => (t.taskId === taskId ? make(t) : t))
    : [...prev, make(null)];
}

export interface UseChatOptions {
  serverUrl?: string;
  threadId: string | null;
  onThreadCreated?: (threadId: string) => void;
  onThreadMissing?: () => void;
  model: ChatModel;
  thinking: ChatThinking;
  planMode: boolean;
  /**
   * M05 (D4): fired when the server clears the thread's queue (Stop/abort or
   * explicit clear). Carries the cleared texts so the composer can restore them
   * (the reducer only drops the chips — composer text is component-owned).
   */
  onQueueCleared?: (texts: string[]) => void;
}

// M31: stala modulowa — useEventStream memoizuje po tozsamosci
// endpoints.streamByThread; inline obiekt per render zmienial tozsamosc
// joinStream i zapetlal efekt ladowania watku (Maximum update depth).
export const CHAT_ENDPOINTS = {
  chat: `${API_BASE}/chat`,
  abort: `${API_BASE}/chat/abort`,
  streamByThread: (tid: string) => `${API_BASE}/chat/stream/${encodeURIComponent(tid)}`,
  // M05 queue endpoints (project-prefixed via API_BASE).
  queue: (tid: string) => `${API_BASE}/chat/queue/${encodeURIComponent(tid)}`,
  queueItem: (tid: string, mid: string) =>
    `${API_BASE}/chat/queue/${encodeURIComponent(tid)}/${encodeURIComponent(mid)}`,
  queueClear: (tid: string) => `${API_BASE}/chat/queue/${encodeURIComponent(tid)}`,
};

export function useChat({ serverUrl = '', threadId, onThreadCreated, onThreadMissing, model, thinking, planMode, onQueueCleared }: UseChatOptions) {
  const { state, sendUserMessage, handleWireEvent, restoreMessages, clear } = useMessageReducer(
    'claude-code',
    model,
  );

  // Ref so `onEvent`'s identity stays stable (it feeds useEventStream's memo).
  const onQueueClearedRef = useRef(onQueueCleared);
  useEffect(() => {
    onQueueClearedRef.current = onQueueCleared;
  }, [onQueueCleared]);

  const currentThreadIdRef = useRef<string | null>(threadId);
  const loadingThreadRef = useRef<string | null>(null);
  // threadId utworzony przez biezacy stream (implicit-create przy threadId=null).
  // Sygnal dla efektu load-thread, ze zmiana threadId NIE jest switchem watku
  // i nie wolno robic teardownu trwajacej tury.
  const createdByActiveStreamRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  /** C21: makes each synthetic warning block's toolUseId unique within a session. */
  const warningSeqRef = useRef(0);
  /**
   * Request ids whose read-only history card is already on screen — either
   * synthesized from a resolved replay event, or restored from persisted rows
   * that the joiner's history slice happened to keep (see the thread-load effect).
   * Either way the replay branch must not build a second card for them. Cleared
   * wherever `pendingUserInputs` is, since both describe the same turn.
   */
  const synthesizedUserInputsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    isStreamingRef.current = state.isStreaming;
  }, [state.isStreaming]);

  const [pendingUserInputs, setPendingUserInputs] = useState<UserInputRequest[]>([]);
  const [currentTodoItems, setCurrentTodoItems] = useState<TodoItem[] | null>(null);
  const [userPlanModes, setUserPlanModes] = useState<boolean[]>([]);
  const [userAnnotations, setUserAnnotations] = useState<Annotation[][]>([]);
  // Live, per-response usage. Trzy zrodla aktualizacji (w priorytecie):
  // 1) `assistant_message` event SSE → progress w trakcie tury (per asystent message)
  // 2) hydrate z `chat_thread.last_usage_json` przy loadThread / refetch (F5, switch)
  // Reducer w @inharness-ai/agent-chat sam ustawia `state.usage` na koncowy `result.usage`
  // (session-cumulative), ale serwer zapisuje per-turn snapshot do DB i live update tu —
  // dlatego return uzywa liveUsage z priorytetem nad state.usage.
  const [liveUsage, setLiveUsage] = useState<UsageStats | null>(null);
  // Live last-turn context window utilization (agent-chat 0.1.1: pole `contextSize`
  // na evencie `result`, nadpisywane — NIE sumować). Hydrate z `chat_thread.last_context_size`
  // (lub fallback z usage.inputTokens+outputTokens dla starych wątków pre-024).
  // Reducer wystawia `state.contextSize` na każdym `result`, ale `rowsToChatMessages`
  // nie populate `ChatMessage.contextSize` — RESTORE branch reducera nie odbuduje
  // wartości z DB. Stąd duplikujemy wzorzec `liveUsage` z dedykowanym fallbackiem.
  const [liveContextSize, setLiveContextSize] = useState<number | null>(null);
  // Flaga „join w toku" — true od momentu wykrycia żywej tury (`isLive`) do zamknięcia
  // resume-streamu (`joinStream` resolve). UI używa jej zamiennie ze `state.isStreaming`
  // żeby pokazać „streaming…" badge i Stop button także w oknie zanim dotrze `turn_start`
  // (reducer sam ustawi isStreaming dopiero po `turn_start`).
  const [isResuming, setIsResuming] = useState(false);
  // 0.1.69 Transagents: child banki surfaced in this panel (keyed by tool_use id).
  const [transagents, setTransagents] = useState<TransagentEntry[]>([]);
  // M17: engine-backgrounded tasks surfaced in this panel (keyed by taskId).
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTaskEntry[]>([]);
  // Active thread metadata sourced from GET /api/threads/:id (the same fetch that
  // loads messages below). The header/model-lock controls read it from here instead
  // of the paginated thread list, so they stay correct for threads beyond page 1.
  const [activeThreadMeta, setActiveThreadMeta] = useState<ChatThread | null>(null);

  const onEvent = useCallback(
    (event: WireEvent) => {
      const ext = event as WireEventExtended;
      if (ext.type === 'transagent_started') {
        const { toolUseId, childThreadId, contextType } = ext;
        setTransagents((prev) =>
          prev.some((t) => t.toolUseId === toolUseId)
            ? prev.map((t) => (t.toolUseId === toolUseId ? { ...t, childThreadId, status: 'running' } : t))
            : [...prev, { toolUseId, childThreadId, contextType, status: 'running' }],
        );
        return;
      }
      if (ext.type === 'transagent_completed') {
        const { toolUseId } = ext;
        const status: TransagentEntry['status'] = ext.status === 'error' ? 'error' : 'completed';
        setTransagents((prev) =>
          prev.map((t) => (t.toolUseId === toolUseId ? { ...t, status } : t)),
        );
        return;
      }
      // M17: background-task lifecycle. Every variant UPSERTS by taskId — progress
      // and completed can legitimately arrive before `started` (replay-buffer
      // ordering, or a completed-only fast task), so a plain map that dropped the
      // update on a missing entry would lose the task. Kept out of the lib reducer
      // (early return) — it has no background-task block; this panel is custom.
      if (ext.type === 'background_task_started') {
        const { taskId, taskType, description } = ext;
        setBackgroundTasks((prev) =>
          upsertBackgroundTask(prev, taskId, (e) => ({
            taskId,
            taskType,
            description,
            status: 'running',
            outputFile: e?.outputFile ?? null,
            summary: e?.summary ?? null,
          })),
        );
        return;
      }
      if (ext.type === 'background_task_progress') {
        const { taskId, taskType, description, status, outputFile } = ext;
        setBackgroundTasks((prev) =>
          upsertBackgroundTask(prev, taskId, (e) => ({
            taskId,
            taskType,
            description: description ?? e?.description ?? '',
            status: status ?? e?.status ?? 'running',
            outputFile: outputFile ?? e?.outputFile ?? null,
            summary: e?.summary ?? null,
          })),
        );
        return;
      }
      if (ext.type === 'background_task_completed') {
        const { taskId, taskType, status, outputFile, summary } = ext;
        setBackgroundTasks((prev) =>
          upsertBackgroundTask(prev, taskId, (e) => ({
            taskId,
            taskType,
            description: e?.description ?? '',
            status,
            outputFile: outputFile ?? e?.outputFile ?? null,
            summary: summary ?? e?.summary ?? null,
          })),
        );
        return;
      }
      if (ext.type === 'user_input_request') {
        /**
         * A RESOLVED request is history, not a prompt. It reaches us only from
         * the replay buffer of a turn that is still running (F5, or a thread
         * switch away and back) — the question was already answered, so putting
         * it back in `pendingUserInputs` would hide the composer behind a card
         * whose submit answers `404 no pending input for that requestId`.
         *
         * It cannot simply be dropped either: a mid-turn joiner restores
         * persisted history only up to BEFORE the last user message, so the
         * `user_input_request` / `user_input_response` rows of the running turn
         * never arrive — this event is the only trace of the question the
         * current transcript will get. So synthesize the same pair of blocks
         * `rowsToChatMessages` builds from those rows, exactly the way the
         * `warning` branch below synthesizes its carrier `tool_use`.
         *
         * The `uir-` prefix is not cosmetic. The adapter uses
         * `requestId === ctx.toolUseID`, so an unprefixed id would collide with
         * the REAL `AskUserQuestion` tool_use/tool_result pair already in the
         * stream, and <BlockRenderer />'s first-match pairing would cross the
         * two.
         */
        const annotation = ext as ResolvedUserInputAnnotation;
        if (annotation.resolved) {
          const { requestId } = ext.request;
          if (synthesizedUserInputsRef.current.has(requestId)) return;
          synthesizedUserInputsRef.current.add(requestId);
          setPendingUserInputs((prev) => prev.filter((r) => r.requestId !== requestId));
          handleWireEvent({
            type: 'tool_use',
            toolUseId: `uir-${requestId}`,
            toolName: USER_INPUT_TOOL_NAME,
            input: ext.request,
            isSubagent: false,
          });
          if (annotation.response) {
            handleWireEvent({
              type: 'tool_result',
              toolUseId: `uir-${requestId}`,
              summary: JSON.stringify(annotation.response),
              isSubagent: false,
            });
          }
          return;
        }
        setPendingUserInputs((prev) =>
          prev.some((r) => r.requestId === ext.request.requestId) ? prev : [...prev, ext.request],
        );
        return;
      }
      if (ext.type === 'todo_list_updated' && !ext.isSubagent) {
        setCurrentTodoItems(ext.items.length > 0 ? ext.items : null);
      }
      if (ext.type === 'assistant_message') {
        const msg = (ext as { message: NormalizedMessage }).message;
        if (!msg.subagentTaskId && msg.usage) {
          setLiveUsage(msg.usage);
        }
      }
      if (ext.type === 'result') {
        const cs = (ext as { contextSize?: number }).contextSize;
        if (typeof cs === 'number') setLiveContextSize(cs);
      }
      // M05 (D4): restore cleared queue texts into the composer. Arrives both
      // from the SSE broadcast and synthesized by useEventStream.abort. The
      // reducer (below) drops the chips; the composer text is component-owned.
      if (ext.type === 'queue_cleared') {
        const texts = (ext as { texts?: string[] }).texts ?? [];
        if (texts.length > 0) onQueueClearedRef.current?.(texts);
      }
      // Surface SSE `error` events as a toast. Without this, adapter pass-through
      // errors (e.g. AdapterInitError, phase:'init') only set the reducer's
      // `state.error` — which nothing renders — so the turn dies silently.
      // The network-failure toast lives in `onError`; this is its SSE-event peer.
      // Skip ABORTED (user pressed Stop) to avoid noise on intentional cancels.
      if (ext.type === 'error' && ext.code !== 'ABORTED') {
        toast.error(formatStreamError(ext));
      }
      /**
       * C21: `warning` reaches the transcript by being translated into a
       * synthetic `tool_use`, exactly as `user_input_request` is
       * (USER_INPUT_TOOL_NAME). The reducer and `UIContentBlock` are the
       * library's, so a new block variant is not ours to add — but a tool call
       * IS a block the reducer already places in order, live, and that ordering
       * is the whole point: a warning rendered after the turn tells you the
       * guarantee weakened at some unspecified moment.
       *
       * The persisted row (role `warning`) rebuilds this same block on reload,
       * so one renderer serves both paths.
       */
      if (ext.type === 'warning') {
        warningSeqRef.current += 1;
        // The field names are the library's (`toolUseId`/`toolName`), not the
        // adapter's (`id`/`name`): the reducer copies them verbatim, so a cast
        // over the wrong names silently produced `toolName: undefined`, missed
        // the WARNING_TOOL_NAME branch in <BlockRenderer /> and crashed the whole
        // overlay inside <ToolCard />. No cast here on purpose — it is what makes
        // the compiler catch this drift next time.
        handleWireEvent({
          type: 'tool_use',
          toolUseId: `warning-${warningSeqRef.current}`,
          toolName: WARNING_TOOL_NAME,
          input: { message: ext.message },
          isSubagent: false,
        });
        return;
      }
      handleWireEvent(event);
    },
    [handleWireEvent],
  );
  const onError = useCallback(
    (error: Error) => {
      handleWireEvent({ type: 'error', error: error.message, code: 'NETWORK_ERROR' });
      toast.error(`Chat stream disconnected: ${error.message}`);
    },
    [handleWireEvent],
  );
  const onConnected = useCallback(
    (_requestId: string, tid: string) => {
      // Guard: ignoruj `connected` ze streamow ktorych watek juz nie jest aktywny
      // w UI (uzytkownik przelaczyl sie zanim doszedl event z poprzedniego streamu).
      if (currentThreadIdRef.current && tid !== currentThreadIdRef.current) return;
      currentThreadIdRef.current = tid;
      if (tid && tid !== threadId) {
        createdByActiveStreamRef.current = tid;
        onThreadCreated?.(tid);
      }
    },
    [onThreadCreated, threadId],
  );

  const {
    startStream,
    joinStream,
    abort: abortStream,
    disconnect: disconnectStream,
    queueMessage: queueMessageRaw,
    cancelQueued: cancelQueuedRaw,
    clearQueue: clearQueueRaw,
  } = useEventStream({
    serverUrl,
    // M31: local transport targets the project-prefixed API. An explicit peer
    // serverUrl keeps the library defaults (`${serverUrl}/api/chat…`).
    ...(serverUrl === '' ? { endpoints: CHAT_ENDPOINTS } : {}),
    onEvent,
    onError,
    onConnected,
  });

  const sendMessage = useCallback(
    async (
      prompt: string,
      annotations: Annotation[] = [],
      currentPage?: string | null,
      currentPageRootId?: string | null,
    ) => {
      if (state.isStreaming) return;
      if (!prompt.trim() && annotations.length === 0) return;

      // Nowa tura przejmuje transport — `startStream` sam abortuje ewentualny join z F5.
      setIsResuming(false);

      sendUserMessage(
        prompt.trim() ? prompt : `(${annotations.length} annotation${annotations.length === 1 ? '' : 's'} attached)`,
      );
      setUserPlanModes((prev) => [...prev, planMode]);
      setUserAnnotations((prev) => [...prev, annotations]);

      const architectureConfig = thinkingToConfig(thinking, model);

      const body = {
        prompt,
        threadId: currentThreadIdRef.current ?? undefined,
        architecture: 'claude-code',
        model,
        planMode,
        ...(architectureConfig ? { architectureConfig } : {}),
        ...(annotations.length ? { annotations } : {}),
        ...(currentPage ? { currentPage } : {}),
        ...(currentPageRootId ? { currentPageRootId } : {}),
      } as Parameters<typeof startStream>[0] & {
        annotations?: Annotation[];
        currentPage?: string;
        currentPageRootId?: string;
        architectureConfig?: Record<string, unknown>;
        planMode?: boolean;
      };

      await startStream(body);
    },
    [state.isStreaming, sendUserMessage, startStream, model, thinking, planMode],
  );

  // Stop działa dla obu trybów: `abortStream` (z @inharness-ai/agent-chat) POST-uje
  // `/api/chat/abort` z `requestId` zapamiętanym z eventu `connected` — zarówno dla
  // startStream, jak i joinStream. Serwer abortuje adapter → emituje error/done →
  // join feeduje je do reducera (finalize). Lokalny dispatch ABORTED daje natychmiastowy feedback.
  const abort = useCallback(() => {
    abortStream();
    setIsResuming(false);
    handleWireEvent({ type: 'error', error: 'Request aborted', code: 'ABORTED' });
    setPendingUserInputs([]);
    synthesizedUserInputsRef.current = new Set();
  }, [abortStream, handleWireEvent]);

  // M05: enqueue a message typed during a live turn. Returns true on success so
  // the caller can clear the composer; on failure the message stays put.
  const queueMessage = useCallback(
    async (prompt: string): Promise<boolean> => {
      const tid = currentThreadIdRef.current;
      if (!tid || !prompt.trim()) return false;
      try {
        await queueMessageRaw(tid, { prompt });
        return true;
      } catch (e) {
        toast.error(`Failed to queue message: ${(e as Error).message}`);
        return false;
      }
    },
    [queueMessageRaw],
  );

  // Cancel a single queued message; the UI updates from the SSE `queue_updated`.
  const cancelQueued = useCallback(
    (messageId: string) => {
      const tid = currentThreadIdRef.current;
      if (tid) void cancelQueuedRaw(tid, messageId);
    },
    [cancelQueuedRaw],
  );

  // Clear the whole queue; the server broadcasts `queue_cleared` (texts restored).
  const clearQueue = useCallback(() => {
    const tid = currentThreadIdRef.current;
    if (tid) void clearQueueRaw(tid);
  }, [clearQueueRaw]);

  const submitUserInput = useCallback(
    async (requestId: string, response: UserInputResponse) => {
      const threadIdForPost = currentThreadIdRef.current;
      try {
        const res = await apiFetch(`${serverUrl}/api/chat/user-input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, response, threadId: threadIdForPost }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          toast.error(`Failed to send answer: ${err.error?.message ?? res.statusText}`);
          return;
        }
        setPendingUserInputs((prev) => prev.filter((r) => r.requestId !== requestId));
      } catch (e) {
        toast.error(`Network error: ${(e as Error).message}`);
      }
    },
    [serverUrl],
  );

  // Load thread history when threadId changes
  useEffect(() => {
    // Watek dopiero co utworzony przez aktywny stream (threadId: null -> tid).
    // Reducer juz streamuje pierwsza ture — NIE wolno robic clear()/disconnect().
    if (createdByActiveStreamRef.current && createdByActiveStreamRef.current === threadId) {
      createdByActiveStreamRef.current = null;
      currentThreadIdRef.current = threadId;
      loadingThreadRef.current = null;
      return;
    }
    // Posprzataj po poprzednim watku zanim cokolwiek zaladujemy:
    // - disconnectStream() zamyka lokalny SSE (POST oraz ewentualny join) BEZ abortu serwera;
    //   server-side adapter zyje dalej, a powrot na ten watek wznowi go przez joinStream.
    //   Stop button uzywa abort() — tam celowo zatrzymujemy ture po obu stronach.
    // - clear() zresetuje reducer (state.isStreaming -> false), dzieki czemu staleResponse
    //   przestanie blokowac load nowego watku.
    disconnectStream();
    setIsResuming(false);
    clear();
    setPendingUserInputs([]);
    synthesizedUserInputsRef.current = new Set();
    setCurrentTodoItems(null);
    setUserPlanModes([]);
    setUserAnnotations([]);
    setLiveUsage(null);
    setLiveContextSize(null);
    setTransagents([]);
    setBackgroundTasks([]);
    setActiveThreadMeta(null);

    currentThreadIdRef.current = threadId;
    if (!threadId) return;
    if (loadingThreadRef.current === threadId) return;
    loadingThreadRef.current = threadId;

    (async () => {
      try {
        const res = await apiFetch(`${serverUrl}/api/threads/${threadId}`);
        // Race-guard: szybki A->B->A albo nowa tura wystartowana w trakcie fetcha.
        // Jezeli ref nie wskazuje juz na ten threadId — nie nadpisuj stanu.
        const staleResponse = currentThreadIdRef.current !== threadId;
        if (!res.ok) {
          if (!staleResponse) {
            clear();
            setCurrentTodoItems(null);
            setLiveUsage(null);
            setLiveContextSize(null);
            onThreadMissing?.();
          }
          return;
        }
        if (staleResponse) return;
        const payload = (await res.json()) as {
          data: ChatThread & {
            messages: ChatMessageRow[];
            subagentTasks: ChatSubagentTask[];
            backgroundTasks?: ChatBackgroundTask[];
            isLive?: boolean;
            queuedMessages?: QueuedMessage[];
          };
        };
        const thread = payload.data;
        setActiveThreadMeta(thread);
        const subagentTasks = thread.subagentTasks ?? [];
        const queuedMessages = thread.queuedMessages ?? [];
        const fullMessages = rowsToChatMessages(thread.messages, subagentTasks);
        // Per-user metadata z PELNEJ historii — kolejnosc renderowanych user-messages
        // (sliced + dolozona przez turn_start) odpowiada pelnej liscie.
        setCurrentTodoItems(thread.currentTodoItems ?? null);
        setUserPlanModes(thread.messages.filter((m) => m.role === 'user').map((m) => m.planMode));
        setUserAnnotations(
          thread.messages
            .filter((m) => m.role === 'user')
            .map((m) => parseContent(m.content).annotations ?? []),
        );
        setLiveUsage(thread.usage ?? null);
        setLiveContextSize(thread.contextSize ?? null);
        // 0.1.69 Transagents (F5): rebuild COMPLETED child panels from persisted
        // runTransagent tool_use+tool_result rows. In-flight children are not
        // reconstructed here — the live join replays `transagent_started` which
        // re-adds them via onEvent.
        setTransagents(reconstructTransagents(thread.messages));
        // M17 (F5 / cold reload): rebuild the background-task panel from persisted
        // rows. In-flight ('running') entries dedup against the live replay's
        // `background_task_started` (onEvent upserts by taskId).
        setBackgroundTasks(
          (thread.backgroundTasks ?? []).map((t) => ({
            taskId: t.taskId,
            taskType: t.taskType,
            description: t.description,
            status: t.status,
            outputFile: t.outputFile,
            summary: t.summary,
          })),
        );

        // Zywa tura serwerowa, ktorej ta karta nie streamuje → wznow przez joinStream.
        // Przywracamy historie SPRZED biezacej tury (przed ostatnim user-message); turn_start
        // + replay z serwera odbuduja biezaca ture na zywo (bez duplikacji user message).
        if (thread.isLive && !isStreamingRef.current) {
          const rows = thread.messages;
          let lastUserIdx = -1;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i]?.role === 'user') {
              lastUserIdx = i;
              break;
            }
          }
          const slicedRows = lastUserIdx >= 0 ? rows.slice(0, lastUserIdx) : rows;
          const slicedMessages = rowsToChatMessages(slicedRows, subagentTasks);
          /**
           * The slice does not always cut ABOVE the running turn's questions.
           * A message pushed into a live session persists a `user` row mid-turn
           * (`agent-turn.ts`, the `user_message` case) WITHOUT re-seeding the
           * replay buffer — unlike the merged-queue dispatch, which resets it.
           * So when the agent asked a question, the user answered it and then
           * queued a message, the cut lands at the PUSHED row and the answered
           * question's rows are restored as history — while the replay buffer
           * still carries the same question, annotated.
           *
           * Claiming those request ids here means the replay branch in `onEvent`
           * leaves them to the restored history rather than synthesizing a second
           * identical card beside it.
           */
          for (const row of slicedRows) {
            if (row.role === 'user_input_request' && row.toolId) {
              synthesizedUserInputsRef.current.add(row.toolId);
            }
          }
          restoreMessages(slicedMessages, thread.lastSessionId ?? undefined, 'claude-code', model, queuedMessages);
          setIsResuming(true);
          // Fire-and-forget: fetch+restore konczy sie szybko (zwalnia loadingThreadRef),
          // a join trwa do konca tury. Kontynuacja po resolve obsluguje wyscig — tura
          // skonczyla sie zanim dolaczylismy → joinStream zwraca false (404) → pelna historia.
          void joinStream(threadId).then((joined) => {
            if (currentThreadIdRef.current !== threadId) return;
            setIsResuming(false);
            if (!joined) {
              restoreMessages(fullMessages, thread.lastSessionId ?? undefined, 'claude-code', model, queuedMessages);
            }
          });
        } else {
          restoreMessages(fullMessages, thread.lastSessionId ?? undefined, 'claude-code', model, queuedMessages);
        }
      } catch {
        if (currentThreadIdRef.current === threadId) {
          clear();
          setCurrentTodoItems(null);
          setLiveUsage(null);
          setLiveContextSize(null);
        }
      } finally {
        loadingThreadRef.current = null;
      }
    })();

    return () => {
      disconnectStream();
      setIsResuming(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serverUrl, restoreMessages, clear, model, onThreadMissing, joinStream, disconnectStream]);

  useEffect(() => {
    setPendingUserInputs([]);
    synthesizedUserInputsRef.current = new Set();
  }, [threadId]);

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    isResuming,
    error: state.error,
    usage: liveUsage ?? state.usage,
    contextSize: liveContextSize ?? state.contextSize,
    sendMessage,
    abort,
    pendingUserInputs,
    submitUserInput,
    currentTodoItems,
    userPlanModes,
    userAnnotations,
    // M05 queue
    queuedMessages: state.queuedMessages,
    queueMessage,
    cancelQueued,
    clearQueue,
    // 0.1.69 Transagents
    transagents,
    // M17: engine-backgrounded tasks
    backgroundTasks,
    // P2: active thread metadata (from GET /api/threads/:id), list-independent.
    activeThreadMeta,
  };
}

/** 0.1.69: name of the runTransagent tool as persisted in tool_use rows. */
const TRANSAGENT_TOOL_NAME = 'mcp__transagent-tools__runTransagent';

/**
 * 0.1.69: rebuild COMPLETED transagent entries from persisted chat rows. Each
 * `runTransagent` tool_use is paired with its tool_result; the result content is
 * `{ threadId, summary }` (success) or `{ error }` (failure). Entries without a
 * tool_result are in-flight and left to the live `transagent_started` replay.
 */
function reconstructTransagents(rows: ChatMessageRow[]): TransagentEntry[] {
  const out: TransagentEntry[] = [];
  for (const row of rows) {
    if (row.role !== 'tool_use' || row.toolName !== TRANSAGENT_TOOL_NAME || !row.toolId) continue;
    const result = rows.find((r) => r.role === 'tool_result' && r.toolId === row.toolId);
    if (!result) continue; // in-flight — handled by live replay
    let childThreadId: string | null = null;
    let isError = false;
    try {
      const parsed = JSON.parse(result.content) as { summary?: unknown; isError?: boolean };
      isError = parsed.isError === true;
      // tool_result summary is the JSON string the MCP tool returned.
      const inner = typeof parsed.summary === 'string' ? JSON.parse(parsed.summary) : parsed.summary;
      if (inner && typeof inner === 'object' && typeof (inner as { threadId?: unknown }).threadId === 'string') {
        childThreadId = (inner as { threadId: string }).threadId;
      }
    } catch {
      childThreadId = null;
    }
    if (!childThreadId) continue;
    let contextType = 'chat';
    try {
      const input = JSON.parse(row.content) as { input?: { contextType?: unknown } };
      if (typeof input.input?.contextType === 'string') contextType = input.input.contextType;
    } catch {
      /* leave default */
    }
    out.push({
      toolUseId: row.toolId,
      childThreadId,
      contextType,
      status: isError ? 'error' : 'completed',
    });
  }
  return out;
}

// --- Format SSE `error` events into a human-readable toast message ---

// Adapter error class name → friendly prefix (from @inharness-ai/agent-adapters).
const ERROR_NAME_LABEL: Record<string, string> = {
  AdapterInitError: 'Failed to start agent',
  AdapterTimeoutError: 'Agent timed out',
  AdapterAbortError: 'Agent aborted',
  AdapterError: 'Agent error',
};

// Node syscall error codes (error.cause.code) → friendly reason.
const CAUSE_CODE_LABEL: Record<string, string> = {
  EEXIST: 'resource already exists',
  ENOENT: 'not found',
  EACCES: 'permission denied',
};

/**
 * Build a toast message from an SSE `error` event. Handles both wire shapes:
 *  - catch-block: `{ error: string, code }` → use the string as-is.
 *  - adapter pass-through: `{ error: { name, adapter, cause }, phase }` →
 *    compose from the known fields. Always returns something readable — never
 *    `"[object Object]"`.
 */
function formatStreamError(event: { error?: unknown }): string {
  const raw = event.error;

  // 1) String payload (server catch-block path), e.g. the AGENT_UNAVAILABLE hint.
  if (typeof raw === 'string' && raw.trim()) return raw;

  // 2) Object payload (adapter pass-through).
  if (raw && typeof raw === 'object') {
    const err = raw as { name?: string; adapter?: string; message?: string; cause?: unknown };
    let msg = err.name ? ERROR_NAME_LABEL[err.name] ?? 'Agent error' : 'Agent error';
    if (err.adapter) msg += ` (${err.adapter})`;

    const cause = err.cause as { code?: string } | undefined;
    if (cause && typeof cause === 'object' && typeof cause.code === 'string') {
      msg += `: ${CAUSE_CODE_LABEL[cause.code] ?? cause.code}`;
    } else if (err.message) {
      msg += `: ${err.message}`;
    }
    return msg;
  }

  // 3) Hard fallback.
  return 'Agent error';
}

// --- Convert persisted chat_message rows into UI ChatMessage[] ---

interface PersistedContent {
  text?: string;
  thinking?: boolean;
  input?: unknown;
  summary?: string;
  isError?: boolean;
  annotations?: Annotation[];
}

export const USER_INPUT_TOOL_NAME = '__user_input__';
/** C21: not a real tool — the carrier for an adapter warning inside the transcript. */
export const WARNING_TOOL_NAME = '__warning__';

function parseContent(raw: string): PersistedContent {
  try {
    return JSON.parse(raw) as PersistedContent;
  } catch {
    return { text: raw };
  }
}

function parseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function rowsToChatMessages(
  rows: ChatMessageRow[],
  subagentTasks: ChatSubagentTask[],
): import('@inharness-ai/agent-chat').ChatMessageType[] {
  type UIBlock = import('@inharness-ai/agent-chat').UIContentBlock;
  type UIMsg = import('@inharness-ai/agent-chat').ChatMessageType;
  type SubagentBlock = Extract<UIBlock, { type: 'subagent' }>;

  const tasksById = new Map<string, ChatSubagentTask>();
  for (const t of subagentTasks) tasksById.set(t.taskId, t);

  const msgs: UIMsg[] = [];
  let currentAssistant: UIMsg | null = null;
  let subagentBlocks = new Map<string, SubagentBlock>();

  const startAssistant = (ts: string) => {
    currentAssistant = {
      id: `msg-${msgs.length}`,
      role: 'assistant',
      blocks: [],
      timestamp: ts,
      isStreaming: false,
    };
    msgs.push(currentAssistant);
    subagentBlocks = new Map();
  };

  const getOrCreateSubagent = (taskId: string, ts: string): SubagentBlock => {
    const existing = subagentBlocks.get(taskId);
    if (existing) return existing;
    const task = tasksById.get(taskId);
    const nested: UIMsg = {
      id: `sub-${taskId}`,
      role: 'assistant',
      blocks: [],
      timestamp: ts,
      isStreaming: false,
    };
    const block: SubagentBlock = {
      type: 'subagent',
      taskId,
      toolUseId: task?.toolUseId ?? '',
      description: task?.description ?? 'Subagent',
      status: task?.status ?? 'completed',
      summary: task?.summary ?? undefined,
      messages: [nested],
    };
    subagentBlocks.set(taskId, block);
    currentAssistant!.blocks.push(block);
    return block;
  };

  const appendToContainer = (block: UIBlock, taskId: string | null, ts: string) => {
    if (taskId) {
      const sub = getOrCreateSubagent(taskId, ts);
      const nested = sub.messages[0];
      if (nested) nested.blocks.push(block);
    } else {
      currentAssistant!.blocks.push(block);
    }
  };

  for (const row of rows) {
    const parsed = parseContent(row.content);

    if (row.role === 'user') {
      currentAssistant = null;
      subagentBlocks = new Map();
      const block: UIBlock = { type: 'text', text: parsed.text ?? '', isStreaming: false };
      msgs.push({
        id: `msg-${msgs.length}`,
        role: 'user',
        blocks: [block],
        timestamp: row.createdAt,
        isStreaming: false,
      });
      continue;
    }

    if (!currentAssistant) startAssistant(row.createdAt);

    const taskId = row.subagentTaskId ?? null;

    switch (row.role) {
      case 'assistant': {
        const block: UIBlock = parsed.thinking
          ? { type: 'thinking', text: parsed.text ?? '', isStreaming: false, collapsed: true }
          : { type: 'text', text: parsed.text ?? '', isStreaming: false };
        appendToContainer(block, taskId, row.createdAt);
        break;
      }
      case 'tool_use': {
        const block: UIBlock = {
          type: 'toolUse',
          toolUseId: row.toolId ?? '',
          toolName: row.toolName ?? 'unknown',
          input: parsed.input,
          collapsed: true,
        };
        appendToContainer(block, taskId, row.createdAt);
        break;
      }
      case 'tool_result': {
        const block: UIBlock = {
          type: 'toolResult',
          toolUseId: row.toolId ?? '',
          content: parsed.summary ?? '',
          isError: parsed.isError ?? false,
          collapsed: true,
        };
        appendToContainer(block, taskId, row.createdAt);
        break;
      }
      case 'user_input_request': {
        const block: UIBlock = {
          type: 'toolUse',
          toolUseId: row.toolId ?? '',
          toolName: USER_INPUT_TOOL_NAME,
          input: parseRaw(row.content),
          collapsed: true,
        };
        currentAssistant!.blocks.push(block);
        break;
      }
      case 'user_input_response': {
        const block: UIBlock = {
          type: 'toolResult',
          toolUseId: row.toolId ?? '',
          content: row.content,
          isError: false,
          collapsed: true,
        };
        currentAssistant!.blocks.push(block);
        break;
      }
      case 'warning': {
        // The same synthetic block the live branch in `onEvent` produces, so a
        // reload renders the warning identically to the moment it arrived.
        const block: UIBlock = {
          type: 'toolUse',
          toolUseId: `warning-row-${row.id}`,
          toolName: WARNING_TOOL_NAME,
          input: parseRaw(row.content),
          collapsed: true,
        };
        currentAssistant!.blocks.push(block);
        break;
      }
    }
  }

  return msgs;
}
