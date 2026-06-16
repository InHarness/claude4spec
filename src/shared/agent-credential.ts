/**
 * M05 chat-agent — DTOs for `/api/agent/credentials` (the user's own ANTHROPIC API
 * key). The API is write-only: it NEVER returns the raw key, only `{ isSet, last4 }`.
 */

/**
 * `GET /api/agent/credentials` and the response of `PUT` / `DELETE`. The masked
 * preview is rendered client-side as `sk-ant-…••••<last4>`.
 */
export interface AgentCredentialResponse {
  /** `true` when a credential row exists; `false` = local Claude Code login. */
  isSet: boolean;
  /** Last 4 chars of the key for the masked preview; `null` when `isSet` is false. */
  last4: string | null;
}

/** `PUT /api/agent/credentials` body. */
export interface SetAgentCredentialRequest {
  /** Raw key; non-empty + soft `sk-ant-` prefix check. Encrypted at-rest, never echoed. */
  anthropicApiKey: string;
}
