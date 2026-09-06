import { apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';

/** One `module-dependency` record, as the generated REST router serves it. */
export interface ModuleDependency {
  slug: string;
  title: string;
  /** The module that requires. The entity carries this module's tag. */
  dependent: string;
  /** The module that is required from. Never a tag — always a filter. */
  provider: string;
  /** What flows. Never says between whom. */
  needs: string;
  tags?: string[];
}

/**
 * `/api/module-dependencies`, written in full here and WITHOUT `/api` in
 * `identity.ts`. The two are not in disagreement: the declaration names a mount
 * point on a router already sitting at `/api`, while this is a browser URL,
 * which `apiFetch` rewrites to `/api/projects/<id>/…`.
 */
const BASE = '/api/module-dependencies';

export async function fetchModuleDependency(slug: string): Promise<ModuleDependency | null> {
  const res = await apiFetch(`${BASE}/${encodeURIComponent(slug)}`);
  if (!res.ok) return null;
  return unwrap<ModuleDependency>(res);
}

/**
 * The `listByTags` slot's data call — a module's OUTGOING edges.
 *
 * Incoming edges are deliberately unreachable from here: they carry the OTHER
 * module's tag, so no tag query finds them. They are
 * `list_entities({ filters: { provider } })`, an agent-side read. Giving the
 * embed a second, silent way to pull them in would make one section show two
 * different relations under one heading.
 */
export async function listModuleDependenciesByTags(
  tags: string[],
  filter: 'and' | 'or' = 'or',
): Promise<ModuleDependency[]> {
  const params = new URLSearchParams();
  if (tags.length) params.set('tags', tags.join(','));
  params.set('tagFilter', filter);
  const res = await apiFetch(`${BASE}?${params.toString()}`);
  if (!res.ok) return [];
  return unwrapList<ModuleDependency>(res);
}
