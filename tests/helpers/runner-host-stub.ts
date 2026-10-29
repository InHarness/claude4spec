import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SupervisorClock } from '../../src/server/runner-hosts/host-client.js';

/**
 * A runner host for tests: a local HTTP stub on an ephemeral loopback port
 * serving the two contract paths (`GET /host`, `GET /host/events` as an event
 * stream, `c4s-runner` `modules/M03-control-channel.md` #55kkrgd7) — never a
 * real `c4s-runner`. Paths are matched by their END, so a base address with a
 * path prefix (a reverse proxy) reaches the same handlers; every request is
 * recorded with its full path. `close()` drops every connection, so no stream
 * outlives the test.
 */

export interface StubRequest {
  path: string;
  headers: IncomingHttpHeaders;
}

export type StubHandler = (req: IncomingMessage, res: ServerResponse, stub: RunnerHostStub) => void;

export const STUB_HOST_INFO = {
  hostId: 'h_7k2m9q4x',
  name: 'kb-ec2',
  runnerVersion: '0.1.0',
  protocol: 1,
  startedAt: '2026-10-27T09:12:03Z',
};

export class RunnerHostStub {
  readonly server: http.Server;
  readonly requests: StubRequest[] = [];
  /** TCP connections accepted, ever. */
  connections = 0;
  /** The open `/host/events` streams. */
  readonly streams = new Set<ServerResponse>();
  /** What `GET /host` answers and the first `host` event carries. */
  hostInfo: Record<string, unknown> = { ...STUB_HOST_INFO };
  /** When set, any other bearer token gets 401 (like the runner, before routing). */
  acceptedToken: string | null = null;
  /** Override of `GET /host`. */
  onHost: StubHandler | null = null;
  /** Override of `GET /host/events`. */
  onEvents: StubHandler | null = null;
  /** Override of any request (wins over everything). */
  onAny: StubHandler | null = null;

  private constructor() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.on('connection', () => {
      this.connections += 1;
    });
  }

  static async start(): Promise<RunnerHostStub> {
    const stub = new RunnerHostStub();
    await new Promise<void>((resolve) => stub.server.listen(0, '127.0.0.1', () => resolve()));
    return stub;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  /** The base address the user would type (optionally with a path prefix). */
  url(prefix = ''): string {
    return `http://127.0.0.1:${this.port}${prefix}`;
  }

  /** Requests to a path ending with `suffix`. */
  count(suffix: string): number {
    return this.requests.filter((r) => r.path.endsWith(suffix)).length;
  }

  /** Write one event to every open stream. */
  send(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.streams) res.write(frame);
  }

  /** `closing` with a reason, then the runner closes the connection right after it. */
  sendClosing(reason: string): void {
    const frame = `event: closing\ndata: ${JSON.stringify({ reason })}\n\n`;
    for (const res of [...this.streams]) res.end(frame);
  }

  /** Break every open stream without `closing`. */
  dropStreams(): void {
    for (const res of [...this.streams]) res.destroy();
  }

  async close(): Promise<void> {
    for (const res of this.streams) res.destroy();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0]!;
    this.requests.push({ path, headers: req.headers });
    if (this.onAny) return this.onAny(req, res, this);
    if (this.acceptedToken !== null && req.headers.authorization !== `Bearer ${this.acceptedToken}`) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
      res.end(JSON.stringify({ code: 'unauthenticated', message: 'Missing or invalid master token.' }));
      return;
    }
    if (path.endsWith('/host/events')) {
      if (this.onEvents) return this.onEvents(req, res, this);
      this.openStream(res);
      return;
    }
    if (path.endsWith('/host')) {
      if (this.onHost) return this.onHost(req, res, this);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(this.hostInfo));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'not_found', message: 'Not found.' }));
  }

  /** 200 `text/event-stream`, the `host` snapshot first, then held open. */
  openStream(res: ServerResponse, firstEvent: { event: string; data: unknown } | null = { event: 'host', data: this.hostInfo }): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    this.streams.add(res);
    res.on('close', () => this.streams.delete(res));
    if (firstEvent) res.write(`event: ${firstEvent.event}\ndata: ${JSON.stringify(firstEvent.data)}\n\n`);
  }
}

/** A port nothing listens on (bound, then released) — a refused TCP connection. */
export async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A clock moved by hand: timeouts, the liveness window and backoff without real waiting. */
export class ManualClock implements SupervisorClock {
  private t = Date.parse('2026-10-29T10:00:00.000Z');
  private seq = 0;
  private readonly timers = new Map<number, { at: number; ms: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Pending timers: id and the delay they were set with. */
  pending(): Array<{ id: number; ms: number }> {
    return [...this.timers.entries()].map(([id, t]) => ({ id, ms: t.ms }));
  }

  /** Move time forward, firing every timer due on the way, in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.timers.entries()) {
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}

/** Poll (in real time) until `cond` holds. */
export async function until(cond: () => boolean, timeoutMs = 5_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
