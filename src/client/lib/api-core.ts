/**
 * Shared HTTP error class + response handler used by every API client
 * (cross-cutting + per-entity slices). Lives in lib/ because it is a
 * primitive, not an entity-bound concern.
 *
 * M31: also owns the project-scoped API base. The server injects
 * `window.__C4S_PROJECT__` per `/p/<id>/` route; every project-scoped call
 * goes through `apiFetch`, which rewrites a leading `/api/` to
 * `/api/projects/<id>/`. Workspace-scope calls (`/api/workspace*`) and
 * absolute peer URLs use plain `fetch` and pass through untouched.
 */

/** Project id injected by the server into the served HTML (12 hex chars). */
export const PROJECT_ID: string =
  (typeof window !== 'undefined' && window.__C4S_PROJECT__?.id) || '';

/** Prefix for every project-scoped API call. */
export const API_BASE = PROJECT_ID ? `/api/projects/${PROJECT_ID}` : '/api';

/**
 * fetch() with the project prefix applied to relative `/api/…` inputs.
 * Absolute URLs (e.g. a peer `serverUrl` in chat hooks) pass through.
 */
export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (typeof input === 'string' && input.startsWith('/api/')) {
    return fetch(`${API_BASE}${input.slice('/api'.length)}`, init);
  }
  return fetch(input, init);
}

/**
 * Normalize a router pathname to the in-app route space, whether or not the
 * basepath (`/p/<id>`) is included — covers both TanStack `useLocation()`
 * semantics and raw `window.location.pathname`.
 */
export function stripBase(pathname: string): string {
  if (PROJECT_ID && pathname.startsWith(`/p/${PROJECT_ID}`)) {
    const rest = pathname.slice(`/p/${PROJECT_ID}`.length);
    return rest === '' ? '/' : rest;
  }
  return pathname;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** Full `error` envelope from the server — carries extras like `field` for 422. */
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } & Record<string, unknown> }
      | null;
    const message = body?.error?.message ?? res.statusText;
    const code = body?.error?.code ?? 'HTTP_ERROR';
    throw new ApiError(code, message, res.status, body?.error);
  }
  return res.json() as Promise<T>;
}
