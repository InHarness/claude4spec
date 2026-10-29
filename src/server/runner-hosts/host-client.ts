import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { EventStreamParser, MAX_HOST_TEXT, type StreamEvent } from './host-checks.js';

/**
 * M54 `tc3bz2eq` — one request to a runner host's control API with the
 * module's own timeouts: TCP connection 2 s, status and headers 3 s from
 * sending the request (on a stream the first event too, counted by the
 * caller from `sentAt`). Redirects are never followed (`qc6t2y7m`): a 3xx is
 * an answer like any other, and no request goes to its `Location`.
 *
 * The token travels only in the `Authorization` header; nothing here logs.
 */

/** The supervisor's time source — injectable so timeouts and backoff are tested without real waiting. */
export interface SupervisorClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: SupervisorClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** A failure below HTTP: no answer under this address (`unreachable`), or a TLS failure (`bad-response`). */
export class HostTransportError extends Error {
  constructor(
    readonly kind: 'unreachable' | 'tls',
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'HostTransportError';
  }
}

/** The attempt was cancelled by the supervisor (a change, a removal, process shutdown). */
export class AttemptAborted extends Error {
  constructor() {
    super('attempt aborted');
    this.name = 'AttemptAborted';
  }
}

export interface RequestOptions {
  url: string;
  token: string;
  accept: string;
  signal: AbortSignal;
  clock: SupervisorClock;
  connectMs: number;
  headersMs: number;
}

const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|ERR_OSSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|HOSTNAME_MISMATCH)/;

function transportError(err: NodeJS.ErrnoException, https: boolean): HostTransportError {
  const code = err.code ?? '';
  const library = (err as { library?: string }).library ?? '';
  if (https && (TLS_CODE.test(code) || /ssl|tls/i.test(library) || /SSL routines|wrong version number/i.test(err.message))) {
    return new HostTransportError('tls', err.message || code);
  }
  return new HostTransportError('unreachable', code ? `${code}: ${err.message}` : err.message);
}

/** Send one `GET` and resolve on status + headers. */
export function sendRequest(o: RequestOptions): Promise<{ res: IncomingMessage; sentAt: number }> {
  return new Promise((resolve, reject) => {
    if (o.signal.aborted) {
      reject(new AttemptAborted());
      return;
    }
    const target = new URL(o.url);
    const isHttps = target.protocol === 'https:';
    // `agent: false` — a socket of its own, closed with the request; nothing pooled outlives a stream.
    const req = (isHttps ? https : http).request(target, {
      method: 'GET',
      agent: false,
      headers: { authorization: `Bearer ${o.token}`, accept: o.accept },
    });
    const sentAt = o.clock.now();
    let settled = false;
    const timers: unknown[] = [];
    const cleanup = () => {
      for (const t of timers) o.clock.clearTimeout(t);
      o.signal.removeEventListener('abort', onAbort);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.destroy();
      reject(err);
    };
    const onAbort = () => fail(new AttemptAborted());
    o.signal.addEventListener('abort', onAbort, { once: true });
    const connectTimer = o.clock.setTimeout(
      () => fail(new HostTransportError('unreachable', `no TCP connection within ${o.connectMs / 1000} s`)),
      o.connectMs,
    );
    timers.push(
      connectTimer,
      o.clock.setTimeout(
        () => fail(new HostTransportError('unreachable', `no response status and headers within ${o.headersMs / 1000} s`)),
        o.headersMs,
      ),
    );
    req.on('socket', (socket: Socket) => {
      const connected = () => o.clock.clearTimeout(connectTimer);
      if (socket.connecting) socket.once('connect', connected);
      else connected();
    });
    req.on('response', (res) => {
      if (settled) {
        res.destroy();
        return;
      }
      settled = true;
      cleanup();
      resolve({ res, sentAt });
    });
    req.on('error', (err: NodeJS.ErrnoException) => fail(transportError(err, isHttps)));
    req.end();
  });
}

/**
 * Read a (small) response body: `GET /host` or an error body. Bounded in size
 * and in time — a body that does not arrive in `ms` is no answer
 * (`unreachable`), like missing headers.
 */
export function readBody(res: IncomingMessage, o: { signal: AbortSignal; clock: SupervisorClock; ms: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      o.clock.clearTimeout(timer);
      o.signal.removeEventListener('abort', onAbort);
      if (err) {
        res.destroy();
        reject(err);
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    };
    const onAbort = () => finish(new AttemptAborted());
    o.signal.addEventListener('abort', onAbort, { once: true });
    const timer = o.clock.setTimeout(
      () => finish(new HostTransportError('unreachable', `the response body did not arrive within ${o.ms / 1000} s`)),
      o.ms,
    );
    res.on('data', (chunk: Buffer) => {
      if (size >= MAX_HOST_TEXT) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size >= MAX_HOST_TEXT) {
        // Enough to classify; the rest is not read.
        finish(null);
        res.destroy();
      }
    });
    res.on('end', () => finish(null));
    res.on('error', (err) => finish(new HostTransportError('unreachable', err.message)));
    res.on('aborted', () => finish(new HostTransportError('unreachable', 'the connection was closed mid-response')));
  });
}

/**
 * The open `GET /host/events` stream: events in arrival order through
 * `next()`, which resolves `null` once the stream has ended (or was closed).
 * `overflowed` tells an end caused by the parser's cap from a broken stream.
 */
export class HostEventStream {
  private readonly parser = new EventStreamParser();
  private readonly queue: StreamEvent[] = [];
  private waiter: ((event: StreamEvent | null) => void) | null = null;
  private ended = false;

  get overflowed(): boolean {
    return this.parser.overflowed;
  }

  constructor(private readonly res: IncomingMessage) {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      for (const event of this.parser.push(chunk)) this.deliver(event);
      // A host streaming without completing an event is cut off, not buffered.
      if (this.parser.overflowed) this.close();
    });
    const end = () => this.end();
    res.on('end', end);
    res.on('close', end);
    res.on('error', end);
    res.on('aborted', end);
  }

  next(): Promise<StreamEvent | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  /** Close the connection (the socket goes with it). */
  close(): void {
    this.res.destroy();
    this.end();
  }

  private deliver(event: StreamEvent): void {
    if (this.ended) return;
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter(event);
    } else {
      this.queue.push(event);
    }
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.(null);
  }
}
