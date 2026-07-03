import type { PageContent, PageNode, PageSearchHit, Root, TodoCounts, TodoHit } from '../../shared/types.js';
import type { PluginActivationState } from '../../shared/plugin-host/types.js';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';
import type {
  PluginCommandContribution,
  PluginSettingsSection,
} from '../../shared/plugin-host/manifest.js';
import type {
  PageLinksAutocompleteResponse,
  PageLinksCounts,
  PageLinksListResponse,
} from '../../shared/page-links.js';
import type {
  EntityType,
  ReferenceHit,
  SectionIndexEntry,
  Tag,
  TagCreateInput,
  TagUpdateInput,
  VersionDetail,
  VersionListItem,
} from '../../shared/entities.js';
import type {
  DeviceLoginPollResponse,
  DeviceLoginStartResponse,
  RemoteAccountResponse,
} from '../../shared/remote-account.js';
import type {
  RemoteProjectInfo,
  UpdateRemoteProjectRequest,
} from '../../shared/remote-project.js';
import type {
  AgentCredentialResponse,
  SetAgentCredentialRequest,
} from '../../shared/agent-credential.js';
import { ApiError, handle, apiFetch } from './api-core.js';

export { ApiError, handle };

// Re-exports for backward compat — per-entity API clients live in
// src/client/entities/{type}/api.ts (M13 plugin-slice rule).
export { endpointsApi } from '../entities/endpoint/api.js';
export { dtosApi } from '../entities/dto/api.js';
// `database-table` API client moved to the preinstalled plugin
// `c4s-plugin-simple-database-tables` (its frontend owns the HTTP surface).
export { uiViewsApi, type UiViewWithWarnings } from '../entities/ui-view/api.js';
export {
  designSystemsApi,
  type DesignSystemWithWarnings,
} from '../entities/design-system/api.js';

