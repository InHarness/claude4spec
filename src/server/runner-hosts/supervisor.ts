import { decrypt } from '../services/agent-credential-crypto.js';
import {
  checkHostInfoText,
  classifyHttpStatus,
  firstEventNotHost,
  msgTls,
  RETRIED_STATUSES,
  scrubError,
  scrubToken,
  streamOverflow,
  type HostInfo,
  type RunnerHostFailure,
  type RunnerHostLastError,
  type RunnerHostStatus,
} from './host-checks.js';
import {
  AttemptAborted,
  HostEventStream,
  HostTransportError,
  readBody,
  realClock,
  sendRequest,
  type SupervisorClock,
} from './host-client.js';
import { hostEndpoint, RunnerHostError } from './host-input.js';
import type {
  AddRunnerHostInput,
  RunnerHostBinding,
  RunnerHostRecord,
  RunnerHostStore,
  UpdateRunnerHostInput,
} from './host-records.js';

/**
 * M54 `m9e73y05`, `tc3bz2eq`, `mzbcfo0y` — the timings of the module. Every one
 * is a fact of the module (`40kett5w`), not of the runner contract.
 */
export const SUPERVISOR_TIMINGS = {
  /** TCP connection of a single request. */
  connectMs: 2_000,
  /** Status and headers from sending the request; on a stream also the first `host` event. */
  headersMs: 3_000,
  /** No event for this long closes the stream as a break. */
  livenessMs: 20_000,
  /** Total budget of a synchronous attempt (add, test without a live subscription). */
  syncBudgetMs: 15_000,
  /** A test next to a live stream: `GET /host` alone. */
  liveTestMs: 5_000,
  backoffMinMs: 1_000,
  backoffMaxMs: 60_000,
  /** Uninterrupted `connected` for this long resets the backoff. */
  backoffResetMs: 30_000,
} as const;

/** `nbpe2o7c`, `i084ojn6`, `4pxwyo22`: the state of one host, in the supervisor's memory only — never in a file. */
export interface RunnerHostState {
  status: RunnerHostStatus;
  /** ISO-8601: entering the current status. */
  statusSince: string;
  /** ISO-8601 of the stream's last event. */
  lastEventAt: string | null;
  lastError: RunnerHostLastError | null;
  /** ISO-8601 of the runner restart seen last (same `hostId`, other `startedAt`); `null` after every binding change. */
  restartedAt: string | null;
}

/** One supervised host: its record (configuration + binding, as stored) and its state. */
export interface RunnerHostView {
  record: RunnerHostRecord;
  state: RunnerHostState;
}

export interface TestRunnerHostOptions {
  /** Explicit consent to store a new binding when the host answers with another `hostId`. */
  rebind?: boolean;
}

export interface RunnerHostSupervisorOptions {
  /** The record store (writes of a record and of its binding). */
  store: RunnerHostStore;
  /**
   * The records of this process's workspace VIEW (M31 `ssn335r8`): a record
   * another process adds is not supervised before this process restarts (`k5gwlckc`).
   */
  records: RunnerHostRecord[];
  clock?: SupervisorClock;
  /** `[0, 1)` — the backoff's random spread. */
  random?: () => number;
}

interface Supervised {
  record: RunnerHostRecord;
  state: RunnerHostState;
  /** Bumped by every teardown: an attempt or a stream loop of an older epoch never touches the state. */
  epoch: number;
  abort: AbortController | null;
  stream: HostEventStream | null;
  retryTimer: unknown;
  stableTimer: unknown;
  /** Failed retries since the last backoff reset. */
  retries: number;
  /** `hzcwlgln`: `stopped` holds through failed retries until the first successful connection. */
  stopped: boolean;
}

const copyRecord = (r: RunnerHostRecord): RunnerHostRecord => ({ ...r, binding: r.binding ? { ...r.binding } : null });

