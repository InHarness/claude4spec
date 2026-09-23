/**
 * 0.2.108 — the ONE place that names the turn's models.
 *
 * `DEFAULT_MODEL` is the default for every channel (chat, headless `ask`, MCP
 * `ask`, CLI `--model`), resolved in `runAgent` as `params.model ?? DEFAULT_MODEL`.
 * The literal lives only under `src/core/agent/`; everyone else imports it.
 *
 * `SELECTABLE_MODELS` is the server's contract, not picker cosmetics: a deliberately
 * NARROWED subset of the adapter catalog, strongest first. An alias the catalog still
 * knows (and does not mark retired) is still not selectable unless it is listed here —
 * `opus-5` is the case in point, we only show the newest Opus generation. The server
 * exposes the list, with its metadata, from `GET /api/chat/config` and refuses any other
 * alias with `400` before a turn is dispatched; clients render it as received.
 *
 * No import from `@inharness-ai/agent-adapters` here: the CLI loads this module, and the
 * package's main entry pulls the agent runtime. The per-alias metadata (resolved id,
 * adaptive class, context window) is computed server-side in `server/routes/models.ts`.
 */
export const DEFAULT_MODEL = 'opus-5.5';

export const SELECTABLE_MODELS = ['fable-5.1', 'opus-5.5', 'sonnet-5', 'haiku-4.5'] as const;
export type SelectableModel = (typeof SELECTABLE_MODELS)[number];

export const isSelectableModel = (alias: unknown): alias is SelectableModel =>
  typeof alias === 'string' && (SELECTABLE_MODELS as readonly string[]).includes(alias);
