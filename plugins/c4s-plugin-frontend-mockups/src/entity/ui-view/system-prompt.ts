import type { SystemPromptContribution } from '@c4s/plugin-runtime';

export const uiViewSystemPrompt: SystemPromptContribution = {
  roleNoun: 'UI views',
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // ui-view has no custom (non-CRUD) tools, so mcpToolsLine is omitted.
  narrativeBlock:
    'UI views (screen-level) — title, url, params (path/query/hash). A view may carry an HTML ' +
    'mockup in `mockupHtml` — a content-bearing field: reads never emit it, fetch it with ' +
    'get_field_content. Plus tags.',
};
