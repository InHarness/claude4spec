import type {
  UserInputHandler,
  UserInputRequest,
  UserInputResponse,
} from '@inharness-ai/agent-adapters';
import type { ChatService } from '../services/chat.js';
import { markUserInputResolvedInReplay, type ActiveAdapter } from './agent-turn.js';

/**
 * M05 `dhf17oo0` / `za3t91al` — the agent's question in a HEADLESS turn
 * (`POST /api/threads/:id/ask`, the only path of the `ask` operation).
 *
 * A headless turn has no consumer that could answer, and `c4s` exposes no answer
 * route, so the ROUTE answers: every `user_input_request` — from the built-in
 * question tool (`source: 'model-tool'`) and from MCP elicitation
 * (`source: 'mcp-elicitation'`) alike — gets `decline` at the moment it is written.
 *
 * - The question and the answer are written to the thread exactly as in chat
 *   (`r8zn8h13`): the `user_input_request` row first, then the `user_input_response`
 *   row, both before the agent gets the answer.
 * - Nothing is parked in `pendingInputs`: the handler resolves at once, so the idle
 *   clock never stands on an open question and the turn never waits for a user.
 * - The answer tells the agent to act on its own recommendation.
 */
export const HEADLESS_USER_INPUT_GUIDANCE =
  'No user is available to answer in this headless turn. Do not ask again — act on your own recommendation and carry on.';

/**
 * The adapter's `UserInputResponse` with the guidance for the agent.
 *
 * ASSUMPTION:dev-0508 — the response shape belongs to the adapter, and
 * `@inharness-ai/agent-adapters` 0.10.0 has no text field on `decline`: the
 * claude-code adapter renders a declined `AskUserQuestion` with its own fixed
 * message and an MCP elicitation decline with no content. The guidance therefore
 * travels as `message` on the response — handed to the adapter and written to the
 * thread — and reaches the model once the adapter forwards it.
 */
/**
 * The carrier that does reach the model: a note appended to the prompt the adapter
 * receives on every headless turn (never to the stored user message — that stays
 * what the user wrote, `r8zn8h13`). It is sent with every turn, so it holds on a
 * resumed session too, where the CLI ignores a new system prompt, and it covers both
 * sources: the adapter's own decline text ("declined to answer") for the question
 * tool and the bare `decline` an MCP server gets for an elicitation.
 *
 * ASSUMPTION:dev-0509 — M05 says the decline itself carries the guidance; the
 * adapter has no field for it (dev-0508), so the turn's prompt carries it.
 */
export const HEADLESS_TURN_PROMPT_NOTE = [
  '<headless_turn>',
  'This turn is headless: no user is available to answer you. Every question you ask —',
  'with the question tool or through an MCP elicitation — is declined at once.',
  `When a question is declined: ${HEADLESS_USER_INPUT_GUIDANCE}`,
  '</headless_turn>',
].join('\n');

export interface HeadlessUserInputResponse extends UserInputResponse {
  action: 'decline';
  message: string;
}

export function headlessDeclineResponse(): HeadlessUserInputResponse {
  return { action: 'decline', message: HEADLESS_USER_INPUT_GUIDANCE };
}

export function createHeadlessUserInputHandler(opts: {
  chat: Pick<ChatService, 'addMessage'>;
  threadId: string;
  activeAdapters?: Map<string, ActiveAdapter>;
}): UserInputHandler {
  return async (request: UserInputRequest): Promise<UserInputResponse> => {
    opts.chat.addMessage(
      opts.threadId,
      'user_input_request',
      JSON.stringify(request),
      null,
      request.requestId,
    );
    const response = headlessDeclineResponse();
    opts.chat.addMessage(
      opts.threadId,
      'user_input_response',
      JSON.stringify(response),
      null,
      request.requestId,
    );
    // A live-join from the app (the thread is a normal thread) must not get an
    // interactive card for a question the route has already answered.
    if (opts.activeAdapters) {
      markUserInputResolvedInReplay(opts.activeAdapters, request.requestId, response);
    }
    return response;
  };
}
