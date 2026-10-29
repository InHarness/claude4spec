/**
 * M54 — what the supervisor concludes from one observation of a runner host:
 * the closed set of statuses (`nbpe2o7c`, `hzcwlgln`, `spxxz1ph`), the order of
 * the response checks (`o0qdti8z`), `lastError` and its strings (`npul32ax`),
 * the token scrub (`qc6t2y7m`) and the event-stream framing of the runner's
 * channel (`c4s-runner` `modules/M03-control-channel.md` #30ufu17m, block
 * "Strumienie"). Pure functions — no I/O, no clock.
 */

import type { RunnerHostStatus } from '../../shared/runner-hosts.js';

/** The closed set of ten statuses, as they leave through the API (column "Wartość `status`"). */
export type { RunnerHostStatus };

/** The statuses retried with backoff (`hzcwlgln`); every other failure waits for the user (`spxxz1ph`). */
export const RETRIED_STATUSES: ReadonlySet<RunnerHostStatus> = new Set(['unreachable', 'retrying', 'stopped']);

/** The control-protocol version this master knows (`c4s-runner` `modules/M03-control-channel.md` #yxmpqppi). */
export const KNOWN_PROTOCOL = 1;

/** `npul32ax`: the last error, in the supervisor's memory only. */
export interface RunnerHostLastError {
  code: string;
  message: string;
}

/** A failed stage of an attempt or of a live stream: the status it gives and its `lastError`. */
export interface RunnerHostFailure {
  status: Exclude<RunnerHostStatus, 'connecting' | 'connected'>;
  error: RunnerHostLastError;
}

/** HostInfo as the binding needs it (`c4s-runner` dto `host-info`). */
export interface HostInfo {
  hostId: string;
  name: string;
  runnerVersion: string;
  protocol: number;
  startedAt: string;
}

// `npul32ax` — the module's own strings for a classification without `ApiError`.
// ASSUMPTION:dev-5402 — the `code` that goes with them (`redirect`, `not_found`,
// `http_<status>`, `invalid_host_info`, `tls`, `unreachable`, …) and the texts of
// the cases the section names no string for are this module's choice.
export const MSG_NOT_FOUND = 'Base URL does not point to a c4s-runner control API.';
export const MSG_REDIRECT = 'Redirect received — this address is not a c4s-runner control API.';
export const MSG_INVALID_HOST_INFO = 'Response is not valid c4s-runner HostInfo.';
export const msgUnexpectedHttp = (status: number) => `Unexpected HTTP ${status} — probably a proxy, not c4s-runner.`;
export const msgTls = (reason: string) => `TLS error: ${reason.replace(/\.+$/, '')}.`;

const REDACTED = '[redacted]';

/**
 * `qc6t2y7m`: a host's error text is scrubbed of every occurrence of this
 * host's own token before it reaches `lastError` or a log — a second line of
 * defence, the runner promises a text without it.
 */
export function scrubToken(text: string, token: string | null): string {
  if (!token) return text;
  return text.split(token).join(REDACTED);
}

export function scrubError(error: RunnerHostLastError, token: string | null): RunnerHostLastError {
  return { code: scrubToken(error.code, token), message: scrubToken(error.message, token) };
}

/** `c4s-runner` dto `api-error`: `{ code, message }`, both strings. */
function parseApiError(body: string): RunnerHostLastError | null {
  try {
    const value = JSON.parse(body) as unknown;
    if (value && typeof value === 'object') {
      const { code, message } = value as Record<string, unknown>;
      if (typeof code === 'string' && typeof message === 'string') return { code, message };
    }
  } catch {
    // not an ApiError
  }
  return null;
}

/**
 * `o0qdti8z` step 1, the HTTP status — classified by the status, never by the
 * `code` of an `ApiError` (a new runner code does not change the status).
 * `null` = 200, the checks go on. With an `ApiError` body `lastError` carries
 * its code and its scrubbed text (`npul32ax`), otherwise the module's string.
 */
export function classifyHttpStatus(statusCode: number, body: string, token: string | null): RunnerHostFailure | null {
  if (statusCode === 200) return null;
  const apiError = parseApiError(body);
  const fail = (status: RunnerHostFailure['status'], fallback: RunnerHostLastError): RunnerHostFailure => ({
    status,
    error: scrubError(apiError ?? fallback, token),
  });
  if (statusCode >= 300 && statusCode < 400) return fail('bad-response', { code: 'redirect', message: MSG_REDIRECT });
  // `75pb3ugi`: 401 is never retried automatically.
  if (statusCode === 401) {
    return fail('token-rejected', { code: 'unauthenticated', message: 'The runner host rejected the token.' });
  }
  if (statusCode === 404) return fail('bad-response', { code: 'not_found', message: MSG_NOT_FOUND });
  // 500 from the runner, and other 5xx (502/503/504 from a proxy) — retried (`hzcwlgln`).
  if (statusCode >= 500) {
    return fail('retrying', { code: `http_${statusCode}`, message: `The runner host answered HTTP ${statusCode}.` });
  }
  // Other 4xx — and any other non-200 the contract never sends.
  return fail('bad-response', { code: `http_${statusCode}`, message: msgUnexpectedHttp(statusCode) });
}