/**
 * M54 — the workspace-level supervisor of runner hosts (L10 `i58ogfc2`: one per
 * process, no key, created eagerly before listen, released explicitly at
 * process shutdown). For each record it runs the attempt — `GET /host`, the
 * checks, the binding write, `GET /host/events`, the first `host` event — with
 * the module's timeouts, keeps the stream as the record's subscription under
 * the liveness window, retries with backoff, and derives one of the ten
 * statuses. It exposes add (with a synchronous attempt), change, test and
 * remove for the API.
 *
 * Only configuration and binding are ever written (through the store); the
 * status, `statusSince`, `lastEventAt`, `lastError` and `restartedAt` live
 * here, so a heartbeat never writes the registry (`4pxwyo22`). The plain token
 * is decrypted per attempt, held only for the connection, and never logged —
 * a log line carries `id`, `url`, status and code (`qc6t2y7m`).
 */
export class RunnerHostSupervisor {
  private readonly hosts = new Map<string, Supervised>();
  private readonly store: RunnerHostStore;
  private readonly clock: SupervisorClock;
  private readonly random: () => number;
  private closed = false;

  constructor(opts: RunnerHostSupervisorOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? realClock;
    this.random = opts.random ?? Math.random;
    for (const record of opts.records) this.track(record);
  }

  /**
   * Process start (`m9e73y05`): every record is `connecting` and its attempt is
   * scheduled in the background. Returns at once — listen does not wait.
   */
  start(): void {
    for (const h of this.hosts.values()) {
      setImmediate(() => {
        if (!this.closed && this.hosts.get(h.record.id) === h && h.abort === null && h.stream === null) {
          void this.attempt(h, { rebind: false });
        }
      });
    }
  }

  /** The supervised hosts, in the order they were added. Sends nothing to any host. */
  list(): RunnerHostView[] {
    return [...this.hosts.values()].map((h) => this.view(h));
  }

  get(id: string): RunnerHostView | null {
    const h = this.hosts.get(id);
    return h ? this.view(h) : null;
  }

  /**
   * Add (`m9e73y05`): the record is written, then the synchronous attempt runs
   * within the 15 s budget. A retried status or `connected` leaves the
   * subscription in the background.
   */
  async add(input: AddRunnerHostInput): Promise<RunnerHostView> {
    const h = this.track(this.store.add(input));
    return this.synchronous(h, { rebind: false });
  }

  /**
   * Change (`m9e73y05`): a label alone leaves the subscription untouched; a new
   * `url` closes it and attempts again with the binding kept; a new token
   * closes it, clears the binding (the store does) and attempts again — the
   * first successful attempt binds anew.
   */
  async update(id: string, input: UpdateRunnerHostInput): Promise<RunnerHostView> {
    const h = this.require(id);
    const before = h.record;
    const record = this.store.update(id, input);
    h.record = copyRecord(record);
    const tokenChanged = input.token !== undefined;
    if (!tokenChanged && record.url === before.url) return this.view(h);
    if (tokenChanged) h.state.restartedAt = null;
    h.retries = 0;
    h.stopped = false;
    // ASSUMPTION:dev-5401 — the attempt after a url/token change answers the
    // PATCH like the add's synchronous attempt (same 15 s budget).
    return this.synchronous(h, { rebind: false });
  }

  /**
   * Test (`m9e73y05`): next to a live subscription only `GET /host` (up to
   * 5 s); otherwise — in backoff or after a status without retry — the backoff
   * is reset and a synchronous attempt runs, whose success leaves a new
   * subscription. With `rebind` a new binding is stored.
   */
  async test(id: string, opts: TestRunnerHostOptions = {}): Promise<RunnerHostView> {
    const h = this.require(id);
    const rebind = opts.rebind === true;
    if (h.stream && h.state.status === 'connected') return this.liveTest(h, rebind);
    h.retries = 0;
    return this.synchronous(h, { rebind });
  }

  /** Remove (`m9e73y05`): close the subscription, remove the record. */
  remove(id: string): void {
    const h = this.require(id);
    this.teardown(h);
    this.hosts.delete(id);
    try {
      this.store.remove(id);
    } catch (err) {
      // Already gone from the file (another process removed it): removed all the same.
      if (!(err instanceof RunnerHostError && err.code === 'NOT_FOUND')) throw err;
    }
  }

  /** Process shutdown: close every stream, cancel every attempt and timer. */
  async close(): Promise<void> {
    this.closed = true;
    for (const h of this.hosts.values()) this.teardown(h);
  }

  // --- internals ----------------------------------------------------------