// 0.1.96 multiroot: every page primitive is keyed by `(rootId, path)`. The
// server mounts the pages router under `/api/pages/:rootId`, so `rootId` is the
// first path segment for the tree/read/write/remove/search calls.
export const api = {
  async tree(rootId: string): Promise<PageNode[]> {
    const res = await apiFetch(`/api/pages/${encodeURIComponent(rootId)}`);
    const data = await handle<{ tree: PageNode[] }>(res);
    return data.tree;
  },

  async search(rootId: string, q: string, limit = 50): Promise<PageSearchHit[]> {
    const params = new URLSearchParams({ q });
    if (limit !== 50) params.set('limit', String(limit));
    const res = await apiFetch(`/api/pages/${encodeURIComponent(rootId)}/search?${params.toString()}`);
    const data = await handle<{ hits: PageSearchHit[] }>(res);
    return data.hits;
  },

  async read(rootId: string, path: string): Promise<PageContent> {
    const res = await apiFetch(`/api/pages/${encodeURIComponent(rootId)}/${encodePath(path)}`);
    return handle<PageContent>(res);
  },

  async write(
    rootId: string,
    path: string,
    body: string,
    frontmatter?: Record<string, unknown>,
  ): Promise<PageContent> {
    const res = await apiFetch(`/api/pages/${encodeURIComponent(rootId)}/${encodePath(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, frontmatter }),
    });
    return handle<PageContent>(res);
  },

  async remove(rootId: string, path: string): Promise<void> {
    const res = await apiFetch(`/api/pages/${encodeURIComponent(rootId)}/${encodePath(path)}`, {
      method: 'DELETE',
    });
    await handle<{ ok: true }>(res);
  },
};

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

export interface ConfigResponse {
  name: string;
  /** 0.1.96 multiroot: replaces the single `pagesDir`. The mandatory `'pages'` root is always roots[0]. */
  roots: Root[];
  writingStyle: string | null;
  /** 0.1.51: spec-authoring language (display name from SUPPORTED_LANGUAGES) or null. */
  language: string | null;
  /** 0.1.58: local one-line "elevator pitch" (0–200); surfaced to peer agents. */
  description: string | null;
  onboarding: { completed: boolean };
  /** M21: catalog of brief files. */
  briefsDir: string;
  /** M23: catalog of patch files. */
  patchesDir: string;
  /** M29/M31: committed entity JSON files dir (source of truth; SQLite is derived). */
  entitiesDir: string;
  /** M13: whitelist of active entity-plugin types; undefined = all registered active. */
  entities?: string[];
  /** M26: hot-reload Claude agent flags. 0.1.51 adds conversationalLanguage; 0.1.90 adds FS path scope. */
  agent: {
    claudeUsePreset: boolean;
    conversationalLanguage: string | null;
    allowedPaths: string[];
    disallowedPaths: string[];
  };
  /** M28: hot-reload git-sync toggles (always resolved; both default false). */
  git: { syncCommitOnRelease: boolean; syncPushOnPush: boolean };
  /** M25: UUID of this project on the remote; null ⇒ next push is a first push. */
  remoteProjectId: string | null;
  /** M24: explicit remote-API override; null = production constant. UI hides this. */
  remoteApiUrl: string | null;
  /** M33 phase 3: per-plugin settings namespace (absent ⇒ {}). */
  plugins: Record<string, Record<string, unknown>>;
  /** M01: config schema version (0.1.96 bumped to 4 — pagesDir → roots[]). */
  $schemaVersion: number;
}

export interface ConfigPatch {
  name?: string;
  /** 0.1.96 multiroot: replaces `pagesDir`; a full roots array replaces the whole set server-side. */
  roots?: Root[];
  briefsDir?: string;
  patchesDir?: string;
  entitiesDir?: string;
  writingStyle?: string | null;
  /** 0.1.51: spec-authoring language; null or a SUPPORTED_LANGUAGES member. */
  language?: string | null;
  /** 0.1.58: local "elevator pitch" (0–200); null or empty clears it. */
  description?: string | null;
  onboardingCompleted?: boolean;
  entities?: string[];
  /** 0.1.51: agent.* deep-merged server-side (preserves untouched fields). 0.1.90 adds FS path scope. */
  agent?: {
    claudeUsePreset?: boolean;
    conversationalLanguage?: string | null;
    allowedPaths?: string[];
    disallowedPaths?: string[];
  };
  /** M28: hot-reload — deep-merged server-side, so one toggle can be sent alone. */
  git?: { syncCommitOnRelease?: boolean; syncPushOnPush?: boolean };
  /** M33 phase 3: plugin settings — deep-merged server-side per `plugins[<name>]`. */
  plugins?: Record<string, Record<string, unknown>>;
  remoteProjectId?: string | null;
}

export const configApi = {
  async get(): Promise<ConfigResponse> {
    return handle<ConfigResponse>(await apiFetch('/api/config'));
  },
  async patch(input: ConfigPatch): Promise<ConfigResponse> {
    return handle<ConfigResponse>(
      await apiFetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },
};

/**
 * M05 0.1.62 — the agent's own ANTHROPIC API key. Write-only: GET/PUT/DELETE all
 * return only `{ isSet, last4 }`; the raw key is never echoed. TanStack query key
 * `["agent-credentials"]`.
 */
export const agentCredentialsApi = {
  async get(): Promise<AgentCredentialResponse> {
    return handle<AgentCredentialResponse>(await apiFetch('/api/agent/credentials'));
  },
  async set(body: SetAgentCredentialRequest): Promise<AgentCredentialResponse> {
    return handle<AgentCredentialResponse>(
      await apiFetch('/api/agent/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  },
  async remove(): Promise<AgentCredentialResponse> {
    return handle<AgentCredentialResponse>(
      await apiFetch('/api/agent/credentials', { method: 'DELETE' }),
    );
  },
};

export interface WritingStyleItem {
  slug: string;
  title: string;
  description: string;
  version: number;
  language: string;
  /**
   * `bundled` = in-package; `user` = from a `.claude/skills` root (project or
   * global); `plugin` = contributed by a plugin package (M15 phase 2).
   */
  source: 'bundled' | 'user' | 'plugin';
}

export interface WritingStylesResponse {
  active: string | null;
  available: WritingStyleItem[];
}

export const writingStylesApi = {
  async get(): Promise<WritingStylesResponse> {
    return handle<WritingStylesResponse>(await apiFetch('/api/writing-styles'));
  },
};

export const tagsApi = {
  async list(): Promise<Tag[]> {
    const data = await handle<{ tags: Tag[] }>(await apiFetch('/api/tags'));
    return data.tags;
  },
  async create(input: TagCreateInput): Promise<Tag> {
    return handle<Tag>(
      await apiFetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },
  async update(slug: string, input: TagUpdateInput): Promise<Tag> {
    return handle<Tag>(
      await apiFetch(`/api/tags/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },
  async remove(slug: string): Promise<{ deleted: true; affectedEntities: number }> {
    return handle<{ deleted: true; affectedEntities: number }>(
      await apiFetch(`/api/tags/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },
  async assign(type: EntityType, slug: string, tags: string[]): Promise<string[]> {
    const data = await handle<{ tags: string[] }>(
      await apiFetch(`/api/entities/${type}/${encodeURIComponent(slug)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      })
    );
    return data.tags;
  },
};

export const referencesApi = {
  async find(type: EntityType, slug: string): Promise<ReferenceHit[]> {
    const params = new URLSearchParams({ type, slug });
    const data = await handle<{ references: ReferenceHit[] }>(
      await apiFetch(`/api/references?${params.toString()}`)
    );
    return data.references;
  },
};

export const pageLinksApi = {
  async list(): Promise<PageLinksListResponse> {
    return handle<PageLinksListResponse>(await apiFetch('/api/page-links'));
  },
  async counts(): Promise<PageLinksCounts> {
    return handle<PageLinksCounts>(await apiFetch('/api/page-links/counts'));
  },
  async autocomplete(q: string, limit = 10): Promise<PageLinksAutocompleteResponse> {
    const params = new URLSearchParams({ q });
    if (limit !== 10) params.set('limit', String(limit));
    return handle<PageLinksAutocompleteResponse>(
      await apiFetch(`/api/page-links/autocomplete?${params.toString()}`)
    );
  },
};

export const todosApi = {
  async list(): Promise<{ todos: TodoHit[]; counts: TodoCounts }> {
    return handle<{ todos: TodoHit[]; counts: TodoCounts }>(await apiFetch('/api/todos'));
  },
  async counts(): Promise<TodoCounts> {
    return handle<TodoCounts>(await apiFetch('/api/todos/counts'));
  },
};

export const versionsApi = {
  async list(type: EntityType, slug: string): Promise<VersionListItem[]> {
    const data = await handle<{ versions: VersionListItem[] }>(
      await apiFetch(`/api/entities/${type}/${encodeURIComponent(slug)}/versions`)
    );
    return data.versions;
  },
  async get(type: EntityType, slug: string, version: number): Promise<VersionDetail> {
    return handle<VersionDetail>(
      await apiFetch(`/api/entities/${type}/${encodeURIComponent(slug)}/versions/${version}`)
    );
  },
};

/** One package row in the per-project `/_meta/plugins` diagnostics (M33 phase 2). */
export interface PluginPackageRecord {
  package: string;
  status: 'loaded' | 'skipped' | 'failed';
  code?: string;
  reason?: string;
  manifestName?: string;
  manifestVersion?: string;
  contributedTypes?: string[];
  layer?: 'base' | 'overlay';
  trust?: 'trusted' | 'untrusted';
  origin?: string;
}

/** Per-project plugin diagnostics: base ∪ overlay packages + trust + shadow report. */
export interface ProjectPluginsMeta {
  hostApiVersion: string;
  localPluginsPresent: boolean;
  trust: boolean | undefined;
  packages: PluginPackageRecord[];
  shadowed: { type: string; overlayOrigin: string; baseOrigin: string }[];
}

export const metaApi = {
  async entities(): Promise<PluginActivationState> {
    return handle<PluginActivationState>(await apiFetch('/api/_meta/entities'));
  },
  /** M33 phase 2: per-project plugin pool (base/overlay), trust, shadowed types. */
  async plugins(): Promise<ProjectPluginsMeta> {
    return handle<ProjectPluginsMeta>(await apiFetch('/api/_meta/plugins'));
  },
  /** M33 phase 3: Settings sections of loaded+trusted plugins (one per plugin). */
  async pluginSettings(): Promise<{ sections: PluginSettingsSection[] }> {
    return handle<{ sections: PluginSettingsSection[] }>(await apiFetch('/api/_meta/plugin-settings'));
  },
  /** M33 phase 3: declarative editor slash-commands of loaded+trusted plugins. */
  async pluginCommands(): Promise<{ commands: PluginCommandContribution[] }> {
    return handle<{ commands: PluginCommandContribution[] }>(await apiFetch('/api/_meta/plugin-commands'));
  },
  /** M33 phase 2: persist the project-local plugin trust decision (rebuilds the context). */
  async setTrustPlugins(trust: boolean): Promise<{ trust: boolean }> {
    return handle<{ trust: boolean }>(
      await apiFetch('/api/trust-plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trust }),
      }),
    );
  },
};

