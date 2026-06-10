import type { PageContent, PageNode, PageSearchHit, TodoCounts, TodoHit } from '../../shared/types.js';
import type { PluginActivationState } from '../../shared/plugin-host/types.js';
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
import { ApiError, handle, apiFetch } from './api-core.js';

export { ApiError, handle };

// Re-exports for backward compat — per-entity API clients live in
// src/client/entities/{type}/api.ts (M13 plugin-slice rule).
export { endpointsApi } from '../entities/endpoint/api.js';
export { dtosApi } from '../entities/dto/api.js';
export {
  databaseTablesApi,
  type DatabaseTableWithWarnings,
} from '../entities/database-table/api.js';
export { uiViewsApi, type UiViewWithWarnings } from '../entities/ui-view/api.js';

export const api = {
  async tree(): Promise<PageNode[]> {
    const res = await apiFetch('/api/pages');
    const data = await handle<{ tree: PageNode[] }>(res);
    return data.tree;
  },

  async search(q: string, limit = 50): Promise<PageSearchHit[]> {
    const params = new URLSearchParams({ q });
    if (limit !== 50) params.set('limit', String(limit));
    const res = await apiFetch(`/api/pages/search?${params.toString()}`);
    const data = await handle<{ hits: PageSearchHit[] }>(res);
    return data.hits;
  },

  async read(path: string): Promise<PageContent> {
    const res = await apiFetch(`/api/pages/${encodePath(path)}`);
    return handle<PageContent>(res);
  },

  async write(path: string, body: string, frontmatter?: Record<string, unknown>): Promise<PageContent> {
    const res = await apiFetch(`/api/pages/${encodePath(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, frontmatter }),
    });
    return handle<PageContent>(res);
  },

  async remove(path: string): Promise<void> {
    const res = await apiFetch(`/api/pages/${encodePath(path)}`, { method: 'DELETE' });
    await handle<{ ok: true }>(res);
  },
};

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

export interface ConfigResponse {
  name: string;
  pagesDir: string;
  writingStyle: string | null;
  /** 0.1.51: spec-authoring language (display name from SUPPORTED_LANGUAGES) or null. */
  language: string | null;
  onboarding: { completed: boolean };
  /** M21: catalog of brief files. */
  briefsDir: string;
  /** M23: catalog of patch files. */
  patchesDir: string;
  /** M29/M31: committed entity JSON files dir (source of truth; SQLite is derived). */
  entitiesDir: string;
  /** M13: whitelist of active entity-plugin types; undefined = all registered active. */
  entities?: string[];
  /** M26: hot-reload Claude agent flags. 0.1.51 adds conversationalLanguage. */
  agent: { claudeUsePreset: boolean; conversationalLanguage: string | null };
  /** M28: hot-reload git-sync toggles (always resolved; both default false). */
  git: { syncCommitOnRelease: boolean; syncPushOnPush: boolean };
  /** M25: UUID of this project on the remote; null ⇒ next push is a first push. */
  remoteProjectId: string | null;
  /** M24: explicit remote-API override; null = production constant. UI hides this. */
  remoteApiUrl: string | null;
  /** M01: config schema version (currently 3 — M31 moved port/mode to the workspace). */
  $schemaVersion: number;
}

export interface ConfigPatch {
  name?: string;
  pagesDir?: string;
  briefsDir?: string;
  patchesDir?: string;
  entitiesDir?: string;
  writingStyle?: string | null;
  /** 0.1.51: spec-authoring language; null or a SUPPORTED_LANGUAGES member. */
  language?: string | null;
  onboardingCompleted?: boolean;
  entities?: string[];
  /** 0.1.51: agent.conversationalLanguage deep-merged server-side (preserves claudeUsePreset). */
  agent?: { claudeUsePreset?: boolean; conversationalLanguage?: string | null };
  /** M28: hot-reload — deep-merged server-side, so one toggle can be sent alone. */
  git?: { syncCommitOnRelease?: boolean; syncPushOnPush?: boolean };
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

export interface WritingStyleItem {
  slug: string;
  title: string;
  description: string;
  version: number;
  language: string;
  /** `bundled` = in-package; `user` = from a `.claude/skills` root (project or global). */
  source: 'bundled' | 'user';
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

export const metaApi = {
  async entities(): Promise<PluginActivationState> {
    return handle<PluginActivationState>(await apiFetch('/api/_meta/entities'));
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
