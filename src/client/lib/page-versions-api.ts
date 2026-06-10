import { handle, apiFetch } from './api-core.js';

export interface PageVersionListItemClient {
  id: number;
  path: string;
  version: number;
  op: 'create' | 'update' | 'delete';
  changedBy: 'user' | 'agent' | 'filesystem';
  releaseId: number | null;
  serializerVersion: string;
  createdAt: string;
}

export interface PageVersionDetailClient extends PageVersionListItemClient {
  data: {
    path: string;
    content: string;
    frontmatter: Record<string, unknown>;
    anchors: string[];
    xml_refs: Array<{ tagType: string; attributes: Record<string, string>; position: number }>;
  };
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

export const pageVersionsApi = {
  async list(path: string): Promise<PageVersionListItemClient[]> {
    const res = await apiFetch(`/api/pages/${encodePath(path)}?versions=true`);
    const data = await handle<{ path: string; versions: PageVersionListItemClient[] }>(res);
    return data.versions;
  },
  async get(path: string, version: number): Promise<PageVersionDetailClient> {
    const res = await apiFetch(
      `/api/pages/${encodePath(path)}?versionDetail=${encodeURIComponent(String(version))}`,
    );
    return handle<PageVersionDetailClient>(res);
  },
};