// M33: process-level plugin endpoints. These live on the workspace router (not
// per-project), so they use plain `fetch` — `apiFetch` would wrongly prepend the
// `/api/projects/<id>` prefix.
export const pluginsApi = {
  async frontendManifest(): Promise<FrontendManifestResponse> {
    return handle<FrontendManifestResponse>(await fetch('/api/plugins/frontend-manifest'));
  },
};

// M05 session-lock: a field frozen for the lifetime of a chat session. `path` is
// `'model'` or `'architectureConfig.<key>'`; `reason` is tooltip-ready.
export interface SessionResumeConstraint {
  path: string;
  reason: string;
}

export interface ChatConfigResponse {
  architectures: Record<string, { models: string[]; default: string }>;
  defaultArchitecture: string;
  sessionResumeConstraints: SessionResumeConstraint[];
}

export const chatConfigApi = {
  async get(): Promise<ChatConfigResponse> {
    return handle<ChatConfigResponse>(await apiFetch('/api/chat/config'));
  },
};

export const sectionsApi = {
  async list(query: { pagePath?: string; search?: string } = {}): Promise<SectionIndexEntry[]> {
    const params = new URLSearchParams();
    if (query.pagePath) params.set('pagePath', query.pagePath);
    if (query.search) params.set('search', query.search);
    const qs = params.toString();
    const res = await apiFetch(`/api/sections${qs ? `?${qs}` : ''}`);
    const data = await handle<{ sections: SectionIndexEntry[] }>(res);
    return data.sections;
  },

  async getByAnchor(anchor: string): Promise<SectionIndexEntry | null> {
    const res = await apiFetch(`/api/sections/${encodeURIComponent(anchor)}`);
    if (res.status === 404) return null;
    return handle<SectionIndexEntry>(res);
  },
};