const invalidHostInfo = (): RunnerHostFailure => ({
  status: 'bad-response',
  error: { code: 'invalid_host_info', message: MSG_INVALID_HOST_INFO },
});

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * `o0qdti8z` steps 2–4 on a HostInfo (the body of `GET /host`, or the data of a
 * `host` event): presence and type of `protocol` → its value → completeness.
 * `protocol` goes before completeness: a runner of another version may have
 * other remaining fields and gets `protocol-mismatch`, not `bad-response`.
 * Unknown fields are ignored (`i084ojn6`). The `hostId` step is the
 * supervisor's — it needs the binding.
 */
export function checkHostInfo(value: unknown): { ok: true; info: HostInfo } | { ok: false; failure: RunnerHostFailure } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, failure: invalidHostInfo() };
  const v = value as Record<string, unknown>;
  if (typeof v.protocol !== 'number' || !Number.isInteger(v.protocol)) return { ok: false, failure: invalidHostInfo() };
  if (v.protocol !== KNOWN_PROTOCOL) {
    return {
      ok: false,
      failure: {
        status: 'protocol-mismatch',
        error: {
          code: 'protocol_mismatch',
          message: `The runner host speaks control protocol ${v.protocol}; this server knows protocol ${KNOWN_PROTOCOL}.`,
        },
      },
    };
  }
  if (![v.hostId, v.name, v.runnerVersion, v.startedAt].every(nonEmptyString)) {
    return { ok: false, failure: invalidHostInfo() };
  }
  return {
    ok: true,
    info: {
      hostId: v.hostId as string,
      name: v.name as string,
      runnerVersion: v.runnerVersion as string,
      protocol: v.protocol,
      startedAt: v.startedAt as string,
    },
  };
}

/** A HostInfo carried as JSON text (`GET /host` body, `host` event data). */
export function checkHostInfoText(text: string): ReturnType<typeof checkHostInfo> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, failure: invalidHostInfo() };
  }
  return checkHostInfo(value);
}

/** The first event of a stream that is not a `host` event (`spxxz1ph`, `bad-response`). */
export function firstEventNotHost(): RunnerHostFailure {
  return invalidHostInfo();
}

/** One dispatched event of a `text/event-stream`: its name and its data. */
export interface StreamEvent {
  event: string;
  data: string;
}

/**
 * The most a host may make the supervisor hold of one of its answers: the body
 * of `GET /host` (or of an error), and on the event stream the pending line
 * plus the event being assembled. A host sends far less; more is no answer.
 */
export const MAX_HOST_TEXT = 64 * 1024;

/** The event stream exceeded `MAX_HOST_TEXT` without dispatching — closed as a broken stream (`retrying`). */
export function streamOverflow(): RunnerHostFailure {
  return {
    status: 'retrying',
    error: {
      code: 'stream_overflow',
      message: `The event stream sent more than ${MAX_HOST_TEXT / 1024} KiB without completing an event.`,
    },
  };
}

/**
 * Incremental `text/event-stream` parser: the event name in the `event` field,
 * its data in `data` (several `data` lines join with `\n`), comments ignored, a
 * blank line dispatches. An event without data is not dispatched. What it holds
 * between chunks (the unfinished line and the event being assembled) is capped
 * at `MAX_HOST_TEXT` characters: past it `overflowed` turns true and the parser
 * dispatches nothing more — the caller closes the stream.
 */
export class EventStreamParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private dataSize = 0;
  overflowed = false;

  push(chunk: string): StreamEvent[] {
    if (this.overflowed) return [];
    this.buffer += chunk;
    const out: StreamEvent[] = [];
    // A `\r` at the very end may be the first half of a `\r\n` — keep it for the next chunk.
    let usable = this.buffer;
    let keep = '';
    if (usable.endsWith('\r')) {
      usable = usable.slice(0, -1);
      keep = '\r';
    }
    const lines = usable.split(/\r\n|\r|\n/);
    this.buffer = (lines.pop() ?? '') + keep;
    for (const line of lines) {
      if (line === '') {
        if (this.data.length > 0) out.push({ event: this.event || 'message', data: this.data.join('\n') });
        this.event = '';
        this.data = [];
        this.dataSize = 0;
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this.event = value;
      else if (field === 'data') {
        this.data.push(value);
        this.dataSize += value.length + 1;
      }
    }
    if (this.buffer.length + this.event.length + this.dataSize > MAX_HOST_TEXT) {
      this.overflowed = true;
      this.buffer = '';
      this.event = '';
      this.data = [];
      this.dataSize = 0;
    }
    return out;
  }
}