  private track(record: RunnerHostRecord): Supervised {
    const h: Supervised = {
      record: copyRecord(record),
      state: {
        status: 'connecting',
        statusSince: this.iso(),
        lastEventAt: null,
        lastError: null,
        restartedAt: null,
      },
      epoch: 0,
      abort: null,
      stream: null,
      retryTimer: null,
      stableTimer: null,
      retries: 0,
      stopped: false,
    };
    this.hosts.set(record.id, h);
    return h;
  }

  private require(id: string): Supervised {
    const h = this.hosts.get(id);
    if (!h) throw new RunnerHostError('NOT_FOUND', `runner host "${id}" not found`);
    return h;
  }

  private view(h: Supervised): RunnerHostView {
    return {
      record: copyRecord(h.record),
      state: { ...h.state, lastError: h.state.lastError ? { ...h.state.lastError } : null },
    };
  }

  private iso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private setStatus(h: Supervised, status: RunnerHostStatus): void {
    if (h.state.status !== status) {
      h.state.status = status;
      h.state.statusSince = this.iso();
    }
  }

  /** Close the subscription, cancel the attempt in flight and every timer; older loops go stale. */
  private teardown(h: Supervised): void {
    h.epoch += 1;
    h.abort?.abort();
    h.abort = null;
    h.stream?.close();
    h.stream = null;
    if (h.retryTimer !== null) this.clock.clearTimeout(h.retryTimer);
    if (h.stableTimer !== null) this.clock.clearTimeout(h.stableTimer);
    h.retryTimer = null;
    h.stableTimer = null;
  }

  /**
   * A synchronous attempt (`tc3bz2eq`): the whole chain, within a 15 s budget.
   * Past the budget the answer carries `connecting` and the attempt ends in the
   * background; a stream it opened stays as the subscription.
   */
  private async synchronous(h: Supervised, opts: { rebind: boolean }): Promise<RunnerHostView> {
    this.setStatus(h, 'connecting');
    let budget: unknown = null;
    await Promise.race([
      this.attempt(h, opts),
      new Promise<void>((resolve) => {
        budget = this.clock.setTimeout(resolve, SUPERVISOR_TIMINGS.syncBudgetMs);
      }),
    ]);
    this.clock.clearTimeout(budget);
    return this.view(h);
  }

  /**
   * A test next to a live subscription (`tc3bz2eq`): `GET /host` alone, beside
   * the stream, within 5 s. What it observes is applied like any observation;
   * with `rebind` a host answering with another `hostId` is bound anew.
   */
  private async liveTest(h: Supervised, rebind: boolean): Promise<RunnerHostView> {
    const epoch = h.epoch;
    let token: string;
    try {
      token = decrypt(h.record.tokenCiphertext);
    } catch {
      this.fail(h, epoch, null, tokenUnreadable());
      return this.view(h);
    }
    const abort = new AbortController();
    const run = async (): Promise<void> => {
      try {
        const host = await sendRequest({
          url: hostEndpoint(h.record.url, 'host'),
          token,
          accept: 'application/json',
          signal: abort.signal,
          clock: this.clock,
          connectMs: SUPERVISOR_TIMINGS.connectMs,
          headersMs: SUPERVISOR_TIMINGS.headersMs,
        });
        const body = await readBody(host.res, { signal: abort.signal, clock: this.clock, ms: SUPERVISOR_TIMINGS.headersMs });
        if (h.epoch !== epoch) return;
        const httpFailure = classifyHttpStatus(host.res.statusCode ?? 0, body, token);
        if (httpFailure) return this.fail(h, epoch, token, httpFailure);
        const checked = checkHostInfoText(body);
        if (!checked.ok) return this.fail(h, epoch, token, checked.failure);
        const bindFailure = this.observe(h, checked.info, rebind);
        if (bindFailure) return this.fail(h, epoch, token, bindFailure);
      } catch (err) {
        if (h.epoch !== epoch || err instanceof AttemptAborted) return;
        this.fail(h, epoch, token, transportFailure(err));
      }
    };
    let budget: unknown = null;
    await Promise.race([
      run(),
      new Promise<void>((resolve) => {
        budget = this.clock.setTimeout(() => {
          abort.abort();
          resolve();
        }, SUPERVISOR_TIMINGS.liveTestMs);
      }),
    ]);
    this.clock.clearTimeout(budget);
    return this.view(h);
  }

