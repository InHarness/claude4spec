import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventStream, useMessageReducer } from '@inharness-ai/agent-chat';
import type { UsageStats, WireEvent } from '@inharness-ai/agent-chat';
import type { NormalizedMessage, TodoItem, UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';
import type {
  Annotation,
  ChatMessage as ChatMessageRow,
  ChatSubagentTask,
  ChatThread,
} from '../../shared/entities.js';
import { thinkingToConfig, type ChatModel, type ChatThinking } from '../state/chat.js';
import { toast } from '../ui/events.js';

type WireEventExtended =
  | WireEvent
  | { type: 'user_input_request'; request: UserInputRequest }
  | { type: 'todo_list_updated'; items: TodoItem[]; isSubagent: boolean };

export interface UseChatOptions {
  serverUrl?: string;
  threadId: string | null;
  onThreadCreated?: (threadId: string) => void;
  onThreadMissing?: () => void;
  model: ChatModel;
  thinking: ChatThinking;
  planMode: boolean;
}

export function useChat({ serverUrl = '', threadId, onThreadCreated, onThreadMissing, model, thinking, planMode }: UseChatOptions) {
  const { state, sendUserMessage, handleWireEvent, restoreMessages, clear } = useMessageReducer(
    'claude-code',
    model,
  );

  const currentThreadIdRef = useRef<string | null>(threadId);
  const loadingThreadRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
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
  // EventSource do GET /api/chat/stream/:threadId — auto-resume gdy loadThread wykryje
  // status='streaming' na ktorymkolwiek rowsie (F5 w trakcie streamu / switch A->B->A).
  const resumeSourceRef = useRef<EventSource | null>(null);
  // Wystawiana flaga „resume w toku" — UI uzywa jej zamiennie z state.isStreaming
  // zeby pokazac „streaming…" badge i Stop button rowniez gdy klient nie startowal
  // tej tury z biezacej karty (F5 / wrocenie do watku po switchu).
  const [isResuming, setIsResuming] = useState(false);
  const closeResumeSource = useCallback(() => {
    if (resumeSourceRef.current) {
      resumeSourceRef.current.close();
      resumeSourceRef.current = null;
    }
    setIsResuming(false);
  }, []);

  const onEvent = useCallback(
    (event: WireEvent) => {
      const ext = event as WireEventExtended;
      if (ext.type === 'user_input_request') {
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
      if (tid && tid !== threadId) onThreadCreated?.(tid);
    },
    [onThreadCreated, threadId],
  );

  const { startStream, abort: abortStream, disconnect: disconnectStream } = useEventStream({
    serverUrl,
    onEvent,
    onError,
    onConnected,
  });

  const sendMessage = useCallback(
    async (prompt: string, annotations: Annotation[] = [], currentPage?: string | null) => {
      if (state.isStreaming) return;
      if (!prompt.trim() && annotations.length === 0) return;

      // Nowa tura przejmuje stream — zamykamy ewentualny resume-SSE z poprzedniego F5.
      closeResumeSource();

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
      } as Parameters<typeof startStream>[0] & {
        annotations?: Annotation[];
        currentPage?: string;
        architectureConfig?: Record<string, unknown>;
        planMode?: boolean;
      };

      await startStream(body);
    },
    [state.isStreaming, sendUserMessage, startStream, model, thinking, planMode, closeResumeSource],
  );

  const abort = useCallback(() => {
    abortStream();
    closeResumeSource();
    handleWireEvent({ type: 'error', error: 'Request aborted', code: 'ABORTED' });
    setPendingUserInputs([]);
  }, [abortStream, handleWireEvent, closeResumeSource]);

  // Abort tury, ktora trwa po stronie serwera, ale nie startowala z biezacej karty
  // (jestesmy podlaczeni przez resume SSE — nie znamy requestId, wiec POST per threadId).
  // W przeciwienstwie do `abort()` nie dispatchujemy ABORTED do reducera (state.isStreaming
  // i tak jest false), ani nie pokazujemy toasta — uzytkownik widzi po prostu zatrzymanie
  // pulsu „streaming…" gdy serwer wysle `done`.
  const abortResume = useCallback(async () => {
    const tid = currentThreadIdRef.current;
    if (!tid) return;
    try {
      await fetch(`${serverUrl}/api/chat/abort/${tid}`, { method: 'POST' });
    } catch {
      // best-effort — UI i tak zamknie resume po `done`/`error` z SSE
    }
    closeResumeSource();
  }, [serverUrl, closeResumeSource]);

  const submitUserInput = useCallback(
    async (requestId: string, response: UserInputResponse) => {
      const threadIdForPost = currentThreadIdRef.current;
      try {
        const res = await fetch(`${serverUrl}/api/chat/user-input`, {
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

  // Eventy z SSE nie ida do reducera (messageReducer.updateActiveMessage wymaga
  // activeAssistantMessageId != null, ale RESTORE ustawia je na null — delty bylyby
  // ciche odrzucane). Zamiast tego traktujemy ES jako event-driven trigger do refetch-u
  // z DB (DB jest zrodlem prawdy: kazdy UnifiedEvent persystuje sie w chat_message jeszcze
  // przed `send(event.type, event)` w handlerze). Debounce minimalizuje I/O podczas
  // szybkich burst-ow text_delta.
  const RESUME_EVENT_TYPES = [
    'text_delta',
    'thinking',
    'tool_use',
    'tool_result',
    'assistant_message',
    'subagent_started',
    'subagent_progress',
    'subagent_completed',
    'result',
    'error',
    'warning',
    'user_input_request',
    'todo_list_updated',
    'flush',
  ] as const;

  const refetchThreadFromDb = useCallback(
    async (tid: string) => {
      if (currentThreadIdRef.current !== tid) return;
      try {
        const res = await fetch(`${serverUrl}/api/threads/${tid}`);
        if (!res.ok) return;
        if (currentThreadIdRef.current !== tid) return;
        const payload = (await res.json()) as {
          data: ChatThread & { messages: ChatMessageRow[]; subagentTasks: ChatSubagentTask[] };
        };
        const thread = payload.data;
        const messages = rowsToChatMessages(thread.messages, thread.subagentTasks ?? []);
        restoreMessages(messages, thread.lastSessionId ?? undefined, 'claude-code', model);
        setCurrentTodoItems(thread.currentTodoItems ?? null);
        setLiveUsage(thread.usage ?? null);
        setLiveContextSize(thread.contextSize ?? null);
        // userPlanModes / userAnnotations nie ruszamy — user nie dopisal nowych wiadomosci
        // w trakcie resume (POST jest zablokowany 409 dopoki stream nie skonczy).
      } catch {
        // silent — kolejny event wywola retry
      }
    },
    [serverUrl, restoreMessages, model],
  );

  const openResumeStream = useCallback(
    (tid: string) => {
      closeResumeSource();
      const es = new EventSource(`${serverUrl}/api/chat/stream/${tid}`);
      resumeSourceRef.current = es;
      setIsResuming(true);

      let refetchTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleRefetch = () => {
        if (refetchTimer) return;
        refetchTimer = setTimeout(() => {
          refetchTimer = null;
          void refetchThreadFromDb(tid);
        }, 400);
      };
      const doFinalRefetch = () => {
        if (refetchTimer) {
          clearTimeout(refetchTimer);
          refetchTimer = null;
        }
        void refetchThreadFromDb(tid);
      };

      for (const t of RESUME_EVENT_TYPES) {
        es.addEventListener(t, () => {
          if (t === 'result' || t === 'error') {
            doFinalRefetch();
          } else {
            scheduleRefetch();
          }
        });
      }
      es.addEventListener('done', () => {
        doFinalRefetch();
        closeResumeSource();
      });
      es.onerror = () => {
        closeResumeSource();
      };
    },
    [serverUrl, closeResumeSource, refetchThreadFromDb],
  );

  // Load thread history when threadId changes
  useEffect(() => {
    // Posprzataj po poprzednim watku zanim cokolwiek zaladujemy:
    // - disconnectStream() zamyka tylko lokalny SSE (POST do /api/chat/abort NIE leci);
    //   server-side adapter zyje dalej, persystuje eventy do DB, a powrot na ten watek
    //   wykryje hasStreaming i podlaczy resume-SSE. Stop button uzywa abortStream() —
    //   tam celowo zatrzymujemy ture po obu stronach.
    // - closeResumeSource() zamknie resume-SSE i zresetuje isResuming;
    // - clear() zresetuje reducer (state.isStreaming -> false), dzieki czemu staleResponse
    //   przestanie blokowac load nowego watku.
    disconnectStream();
    closeResumeSource();
    clear();
    setPendingUserInputs([]);
    setCurrentTodoItems(null);
    setUserPlanModes([]);
    setUserAnnotations([]);
    setLiveUsage(null);
    setLiveContextSize(null);

    currentThreadIdRef.current = threadId;
    if (!threadId) return;
    if (loadingThreadRef.current === threadId) return;
    loadingThreadRef.current = threadId;

    (async () => {
      try {
        const res = await fetch(`${serverUrl}/api/threads/${threadId}`);
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
          data: ChatThread & { messages: ChatMessageRow[]; subagentTasks: ChatSubagentTask[] };
        };
        const thread = payload.data;
        const messages = rowsToChatMessages(thread.messages, thread.subagentTasks ?? []);
        restoreMessages(messages, thread.lastSessionId ?? undefined, 'claude-code', model);
        setCurrentTodoItems(thread.currentTodoItems ?? null);
        setUserPlanModes(thread.messages.filter((m) => m.role === 'user').map((m) => m.planMode));
        setUserAnnotations(
          thread.messages
            .filter((m) => m.role === 'user')
            .map((m) => parseContent(m.content).annotations ?? []),
        );
        setLiveUsage(thread.usage ?? null);
        setLiveContextSize(thread.contextSize ?? null);

        // Auto-resume: jesli ktorykolwiek rowek ma status='streaming' w momencie loadThread,
        // adapter moze nadal zyc po stronie serwera — podlaczamy sie do live streamu
        // przez GET /api/chat/stream/:threadId. Jesli adapter juz skonczyl, serwer od razu
        // zwroci `done` i ES sie zamknie — stan koncowy jest juz w restored messages.
        const hasStreaming = thread.messages.some((m) => m.status === 'streaming');
        if (hasStreaming && !isStreamingRef.current) {
          openResumeStream(threadId);
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
      closeResumeSource();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serverUrl, restoreMessages, clear, model, onThreadMissing, closeResumeSource]);

  useEffect(() => {
    setPendingUserInputs([]);
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
    abortResume,
    pendingUserInputs,
    submitUserInput,
    currentTodoItems,
    userPlanModes,
    userAnnotations,
  };
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

function rowsToChatMessages(
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
    }
  }

  return msgs;
}
