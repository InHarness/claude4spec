/**
 * Shared HTTP error class + response handler used by every API client
 * (cross-cutting + per-entity slices). Lives in lib/ because it is a
 * primitive, not an entity-bound concern.
 */

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