  /**
   * The attempt (`tc3bz2eq`): 1. `GET /host`; 2. the checks; 3. the binding
   * write; 4. `GET /host/events`; 5. the first event checked like `GET /host`.
   * Never rejects: every outcome lands in the state.
   */
  private async attempt(h: Supervised, opts: { rebind: boolean }): Promise<void> {
    this.teardown(h);
    if (this.closed) return;
    const epoch = h.epoch;
    const abort = new AbortController();
    h.abort = abort;

    // `qc6t2y7m`: an unreadable ciphertext — no request leaves for the host.
    let token: string;
    try {
      token = decrypt(h.record.tokenCiphertext);
    } catch {
      this.fail(h, epoch, null, tokenUnreadable());
      return;
    }

    const request = (path: string, accept: string) =>
      sendRequest({
        url: hostEndpoint(h.record.url, path),
        token,
        accept,
        signal: abort.signal,
        clock: this.clock,
        connectMs: SUPERVISOR_TIMINGS.connectMs,
        headersMs: SUPERVISOR_TIMINGS.headersMs,
      });

    try {
      // 1–2. GET /host and the checks.
      const host = await request('host', 'application/json');
      const hostBody = await readBody(host.res, { signal: abort.signal, clock: this.clock, ms: SUPERVISOR_TIMINGS.headersMs });
      if (h.epoch !== epoch) return;
      const hostFailure = classifyHttpStatus(host.res.statusCode ?? 0, hostBody, token);
      if (hostFailure) return this.fail(h, epoch, token, hostFailure);
      const hostInfo = checkHostInfoText(hostBody);
      if (!hostInfo.ok) return this.fail(h, epoch, token, hostInfo.failure);

      // 3. The binding.
      const bindFailure = this.observe(h, hostInfo.info, opts.rebind);
      if (bindFailure) return this.fail(h, epoch, token, bindFailure);

      // 4. GET /host/events.
      const events = await request('host/events', 'text/event-stream');
      if (h.epoch !== epoch) {
        events.res.destroy();
        return;
      }
      const statusCode = events.res.statusCode ?? 0;
      if (statusCode !== 200) {
        const body = await readBody(events.res, { signal: abort.signal, clock: this.clock, ms: SUPERVISOR_TIMINGS.headersMs });
        if (h.epoch !== epoch) return;
        const failure = classifyHttpStatus(statusCode, body, token);
        if (failure) return this.fail(h, epoch, token, failure);
      }
      const contentType = String(events.res.headers['content-type'] ?? '');
      if (!/^text\/event-stream\b/i.test(contentType)) {
        events.res.destroy();
        return this.fail(h, epoch, token, {
          status: 'bad-response',
          error: {
            code: 'not_event_stream',
            message: `Expected an event stream (text/event-stream), got ${contentType || 'no content type'}.`,
          },
        });
      }
      const stream = new HostEventStream(events.res);
      h.stream = stream;

      // 5. The first event: `host`, within 3 s of sending the request.
      const firstDeadline = events.sentAt + SUPERVISOR_TIMINGS.headersMs - this.clock.now();
      const first = await this.nextWithin(stream, firstDeadline);
      if (h.epoch !== epoch) return;
      if (first === 'timeout') {
        return this.fail(h, epoch, token, {
          status: 'unreachable',
          error: { code: 'timeout', message: 'No first host event within 3 s of opening the event stream.' },
        });
      }
      if (first === null) return this.fail(h, epoch, token, stream.overflowed ? streamOverflow() : streamEnded());
      if (first.event !== 'host') return this.fail(h, epoch, token, firstEventNotHost());
      const firstInfo = checkHostInfoText(first.data);
      if (!firstInfo.ok) return this.fail(h, epoch, token, firstInfo.failure);
      const firstBind = this.observe(h, firstInfo.info, false);
      if (firstBind) return this.fail(h, epoch, token, firstBind);

      this.connected(h, epoch, stream, token);
    } catch (err) {
      if (h.epoch !== epoch || err instanceof AttemptAborted) return;
      this.fail(h, epoch, token, transportFailure(err));
    }
  }

