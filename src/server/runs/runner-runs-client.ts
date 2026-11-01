import { hostEndpoint } from '../runner-hosts/host-input.js';
import type { RunRequest } from './run-request.js';

/**
 * M55 `veec5qxa` — the shared mapping of runner responses on the Runs API
 * paths. The runner's `code` decides, never the HTTP status (M54 `o0qdti8z`);
 * the canonical meanings are `c4s-runner` `modules/M03-control-channel.md`
 * #hokfviej.
 *
 * | runner answer                       | code                       |
 * | `401 unauthenticated`               | `RUN_HOST_UNAUTHENTICATED` |
 * | `500 internal`, any unknown `code`  | `RUN_HOST_ERROR`           |
 * | no connection                       | `RUN_HOST_UNREACHABLE`     |
 * | `404 not_found` (host without runs) | `RUN_HOST_WITHOUT_RUNS`    |
 *
 * Operation-specific codes (`invalid_request`, `conflict` on `PUT`) are mapped
 * by the operation before it falls back on this table.
 */
export type RunnerSharedCode = 'RUN_HOST_UNAUTHENTICATED' | 'RUN_HOST_ERROR' | 'RUN_HOST_UNREACHABLE' | 'RUN_HOST_WITHOUT_RUNS';

export function mapRunnerApiCode(code: unknown): Exclude<RunnerSharedCode, 'RUN_HOST_UNREACHABLE'> {
  if (code === 'unauthenticated') return 'RUN_HOST_UNAUTHENTICATED';
  if (code === 'not_found') return 'RUN_HOST_WITHOUT_RUNS';
  return 'RUN_HOST_ERROR';
}

/** `c4s-runner` dto `api-error`, as far as the master reads it. */
export interface RunnerApiError {
  code: string | null;
  message: string | null;
  field: string | null;
}

/** The outcome of one `PUT /runs/{runId}`. */
export type PutRunOutcome =
  /** The host accepted the order (`202`, or `200` for an identical repeat). */
  | { kind: 'accepted'; status: number }
  /** The host answered with an error body. */
  | { kind: 'error'; status: number; error: RunnerApiError }
  /** The order may not have reached the host: no connection, no answer in time. */
  | { kind: 'network'; message: string };

export interface RunnerHostAddress {
  url: string;
  token: string;
}

export type PutRun = (host: RunnerHostAddress, runId: string, body: RunRequest) => Promise<PutRunOutcome>;

/** Total budget of the `PUT` (status, headers and body). */
export const PUT_RUN_TIMEOUT_MS = 15_000;

function parseApiError(text: string): RunnerApiError {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    return {
      code: typeof body.code === 'string' ? body.code : null,
      message: typeof body.message === 'string' ? body.message : null,
      field: typeof body.field === 'string' ? body.field : null,
    };
  } catch {
    return { code: null, message: null, field: null };
  }
}

type RunnerAnswer =
  | { kind: 'answered'; ok: true; status: number; text: string }
  | { kind: 'answered'; ok: false; status: number; error: RunnerApiError }
  | { kind: 'network'; message: string };

/**
 * One bearer request to a runner host, never retried, redirects not followed.
 * The token goes in the `Authorization` header only: it is redacted from a
 * network error's message and from an error body's `message`.
 */
async function requestRunner(
  host: RunnerHostAddress,
  method: 'GET' | 'POST' | 'PUT',
  pathname: string,
  timeoutMs: number,
  body?: unknown,
): Promise<RunnerAnswer> {
  const redact = (text: string): string => text.split(host.token).join('[redacted]');
  let res: Response;
  let text: string;
  try {
    res = await fetch(hostEndpoint(host.url, pathname), {
      method,
      redirect: 'manual',
      headers:
        body === undefined
          ? { authorization: `Bearer ${host.token}`, accept: 'application/json' }
          : { authorization: `Bearer ${host.token}`, 'content-type': 'application/json', accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    return { kind: 'network', message: redact(err instanceof Error ? err.message : String(err)) };
  }
  if (res.status >= 200 && res.status < 300) return { kind: 'answered', ok: true, status: res.status, text };
  const error = parseApiError(text);
  if (error.message) error.message = redact(error.message);
  return { kind: 'answered', ok: false, status: res.status, error };
}

/**
 * `c4s-runner` endpoint `put-runs-run-id`: one `PUT`, never retried here (the
 * operation does not retry on its own). The token goes in the `Authorization`
 * header only and never into a message.
 */
export const putRunOverHttp: PutRun = async (host, runId, body) => {
  const answer = await requestRunner(host, 'PUT', `/runs/${encodeURIComponent(runId)}`, PUT_RUN_TIMEOUT_MS, body);
  if (answer.kind !== 'answered') return answer;
  if (answer.ok) return { kind: 'accepted', status: answer.status };
  return { kind: 'error', status: answer.status, error: answer.error };
};

/**
 * The outcome of one `GET /runs/{runId}` or `POST /runs/{runId}/cancel`: the
 * parsed body of a `2xx` (`c4s-runner` dto `run`, checked by the caller), an
 * error body, or no answer.
 */
export type RunnerRunOutcome =
  | { kind: 'ok'; status: number; body: unknown }
  | { kind: 'error'; status: number; error: RunnerApiError }
  | { kind: 'network'; message: string };

/** One call on an existing Run (`get_run`, `cancel_run`). */
export type RunnerRunCall = (host: RunnerHostAddress, runId: string) => Promise<RunnerRunOutcome>;

/** Total budget of a read or a cancel. */
export const RUN_CALL_TIMEOUT_MS = 15_000;

async function callRun(host: RunnerHostAddress, method: 'GET' | 'POST', pathname: string): Promise<RunnerRunOutcome> {
  const answer = await requestRunner(host, method, pathname, RUN_CALL_TIMEOUT_MS);
  if (answer.kind !== 'answered') return answer;
  if (!answer.ok) return { kind: 'error', status: answer.status, error: answer.error };
  let body: unknown = null;
  try {
    body = JSON.parse(answer.text);
  } catch {
    body = null;
  }
  return { kind: 'ok', status: answer.status, body };
}

/** `c4s-runner` endpoint `get-runs-run-id`. */
export const getRunOverHttp: RunnerRunCall = (host, runId) => callRun(host, 'GET', `/runs/${encodeURIComponent(runId)}`);

/** `c4s-runner` endpoint `post-runs-run-id-cancel` — idempotent on the runner's side. */
export const cancelRunOverHttp: RunnerRunCall = (host, runId) =>
  callRun(host, 'POST', `/runs/${encodeURIComponent(runId)}/cancel`);