export interface PlanAnchorRef {
  planId: number;
  threadId: string | null;
}

export const plansApi = {
  // Resolve a plan heading anchor to its plan, mirroring sectionsApi.getByAnchor.
  // The route returns the raw ref (no data envelope) or 404 → null.
  async getByAnchor(anchor: string): Promise<PlanAnchorRef | null> {
    const res = await apiFetch(`/api/plans/by-anchor/${encodeURIComponent(anchor)}`);
    if (res.status === 404) return null;
    return handle<PlanAnchorRef>(res);
  },
};

// M24 Remote Account. Login is a human action — no agent path. `access_token`
// is never present in any of these responses.
export const remoteAccountApi = {
  async get(): Promise<RemoteAccountResponse> {
    return handle<RemoteAccountResponse>(await apiFetch('/api/remote-account'));
  },
  async startLogin(): Promise<DeviceLoginStartResponse> {
    return handle<DeviceLoginStartResponse>(
      await apiFetch('/api/remote-account/login/start', { method: 'POST' }),
    );
  },
  async poll(): Promise<DeviceLoginPollResponse> {
    return handle<DeviceLoginPollResponse>(
      await apiFetch('/api/remote-account/login/poll', { method: 'POST' }),
    );
  },
  async logout(): Promise<RemoteAccountResponse> {
    return handle<RemoteAccountResponse>(
      await apiFetch('/api/remote-account/logout', { method: 'POST' }),
    );
  },
};

// M26 §4 — remote-project proxy (used by Settings → "Remote project" section).
export const remoteProjectApi = {
  async get(): Promise<RemoteProjectInfo> {
    return handle<RemoteProjectInfo>(await apiFetch('/api/remote-project'));
  },
  async update(body: UpdateRemoteProjectRequest): Promise<RemoteProjectInfo> {
    return handle<RemoteProjectInfo>(
      await apiFetch('/api/remote-project', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  },
};