  /**
   * The `hostId` step and the binding (`l9ykuddq`, `i084ojn6`): the first host
   * that answers correctly is trusted (no binding yet, or after a new token);
   * another `hostId` than the bound one gives `other-host` unless `rebind`; the
   * same `hostId` with another `startedAt` is a runner restart — the binding's
   * `startedAt` is updated and `restartedAt` set. Only a changed binding is
   * written; an unchanged one writes nothing.
   */
  private observe(h: Supervised, info: HostInfo, rebind: boolean): RunnerHostFailure | null {
    const bound = h.record.binding;
    if (bound && bound.hostId !== info.hostId && !rebind) {
      return {
        status: 'other-host',
        error: {
          code: 'other_host',
          message: `The host at this address answers as ${info.hostId}, not the bound host ${bound.hostId}.`,
        },
      };
    }
    const next: RunnerHostBinding = {
      hostId: info.hostId,
      hostName: info.name,
      runnerVersion: info.runnerVersion,
      startedAt: info.startedAt,
    };
    if (bound && bound.hostId === next.hostId) {
      if (bound.startedAt !== next.startedAt) h.state.restartedAt = this.iso();
      if (
        bound.startedAt === next.startedAt &&
        bound.hostName === next.hostName &&
        bound.runnerVersion === next.runnerVersion
      ) {
        return null;
      }
    } else {
      // A new binding (first use, or rebind): no restart seen for it yet.
      h.state.restartedAt = null;
    }
    h.record.binding = next;
    try {
      // `4pxwyo22`: a binding update never re-inserts a record gone from the file.
      this.store.updateBinding(h.record.id, next);
    } catch (err) {
      console.warn(
        `[runner-hosts] host ${h.record.id} ${h.record.url}: binding not stored (${err instanceof Error ? err.name : 'error'})`,
      );
    }
    return null;
  }

  /** `connected`: the stream after a checked first `host`; the liveness loop runs on it. */
  private connected(h: Supervised, epoch: number, stream: HostEventStream, token: string): void {
    h.stopped = false;
    this.setStatus(h, 'connected');
    h.state.lastEventAt = this.iso();
    // ASSUMPTION:dev-5402 — a successful connection clears `lastError`.
    h.state.lastError = null;
    this.log(h, 'connected', 'ok');
    h.stableTimer = this.clock.setTimeout(() => {
      h.stableTimer = null;
      if (h.epoch === epoch) h.retries = 0;
    }, SUPERVISOR_TIMINGS.backoffResetMs);
    void this.watch(h, epoch, stream, token);
  }

  /**
   * The subscription (`m9e73y05`, `mzbcfo0y`): every event refreshes
   * `lastEventAt`; `closing` ends the stream at once; no event for 20 s is a
   * break. Unknown events are ignored.
   */
  private async watch(h: Supervised, epoch: number, stream: HostEventStream, token: string): Promise<void> {
    for (;;) {
      const event = await this.nextWithin(stream, SUPERVISOR_TIMINGS.livenessMs);
      if (h.epoch !== epoch) return;
      if (event === 'timeout') {
        return this.fail(h, epoch, token, {
          status: 'retrying',
          error: { code: 'liveness_timeout', message: 'No event from the runner host for 20 s.' },
        });
      }
      if (event === null) return this.fail(h, epoch, token, stream.overflowed ? streamOverflow() : streamEnded());
      h.state.lastEventAt = this.iso();
      if (event.event === 'closing') return this.fail(h, epoch, token, closingFailure(event.data));
      if (event.event === 'host') {
        const checked = checkHostInfoText(event.data);
        if (!checked.ok) return this.fail(h, epoch, token, checked.failure);
        const bindFailure = this.observe(h, checked.info, false);
        if (bindFailure) return this.fail(h, epoch, token, bindFailure);
      }
      // `heartbeat` and unknown events: `lastEventAt` only.
    }
  }

