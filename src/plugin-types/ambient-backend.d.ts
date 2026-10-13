/**
 * Ambient binding for the runtime value specifiers `@c4s/plugin-runtime` and
 * `@c4s/plugin-runtime/ui` — the BACKEND leg (2.1.20, M33 `m33l11sc` /
 * `m33rt001`). Its twin for plugin frontend code is `./ambient.d.ts`.
 *
 * Reached through the same subpath, `@inharness-ai/claude4spec/plugin-runtime/ambient`,
 * by the tsconfig that compiles a plugin's BACKEND code with
 * `"customConditions": ["c4s-backend"]` — the package's `exports` routes that
 * condition here.
 *
 * The backend leg is React-free: every TYPE name of the published surface is
 * re-exported, but a VALUE only when the Node barrel serves it — the backend
 * leg's names in `shared/plugin-host/runtime-legs.ts` (the MCP facade, `z`, the
 * validators, the content helpers, `TOOL_RESULT_CEILING_TOKENS`, `DomainError`,
 * and `HOST_API_VERSION`, the one value both legs carry). On `/ui` the backend
 * leg serves `UI_KIT_STABLE_COMPONENTS` alone: the components are browser-only.
 * A test holds the value lists equal to the leg inventory.
 *
 * A SCRIPT file shipped verbatim, like `./ambient.d.ts` (see there).
 */

declare module '@c4s/plugin-runtime' {
  export type * from '@inharness-ai/claude4spec/plugin-runtime';
  export {
    HOST_API_VERSION,
    createMcpServer,
    mcpTool,
    z,
    checkValidator,
    validatorMessage,
    contentBytes,
    DEFAULT_CONTENT_OPERATION,
    TOOL_RESULT_CEILING_TOKENS,
    DomainError,
  } from '@inharness-ai/claude4spec/plugin-runtime';
}

declare module '@c4s/plugin-runtime/ui' {
  export type * from '@inharness-ai/claude4spec/plugin-runtime/ui';
  export { UI_KIT_STABLE_COMPONENTS } from '@inharness-ai/claude4spec/plugin-runtime/ui';
}