  /** The next event, `null` when the stream ended, `'timeout'` after `ms`. */
  private nextWithin(stream: HostEventStream, ms: number): Promise<Awaited<ReturnType<HostEventStream['next']>> | 'timeout'> {
    let timer: unknown = null;
    return Promise.race([
      stream.next(),
      new Promise<'timeout'>((resolve) => {
        timer = this.clock.setTimeout(() => resolve('timeout'), Math.max(0, ms));
      }),
    ]).finally(() => this.clock.clearTimeout(timer));
  }

  /**
   * A failed stage: the subscription is closed (a status without retry never
   * keeps a stream, `other-host` included), the status and the scrubbed
   * `lastError` are set, a retried status schedules the backoff.
   */
  private fail(h: Supervised, epoch: number, token: string | null, failure: RunnerHostFailure): void {
    if (h.epoch !== epoch || this.closed) return;
    this.teardown(h);
    const retried = RETRIED_STATUSES.has(failure.status);
    let status: RunnerHostStatus = failure.status;
    if (failure.status === 'stopped') h.stopped = true;
    else if (retried && h.stopped) status = 'stopped';
    else if (!retried) h.stopped = false;
    this.setStatus(h, status);
    h.state.lastError = scrubError(failure.error, token);
    this.log(h, status, scrubToken(failure.error.code, token));
    if (retried) this.scheduleRetry(h);
  }

  /** Backoff (`m9e73y05`): exponential 1 s → 60 s with a random spread; never over 60 s. */
  private scheduleRetry(h: Supervised): void {
    const base = Math.min(SUPERVISOR_TIMINGS.backoffMaxMs, SUPERVISOR_TIMINGS.backoffMinMs * 2 ** h.retries);
    h.retries += 1;
    const delay = Math.max(SUPERVISOR_TIMINGS.backoffMinMs / 2, base * (0.5 + 0.5 * this.random()));
    const epoch = h.epoch;
    h.retryTimer = this.clock.setTimeout(() => {
      h.retryTimer = null;
      if (h.epoch === epoch && !this.closed) void this.attempt(h, { rebind: false });
    }, delay);
  }

  /** `qc6t2y7m`: a log line carries `id`, `url`, status and code — never the token or a host's text. */
  private log(h: Supervised, status: RunnerHostStatus, code: string): void {
    const line = `[runner-hosts] host ${h.record.id} ${h.record.url}: ${status} (${code})`;
    if (status === 'connected') console.log(line);
    else console.warn(line);
  }
}

/** `qc6t2y7m`: the ciphertext does not decrypt (corrupt, key file missing or changed) — no request leaves. */
function tokenUnreadable(): RunnerHostFailure {
  return {
    status: 'token-unreadable',
    error: { code: 'token_unreadable', message: 'The stored token cannot be decrypted — enter the token again.' },
  };
}

function streamEnded(): RunnerHostFailure {
  return {
    status: 'retrying',
    error: { code: 'stream_ended', message: 'The event stream ended without a closing event.' },
  };
}

/**
 * `closing` (`c4s-runner` dto `closing-event`): `shutdown` → `stopped`,
 * `revoked` → `token-rejected` (no retry); an unknown reason is treated like a
 * stream broken without `closing` → `retrying`.
 */
function closingFailure(data: string): RunnerHostFailure {
  let reason: unknown;
  try {
    reason = (JSON.parse(data) as { reason?: unknown } | null)?.reason;
  } catch {
    reason = undefined;
  }
  if (reason === 'shutdown') {
    return { status: 'stopped', error: { code: 'closing_shutdown', message: 'The runner host closed the stream: shutdown.' } };
  }
  if (reason === 'revoked') {
    return {
      status: 'token-rejected',
      error: { code: 'closing_revoked', message: 'The runner host revoked this token.' },
    };
  }
  return {
    status: 'retrying',
    error: { code: 'closing_unknown', message: 'The runner host closed the stream for a reason this server does not know.' },
  };
}

/** Below HTTP: timeouts and refused connections → `unreachable`; TLS → `bad-response`. */
function transportFailure(err: unknown): RunnerHostFailure {
  if (err instanceof HostTransportError) {
    if (err.kind === 'tls') return { status: 'bad-response', error: { code: 'tls', message: msgTls(err.reason) } };
    return { status: 'unreachable', error: { code: 'unreachable', message: `The runner host does not answer: ${err.reason}.` } };
  }
  return {
    status: 'retrying',
    error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
  };
}
