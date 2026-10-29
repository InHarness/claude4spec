import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http, { type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../workspace/registry.js';
import type { WorkspaceRecord } from '../workspace/types.js';
import { EventStreamParser, MAX_HOST_TEXT, MSG_INVALID_HOST_INFO, MSG_NOT_FOUND, MSG_REDIRECT } from './host-checks.js';
import { RunnerHostStore } from './host-records.js';
import { RunnerHostSupervisor, type RunnerHostSupervisorOptions } from './supervisor.js';
import {
  closedPort,
  ManualClock,
  RunnerHostStub,
  STUB_HOST_INFO,
  until,
} from '../../../tests/helpers/runner-host-stub.js';

/**
 * M54 — the runner-host supervisor (`m9e73y05`, `tc3bz2eq`, `mzbcfo0y`,
 * statuses `hzcwlgln` / `spxxz1ph`, checks `o0qdti8z`, `lastError` `npul32ax`,
 * binding `l9ykuddq`, restart `i084ojn6`, secret boundary `qc6t2y7m`).
 *
 * Hosts are local HTTP stubs on ephemeral ports (`tests/helpers/runner-host-stub.ts`),
 * never a real `c4s-runner`. The registry and `secret.key` live in a temp
 * `C4S_HOME`. Timeouts, the liveness window and backoff run on a `ManualClock`
 * — never real waiting. Every supervisor and stub is closed in `afterEach`.
 */

const TOKEN = 'c4sr_Q1w2E3r4T5y6U7i8O9p0AsDfGhJkL';
const TOKEN_2 = 'c4sr_Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0';

describe('M54 runner-host supervisor', () => {
  let dir: string;
  let registryDir: string;
  let savedC4sHome: string | undefined;
  let registry: WorkspaceRegistry;
  let ws: WorkspaceRecord;
  let store: RunnerHostStore;
  let stubs: RunnerHostStub[];
  let supervisors: RunnerHostSupervisor[];
  let extraServers: http.Server[];
  let logs: string[];

  const newStub = async () => {
    const stub = await RunnerHostStub.start();
    stubs.push(stub);
    return stub;
  };
  const supervisor = (opts: Partial<RunnerHostSupervisorOptions> = {}) => {
    const sup = new RunnerHostSupervisor({ store, records: [], random: () => 0, ...opts });
    supervisors.push(sup);
    return sup;
  };
  const registryText = () => fs.readFileSync(registry.filePath, 'utf8');
  const storedHosts = () =>
    (JSON.parse(registryText()).workspaces as Array<{ name: string; runnerHosts?: Array<Record<string, unknown>> }>).find(
      (w) => w.name === 'default',
    )?.runnerHosts ?? [];
  const status = (sup: RunnerHostSupervisor, id: string) => sup.get(id)?.state.status;
  /** A host added through the supervisor and connected to `stub`, its stream open. */
  const connected = async (sup: RunnerHostSupervisor, stub: RunnerHostStub, url = stub.url()) => {
    const view = await sup.add({ url, token: TOKEN });
    expect(view.state.status).toBe('connected');
    await until(() => stub.streams.size === 1, 5_000, 'open stream');
    return view.record.id;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-runner-supervisor-'));
    registryDir = path.join(dir, 'registry');
    savedC4sHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;
    registry = new WorkspaceRegistry(registryDir);
    ws = registry.selectOrCreate({ name: 'default' });
    store = new RunnerHostStore(registry, ws);
    stubs = [];
    supervisors = [];
    extraServers = [];
    logs = [];
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(async () => {
    for (const sup of supervisors) await sup.close();
    for (const stub of stubs) await stub.close();
    for (const server of extraServers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    vi.restoreAllMocks();
    if (savedC4sHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = savedC4sHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // --- start and connecting ------------------------------------------------

  it('[ac:ac-przed-wynikiem-pierwszej-proby-status] before the first attempt has a result the status is `connecting`', async () => {
    const stub = await newStub();
    stub.onHost = () => {}; // holds GET /host without an answer
    const record = store.add({ url: stub.url(), token: TOKEN });
    const sup = supervisor({ records: store.list(), clock: new ManualClock() });

    expect(status(sup, record.id)).toBe('connecting');
    sup.start();
    expect(status(sup, record.id)).toBe('connecting');
    await until(() => stub.count('/host') === 1, 5_000, 'GET /host');
    // The request is in flight, no result yet.
    expect(status(sup, record.id)).toBe('connecting');
    expect(sup.get(record.id)?.state.lastError).toBeNull();
  });

  it('[ac:ac-nieosiagalny-host-nie-opoznia-startu] an unreachable host does not delay the server starting to listen', async () => {
    const stub = await newStub();
    stub.onHost = () => {}; // never answers: the attempt can only end by its timeout
    const record = store.add({ url: stub.url(), token: TOKEN });
    const sup = supervisor({ records: store.list(), clock: new ManualClock() });

    const t0 = performance.now();
    sup.start(); // returns at once — the attempt is scheduled in the background
    const app = http.createServer((_req, res) => res.end('ok'));
    extraServers.push(app);
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', () => resolve()));
    const listenedAfter = performance.now() - t0;

    const res = await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/`);
    expect(await res.text()).toBe('ok');
    await until(() => stub.count('/host') === 1, 5_000, 'GET /host');
    // Listening (and answering) while the host attempt has no result yet.
    expect(status(sup, record.id)).toBe('connecting');
    expect(listenedAfter).toBeLessThan(1_000);
  });

  it('[ac:ac-rekord-dodany-w-innym-procesie-nie-je] a record added by another process is not supervised before this process restarts', async () => {
    const mine = await newStub();
    const theirs = await newStub();
    const own = store.add({ url: mine.url(), token: TOKEN });
    const sup = supervisor({ records: store.list() });
    sup.start();
    await until(() => status(sup, own.id) === 'connected', 5_000, 'own host connected');

    // Another process (its own registry instance) adds a record to the same entry.
    const other = new RunnerHostStore(new WorkspaceRegistry(registryDir), ws).add({ url: theirs.url(), token: TOKEN });
    expect(storedHosts().map((h) => h.id)).toEqual([own.id, other.id]);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sup.list().map((v) => v.record.id)).toEqual([own.id]);
    expect(sup.get(other.id)).toBeNull();
    expect(theirs.connections).toBe(0);

    // After a restart (a new supervisor over the fresh view) it is supervised.
    await sup.close();
    const restarted = supervisor({ records: new RunnerHostStore(new WorkspaceRegistry(registryDir), ws).list() });
    restarted.start();
    await until(() => status(restarted, other.id) === 'connected', 5_000, 'other host connected after restart');
    expect(theirs.count('/host')).toBe(1);
  });

  // --- the attempt: transport and HTTP status ------------------------------

  it('[ac:ac-brak-polaczenia-tcp-daje-nieosiagalny] no TCP connection gives status `unreachable`', async () => {
    const port = await closedPort();
    const sup = supervisor({ clock: new ManualClock() });
    const view = await sup.add({ url: `http://127.0.0.1:${port}`, token: TOKEN });
    expect(view.state.status).toBe('unreachable');
    expect(view.state.lastError?.code).toBe('unreachable');
  });

  it('[ac:ac-brak-pierwszego-zdarzenia-host-w-3-s] no first `host` event within 3 s of the stream request gives `unreachable`', async () => {
    const stub = await newStub();
    stub.onEvents = (_req, res, s) => s.openStream(res, null); // 200 event-stream, no event
    const record = store.add({ url: stub.url(), token: TOKEN });
    const clock = new ManualClock();
    const sup = supervisor({ records: store.list(), clock });
    sup.start();
    await until(() => stub.streams.size === 1, 5_000, 'stream opened');
    // Only the first-event wait is pending: 3 s from sending the request.
    await until(() => clock.pending().length === 1, 5_000, 'first-event timer');
    expect(clock.pending()[0]!.ms).toBe(3_000);

    clock.advance(2_999);
    expect(status(sup, record.id)).toBe('connecting');
    clock.advance(1);
    await until(() => status(sup, record.id) === 'unreachable', 5_000, 'unreachable');
    // The stream that never delivered is not kept.
    await until(() => stub.streams.size === 0, 5_000, 'stream closed');
  });

  it('[ac:ac-odpowiedz-401-daje-odrzucony-token] a 401 answer gives status `token-rejected`', async () => {
    const stub = await newStub();
    stub.acceptedToken = TOKEN_2;
    const sup = supervisor({ clock: new ManualClock() });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(view.state.status).toBe('token-rejected');
    expect(view.state.lastError).toEqual({ code: 'unauthenticated', message: 'Missing or invalid master token.' });
  });

  it('[ac:ac-po-401-nie-ma-kolejnej-proby-bez-akcj] after a 401 there is no further attempt without a user action', async () => {
    const stub = await newStub();
    stub.acceptedToken = TOKEN_2;
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(view.state.status).toBe('token-rejected');
    expect(stub.count('/host')).toBe(1);
    // Nothing is scheduled, and no time brings another request.
    expect(clock.pending()).toEqual([]);
    clock.advance(10 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stub.requests).toHaveLength(1);
    expect(status(sup, view.record.id)).toBe('token-rejected');
  });

  it('[ac:ac-odpowiedz-3xx-daje-bledna-odpowiedz] a 3xx answer gives status `bad-response`', async () => {
    const stub = await newStub();
    stub.onHost = (_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
      res.end();
    };
    const sup = supervisor({ clock: new ManualClock() });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(view.state.status).toBe('bad-response');
    expect(view.state.lastError).toEqual({ code: 'redirect', message: MSG_REDIRECT });
  });

  it('[ac:ac-po-odpowiedzi-3xx-zadne-zadanie-nie-i] after a 3xx answer no request goes to the `Location` address', async () => {
    const target = await newStub();
    const stub = await newStub();
    for (const code of [301, 302, 307, 308]) {
      stub.onHost = (_req, res) => {
        res.writeHead(code, { location: `${target.url()}/host` });
        res.end();
      };
      const sup = supervisor({ clock: new ManualClock() });
      const view = await sup.add({ url: stub.url(`/p${code}`), token: TOKEN });
      expect(view.state.status).toBe('bad-response');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(target.connections).toBe(0);
    expect(target.requests).toEqual([]);
  });

  it('[ac:ac-odpowiedz-404-na-get-host-daje-bledna] a 404 answer to `GET /host` gives status `bad-response`', async () => {
    const stub = await newStub();
    stub.onHost = (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>Not Found</h1>');
    };
    const sup = supervisor({ clock: new ManualClock() });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(view.state.status).toBe('bad-response');
    expect(view.state.lastError).toEqual({ code: 'not_found', message: MSG_NOT_FOUND });
    expect(stub.count('/host/events')).toBe(0);
  });

  it('[ac:ac-odpowiedz-502-daje-ponawianie] a 502 answer gives status `retrying`', async () => {
    const stub = await newStub();
    stub.onHost = (_req, res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<h1>Bad Gateway</h1>');
    };
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(view.state.status).toBe('retrying');
    expect(view.state.lastError?.code).toBe('http_502');
    // Retried: a backoff timer is pending.
    expect(clock.pending()).toHaveLength(1);
  });

  it('[ac:ac-odpowiedz-5xx-daje-ponawianie] a 5xx answer (500 from the runner, 503/504 from a proxy) gives status `retrying`', async () => {
    const stub = await newStub();
    for (const code of [500, 503, 504]) {
      stub.onHost = (_req, res) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'internal', message: `failure ${code}` }));
      };
      const sup = supervisor({ clock: new ManualClock() });
      const view = await sup.add({ url: stub.url(`/p${code}`), token: TOKEN });
      expect(view.state.status).toBe('retrying');
      expect(view.state.lastError).toEqual({ code: 'internal', message: `failure ${code}` });
    }
  });

  it('[ac:ac-odpowiedz-200-bez-strumienia-zdarzen] a 200 answer without an event stream gives status `bad-response`', async () => {
    const stub = await newStub();
    stub.onEvents = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(STUB_HOST_INFO));
    };
    const sup = supervisor({ clock: new ManualClock() });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(stub.count('/host/events')).toBe(1);
    expect(view.state.status).toBe('bad-response');
    expect(view.state.lastError?.code).toBe('not_event_stream');
  });

  it('[ac:ac-prefiks-sciezki-w-url-u-jest-zachowan] a path prefix of the URL is kept in the `/host` and `/host/events` addresses', async () => {
    const stub = await newStub();
    const sup = supervisor({ clock: new ManualClock() });
    await connected(sup, stub, `${stub.url()}/runner/api/`);
    expect(stub.requests.map((r) => r.path)).toEqual(['/runner/api/host', '/runner/api/host/events']);
  });

  // --- the checks on HostInfo ---------------------------------------------

  const withHostInfo = async (info: Record<string, unknown>) => {
    const stub = await newStub();
    stub.hostInfo = info;
    const sup = supervisor({ clock: new ManualClock() });
    return { stub, view: await sup.add({ url: stub.url(), token: TOKEN }) };
  };

  it('[ac:ac-brak-pola-protocol-w-hostinfo-daje-bl] a HostInfo without `protocol` gives status `bad-response`', async () => {
    const info: Record<string, unknown> = { ...STUB_HOST_INFO };
    delete info.protocol;
    const { stub, view } = await withHostInfo(info);
    expect(view.state.status).toBe('bad-response');
    expect(view.state.lastError).toEqual({ code: 'invalid_host_info', message: MSG_INVALID_HOST_INFO });
    expect(stub.count('/host/events')).toBe(0);
  });

  it('[ac:ac-protocol-niebedacy-liczba-calkowita-d] a `protocol` that is not an integer gives status `bad-response`', async () => {
    for (const protocol of ['1', 1.5, null, true]) {
      const { view } = await withHostInfo({ ...STUB_HOST_INFO, protocol });
      expect(view.state.status).toBe('bad-response');
      expect(view.state.lastError?.message).toBe(MSG_INVALID_HOST_INFO);
    }
  });

  it('[ac:ac-protocol-1-daje-niezgodny-protokol] a `protocol` ≠ 1 gives status `protocol-mismatch`', async () => {
    for (const protocol of [2, 0]) {
      const { stub, view } = await withHostInfo({ ...STUB_HOST_INFO, protocol });
      expect(view.state.status).toBe('protocol-mismatch');
      expect(stub.count('/host/events')).toBe(0);
    }
  });

  it('[ac:ac-protocol-rozny-od-1-daje-niezgodny-pr] a `protocol` other than 1 gives `protocol-mismatch` also with an incomplete HostInfo', async () => {
    const { view } = await withHostInfo({ protocol: 2, somethingNew: 'x' });
    expect(view.state.status).toBe('protocol-mismatch');
  });

  it('[ac:ac-niekompletne-hostinfo-w-odpowiedzi-ge] an incomplete HostInfo in the `GET /host` answer gives status `bad-response`', async () => {
    for (const missing of ['hostId', 'name', 'runnerVersion', 'startedAt'] as const) {
      const info: Record<string, unknown> = { ...STUB_HOST_INFO };
      delete info[missing];
      const { view } = await withHostInfo(info);
      expect(view.state.status).toBe('bad-response');
      expect(view.state.lastError?.message).toBe(MSG_INVALID_HOST_INFO);
    }
  });

  it('[ac:ac-nieznane-pole-hostinfo-nie-zmienia-st] an unknown HostInfo field does not change the status', async () => {
    const { stub, view } = await withHostInfo({ ...STUB_HOST_INFO, gpu: 'h100', capabilities: ['x'] });
    expect(view.state.status).toBe('connected');
    expect(view.state.lastError).toBeNull();
    expect(stub.streams.size).toBe(1);
  });

  // --- the binding ---------------------------------------------------------

  it('[ac:ac-pierwsza-udana-proba-zapisuje-hostid] the first successful attempt stores `hostId` in the binding', async () => {
    const stub = await newStub();
    const sup = supervisor({ clock: new ManualClock() });
    expect(storedHosts()).toEqual([]);
    const id = await connected(sup, stub);
    expect(storedHosts()).toHaveLength(1);
    expect(storedHosts()[0]).toMatchObject({
      id,
      binding: {
        hostId: STUB_HOST_INFO.hostId,
        hostName: STUB_HOST_INFO.name,
        runnerVersion: STUB_HOST_INFO.runnerVersion,
        startedAt: STUB_HOST_INFO.startedAt,
      },
    });
    expect(sup.get(id)?.record.binding?.hostId).toBe(STUB_HOST_INFO.hostId);
  });

  /** A record bound to the stub's host, then supervised by a fresh process whose host answers with another hostId. */
  const boundThenOtherHost = async () => {
    const stub = await newStub();
    const first = supervisor({ clock: new ManualClock() });
    const id = await connected(first, stub);
    await first.close();
    await until(() => stub.streams.size === 0, 5_000, 'first stream closed');
    const bindingBefore = storedHosts()[0]!.binding;
    stub.hostInfo = { ...STUB_HOST_INFO, hostId: 'h_rebuilt0', startedAt: '2026-10-29T07:00:00Z' };
    stub.requests.length = 0;
    const sup = supervisor({ records: store.list(), clock: new ManualClock() });
    sup.start();
    await until(() => status(sup, id) === 'other-host', 5_000, 'other-host');
    return { stub, sup, id, bindingBefore };
  };

  it('[ac:ac-hostid-inny-niz-powiazany-daje-inny-h] a `hostId` other than the bound one gives status `other-host`', async () => {
    const { sup, id } = await boundThenOtherHost();
    expect(sup.get(id)?.state.status).toBe('other-host');
    expect(sup.get(id)?.state.lastError?.code).toBe('other_host');
  });

  it('[ac:ac-inny-hostid-bez-zmiany-tokenu-daje-in] another `hostId` without a token change gives status `other-host` — also on the stream of a live subscription', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    // Same token; the host at this address now answers as another host.
    stub.hostInfo = { ...STUB_HOST_INFO, hostId: 'h_rebuilt0' };
    stub.send('host', stub.hostInfo);
    await until(() => status(sup, id) === 'other-host', 5_000, 'other-host');
    expect(sup.get(id)?.record.tokenLast4).toBe(TOKEN.slice(-4));
  });

  it('[ac:ac-status-inny-host-przy-niezmienionym-t] status `other-host` with an unchanged token does not change the stored binding', async () => {
    const { sup, id, bindingBefore } = await boundThenOtherHost();
    expect(bindingBefore).toMatchObject({ hostId: STUB_HOST_INFO.hostId });
    expect(storedHosts()[0]!.binding).toEqual(bindingBefore);
    expect(sup.get(id)?.record.binding).toEqual(bindingBefore);
  });

  it('[ac:ac-przy-statusie-inny-host-strumien-nie] with status `other-host` the stream is not kept', async () => {
    // Detected on GET /host: the stream is never opened.
    const { stub, sup, id } = await boundThenOtherHost();
    expect(stub.count('/host/events')).toBe(0);
    expect(stub.streams.size).toBe(0);
    expect(status(sup, id)).toBe('other-host');

    // Detected on the first event of the stream: the stream is closed.
    const stub2 = await newStub();
    const first = supervisor({ clock: new ManualClock() });
    const id2 = await connected(first, stub2);
    await first.close();
    await until(() => stub2.streams.size === 0, 5_000, 'closed');
    stub2.onEvents = (_req, res, s) => s.openStream(res, { event: 'host', data: { ...STUB_HOST_INFO, hostId: 'h_other' } });
    const sup2 = supervisor({ records: store.list().filter((r) => r.id === id2), clock: new ManualClock() });
    sup2.start();
    await until(() => status(sup2, id2) === 'other-host', 5_000, 'other-host on stream');
    await until(() => stub2.streams.size === 0, 5_000, 'stream dropped');
  });

  it('[ac:ac-inny-startedat-przy-tym-samym-hostid-2] another `startedAt` with the same `hostId` leaves status `connected`', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    // The runner restarts: shutdown, then the same host with a new startedAt.
    stub.hostInfo = { ...STUB_HOST_INFO, startedAt: '2026-10-29T11:00:00Z' };
    stub.sendClosing('shutdown');
    await until(() => status(sup, id) === 'stopped', 5_000, 'stopped');
    clock.advance(clock.pending()[0]!.ms);
    await until(() => status(sup, id) === 'connected', 5_000, 'reconnected');
    const state = sup.get(id)!.state;
    expect(state.status).toBe('connected');
    expect(state.restartedAt).toBe(new Date(clock.now()).toISOString());
    expect(sup.get(id)!.record.binding?.startedAt).toBe('2026-10-29T11:00:00Z');
  });

  it('[ac:ac-restartedat-nie-trafia-do-pliku-rejes] `restartedAt` is not written to the registry file', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    stub.hostInfo = { ...STUB_HOST_INFO, startedAt: '2026-10-29T11:00:00Z' };
    stub.send('host', stub.hostInfo); // a restart seen on the stream
    await until(() => sup.get(id)?.state.restartedAt !== null, 5_000, 'restart noticed');

    const text = registryText();
    // The binding's startedAt is updated in the file…
    expect(storedHosts()[0]!.binding).toMatchObject({ startedAt: '2026-10-29T11:00:00Z' });
    // …but the in-memory state is not.
    for (const field of ['restartedAt', 'statusSince', 'lastEventAt', 'lastError', '"status"']) {
      expect(text).not.toContain(field);
    }
  });

  // --- the stream ----------------------------------------------------------

  it('[ac:ac-heartbeat-nie-zapisuje-pliku-rejestru] a heartbeat does not write the registry file', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    const bytesBefore = registryText();
    const mtimeBefore = fs.statSync(registry.filePath).mtimeMs;

    for (let i = 1; i <= 5; i++) {
      clock.advance(5_000);
      stub.send('heartbeat', {});
      const expected = new Date(clock.now()).toISOString();
      await until(() => sup.get(id)?.state.lastEventAt === expected, 5_000, `heartbeat ${i}`);
    }
    expect(status(sup, id)).toBe('connected');
    expect(registryText()).toBe(bytesBefore);
    expect(fs.statSync(registry.filePath).mtimeMs).toBe(mtimeBefore);
  });

  it('[ac:ac-nieznane-zdarzenie-strumienia-nie-zmi] an unknown stream event does not change the status', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    const before = sup.get(id)!.state;
    clock.advance(1_000);
    stub.send('run-started', { runId: 'r1' });
    const expected = new Date(clock.now()).toISOString();
    await until(() => sup.get(id)?.state.lastEventAt === expected, 5_000, 'event seen');
    const after = sup.get(id)!.state;
    expect(after.status).toBe('connected');
    expect(after.statusSince).toBe(before.statusSince);
    expect(after.lastError).toBeNull();
    expect(stub.streams.size).toBe(1);
  });

  it('[ac:ac-brak-zdarzenia-przez-20-s-daje-ponawi] no event for 20 s gives status `retrying`', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    clock.advance(19_999);
    expect(status(sup, id)).toBe('connected');
    clock.advance(1);
    await until(() => status(sup, id) === 'retrying', 5_000, 'retrying');
    expect(sup.get(id)?.state.lastError?.code).toBe('liveness_timeout');
    await until(() => stub.streams.size === 0, 5_000, 'stream closed as a break');
  });

  it('[ac:ac-strumien-urwany-bez-closing-daje-pona] a stream broken without `closing` gives status `retrying`', async () => {
    const stub = await newStub();
    const sup = supervisor({ clock: new ManualClock() });
    const id = await connected(sup, stub);
    stub.dropStreams();
    await until(() => status(sup, id) === 'retrying', 5_000, 'retrying');
    expect(sup.get(id)?.state.lastError?.code).toBe('stream_ended');
  });

  it('a stream sending more than 64 KiB without completing an event is closed and gives status `retrying`', async () => {
    const stub = await newStub();
    const sup = supervisor({ clock: new ManualClock() });
    const id = await connected(sup, stub);
    // One unfinished `data` line past the cap — no newline ever arrives.
    for (const res of stub.streams) res.write(`data: ${'x'.repeat(MAX_HOST_TEXT)}`);
    await until(() => status(sup, id) === 'retrying', 5_000, 'retrying');
    expect(sup.get(id)?.state.lastError?.code).toBe('stream_overflow');
    // The supervisor closed the connection itself; nothing is kept buffering.
    await until(() => stub.streams.size === 0, 5_000, 'stream closed');
  });

  it('EventStreamParser caps what it holds between chunks: the unfinished line and the event being assembled', () => {
    const line = new EventStreamParser();
    expect(line.push('x'.repeat(MAX_HOST_TEXT))).toEqual([]);
    expect(line.overflowed).toBe(false);
    expect(line.push('x')).toEqual([]);
    expect(line.overflowed).toBe(true);
    // Once over the cap nothing more is dispatched.
    expect(line.push('\n\nevent: host\ndata: {}\n\n')).toEqual([]);

    const event = new EventStreamParser();
    const half = 'y'.repeat(MAX_HOST_TEXT / 2);
    // Complete `data` lines of an event that never ends (no blank line).
    expect(event.push(`event: host\ndata: ${half}\n`)).toEqual([]);
    expect(event.overflowed).toBe(false);
    expect(event.push(`data: ${half}\n`)).toEqual([]);
    expect(event.overflowed).toBe(true);

    // A dispatched event frees its size: many small events never overflow.
    const many = new EventStreamParser();
    for (let i = 0; i < 100; i += 1) {
      expect(many.push(`event: heartbeat\ndata: ${'z'.repeat(1_000)}\n\n`)).toHaveLength(1);
    }
    expect(many.overflowed).toBe(false);
  });

  it('[ac:ac-closing-shutdown-daje-zatrzymany] `closing: shutdown` gives status `stopped`', async () => {
    const stub = await newStub();
    const sup = supervisor({ clock: new ManualClock() });
    const id = await connected(sup, stub);
    stub.sendClosing('shutdown');
    await until(() => status(sup, id) === 'stopped', 5_000, 'stopped');
  });

  it('[ac:ac-closing-revoked-daje-odrzucony-token] `closing: revoked` gives status `token-rejected`', async () => {
    const stub = await newStub();
    const sup = supervisor({ clock: new ManualClock() });
    const id = await connected(sup, stub);
    stub.sendClosing('revoked');
    await until(() => status(sup, id) === 'token-rejected', 5_000, 'token-rejected');
  });

  it('[ac:ac-closing-z-nieznanym-powodem-daje-pona] `closing` with an unknown reason gives status `retrying`', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    stub.sendClosing('maintenance');
    await until(() => status(sup, id) === 'retrying', 5_000, 'retrying');
    expect(clock.pending()).toHaveLength(1); // a retry is scheduled
  });

  it('[ac:ac-po-zdarzeniu-closing-status-zmienia-s] after a `closing` event the status changes before the liveness window ends', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    const connectedAt = clock.now();
    stub.sendClosing('shutdown');
    // No time passes on the supervisor's clock: the change does not wait for the 20 s window.
    await until(() => status(sup, id) !== 'connected', 5_000, 'status change');
    expect(status(sup, id)).toBe('stopped');
    expect(clock.now() - connectedAt).toBeLessThan(20_000);
    expect(sup.get(id)?.state.statusSince).toBe(new Date(connectedAt).toISOString());
  });

  it('[ac:ac-po-closing-shutdown-polaczenie-jest-p] after `closing: shutdown` the connection is retried', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    stub.sendClosing('shutdown');
    await until(() => status(sup, id) === 'stopped', 5_000, 'stopped');
    const retry = clock.pending();
    expect(retry).toHaveLength(1);
    expect(retry[0]!.ms).toBeLessThanOrEqual(60_000);
    clock.advance(retry[0]!.ms);
    await until(() => stub.count('/host') === 2, 5_000, 'second GET /host');
    await until(() => status(sup, id) === 'connected', 5_000, 'connected again');
    expect(stub.streams.size).toBe(1);
  });

  it('[ac:ac-nieudane-ponowienie-po-closing-shutdo] a failed retry after `closing: shutdown` leaves status `stopped`', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    stub.sendClosing('shutdown');
    await until(() => status(sup, id) === 'stopped', 5_000, 'stopped');
    // The runner is down: retries hit 503 from a proxy, then a refused connection.
    stub.onHost = (_req, res) => {
      res.writeHead(503);
      res.end();
    };
    clock.advance(clock.pending()[0]!.ms);
    await until(() => sup.get(id)?.state.lastError?.code === 'http_503', 5_000, 'failed retry');
    expect(status(sup, id)).toBe('stopped');
    await stub.close();
    stubs.splice(stubs.indexOf(stub), 1);
    clock.advance(clock.pending()[0]!.ms);
    await until(() => sup.get(id)?.state.lastError?.code === 'unreachable', 5_000, 'second failed retry');
    expect(status(sup, id)).toBe('stopped');
  });

  it('[ac:ac-po-closing-revoked-nie-ma-ponowienia] after `closing: revoked` there is no retry', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    stub.sendClosing('revoked');
    await until(() => status(sup, id) === 'token-rejected', 5_000, 'token-rejected');
    expect(clock.pending()).toEqual([]);
    clock.advance(10 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stub.count('/host')).toBe(1);
    expect(stub.count('/host/events')).toBe(1);
  });

  // --- backoff -------------------------------------------------------------

  it('[ac:ac-odstep-miedzy-kolejnymi-ponowieniami] the gap between consecutive retries never exceeds 60 s', async () => {
    const port = await closedPort();
    const clock = new ManualClock();
    // The largest possible spread, so the cap is what holds the gap down.
    const sup = supervisor({ clock, random: () => 0.999999 });
    const view = await sup.add({ url: `http://127.0.0.1:${port}`, token: TOKEN });
    expect(view.state.status).toBe('unreachable');
    const gaps: number[] = [];
    let lastTimer = -1;
    for (let i = 0; i < 12; i++) {
      await until(
        () => clock.pending().length === 1 && clock.pending()[0]!.id !== lastTimer,
        5_000,
        `retry timer ${i}`,
      );
      const [timer] = clock.pending();
      lastTimer = timer!.id;
      gaps.push(timer!.ms);
      clock.advance(timer!.ms);
    }
    expect(gaps.every((g) => g > 0 && g <= 60_000)).toBe(true);
    // Exponential from about 1 s, held at the 60 s cap.
    expect(gaps[0]).toBeLessThanOrEqual(1_000);
    expect(gaps.slice(-3).every((g) => g > 59_000)).toBe(true);
  });

  // --- operations ----------------------------------------------------------

  it('[ac:ac-udany-test-po-statusie-bez-ponawiania] a successful test after a status without retry opens a subscription', async () => {
    const stub = await newStub();
    stub.hostInfo = { ...STUB_HOST_INFO, protocol: 2 };
    const sup = supervisor({ clock: new ManualClock() });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(view.state.status).toBe('protocol-mismatch');
    expect(stub.streams.size).toBe(0);

    stub.hostInfo = { ...STUB_HOST_INFO }; // the runner was upgraded
    const tested = await sup.test(view.record.id);
    expect(tested.state.status).toBe('connected');
    await until(() => stub.streams.size === 1, 5_000, 'subscription open');
  });

  it('[ac:ac-zmiana-samej-etykiety-nie-przerywa-st] changing only the label does not interrupt the stream', async () => {
    const stub = await newStub();
    const sup = supervisor({ clock: new ManualClock() });
    const id = await connected(sup, stub);
    const [stream] = [...stub.streams] as ServerResponse[];
    const updated = await sup.update(id, { label: 'build box' });
    expect(updated.record.label).toBe('build box');
    expect(updated.state.status).toBe('connected');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect([...stub.streams]).toEqual([stream]);
    expect(stream!.destroyed).toBe(false);
    expect(stub.count('/host')).toBe(1);
    expect(stub.count('/host/events')).toBe(1);
  });

  it('[ac:ac-zmiana-tokenu-po-odrzucony-token-wzna] changing the token after status `token-rejected` resumes the connection', async () => {
    const stub = await newStub();
    stub.acceptedToken = TOKEN_2;
    const sup = supervisor({ clock: new ManualClock() });
    const view = await sup.add({ url: stub.url(), token: TOKEN });
    expect(view.state.status).toBe('token-rejected');

    const updated = await sup.update(view.record.id, { token: TOKEN_2 });
    expect(updated.state.status).toBe('connected');
    expect(updated.record.tokenLast4).toBe(TOKEN_2.slice(-4));
    await until(() => stub.streams.size === 1, 5_000, 'stream open');
    expect(stub.requests.at(-1)?.headers.authorization).toBe(`Bearer ${TOKEN_2}`);
  });

  it('[ac:ac-zmiana-url-zachowuje-powiazanie] changing the `url` keeps the binding', async () => {
    const before = await newStub();
    const moved = await newStub(); // the same host, moved to another address
    const sup = supervisor({ clock: new ManualClock() });
    const id = await connected(sup, before);
    const binding = storedHosts()[0]!.binding;

    const updated = await sup.update(id, { url: moved.url() });
    expect(updated.record.url).toBe(moved.url());
    expect(updated.record.binding).toEqual(binding);
    expect(storedHosts()[0]!.binding).toEqual(binding);
    expect(updated.state.status).toBe('connected');
    await until(() => before.streams.size === 0 && moved.streams.size === 1, 5_000, 'stream moved');
  });

  it('[ac:ac-usuniecie-rekordu-zamyka-jego-subskry] removing a record closes its subscription', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    const id = await connected(sup, stub);
    sup.remove(id);
    await until(() => stub.streams.size === 0, 5_000, 'stream closed');
    expect(sup.get(id)).toBeNull();
    expect(storedHosts()).toEqual([]);
    expect(clock.pending()).toEqual([]);
    clock.advance(10 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stub.count('/host')).toBe(1);
  });

  // --- secret boundary -----------------------------------------------------

  it('[ac:ac-szyfrogram-nieczytelny-daje-token-nie] an unreadable ciphertext gives status `token-unreadable`', async () => {
    const stub = await newStub();
    store.add({ url: stub.url(), token: TOKEN });
    // Corrupt the stored ciphertext in the file.
    const file = JSON.parse(registryText());
    const entry = file.workspaces.find((w: { name: string }) => w.name === 'default');
    entry.runnerHosts[0].tokenCiphertext = Buffer.from('not a ciphertext of this key').toString('base64');
    fs.writeFileSync(registry.filePath, JSON.stringify(file, null, 2));

    const [record] = store.list();
    const sup = supervisor({ records: [record!], clock: new ManualClock() });
    sup.start();
    await until(() => status(sup, record!.id) === 'token-unreadable', 5_000, 'token-unreadable');
    expect(sup.get(record!.id)?.state.lastError?.code).toBe('token_unreadable');
  });

  it('[ac:ac-brak-pliku-klucza-przy-istniejacych-s] a missing key file with existing ciphertexts gives status `token-unreadable`', async () => {
    const stub = await newStub();
    const record = store.add({ url: stub.url(), token: TOKEN });
    const keyFile = path.join(registryDir, 'secret.key');
    expect(fs.existsSync(keyFile)).toBe(true);
    fs.rmSync(keyFile);

    const sup = supervisor({ records: store.list(), clock: new ManualClock() });
    sup.start();
    await until(() => status(sup, record.id) === 'token-unreadable', 5_000, 'token-unreadable');
    // Reading never creates a new key.
    expect(fs.existsSync(keyFile)).toBe(false);
    expect(stub.connections).toBe(0);
  });

  it('[ac:ac-przy-token-nieczytelny-do-hosta-nie-w] with status `token-unreadable` no request leaves for the host', async () => {
    const stub = await newStub();
    const record = store.add({ url: stub.url(), token: TOKEN });
    fs.rmSync(path.join(registryDir, 'secret.key'));
    const clock = new ManualClock();
    const sup = supervisor({ records: store.list(), clock });
    sup.start();
    await until(() => status(sup, record.id) === 'token-unreadable', 5_000, 'token-unreadable');
    // Not retried, and a test does not send anything either.
    expect(clock.pending()).toEqual([]);
    const tested = await sup.test(record.id);
    expect(tested.state.status).toBe('token-unreadable');
    clock.advance(10 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stub.connections).toBe(0);
    expect(stub.requests).toEqual([]);
  });

  it('[ac:ac-lasterror-nie-zawiera-tokenu-takze-gd] `lastError` does not contain the token, also when the host error text contains it', async () => {
    const stub = await newStub();
    const leaking = (code: number) => (_req: unknown, res: ServerResponse) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: `bad ${TOKEN}`, message: `token ${TOKEN} was refused (Bearer ${TOKEN})` }));
    };
    for (const code of [401, 500, 404, 418]) {
      stub.onHost = leaking(code);
      const sup = supervisor({ clock: new ManualClock() });
      const view = await sup.add({ url: stub.url(`/p${code}`), token: TOKEN });
      expect(view.state.lastError).not.toBeNull();
      expect(JSON.stringify(view.state.lastError)).not.toContain(TOKEN);
      expect(view.state.lastError!.message).toContain('[redacted]');
      expect(JSON.stringify(sup.list())).not.toContain(TOKEN);
    }
  });

  it('[ac:ac-log-serwera-nie-zawiera-tokenu-przy-z] the server log does not contain the token at any status', async () => {
    const stub = await newStub();
    const clock = new ManualClock();
    const sup = supervisor({ clock });
    // connected
    const id = await connected(sup, stub);
    // retrying (closing with an unknown reason), stopped, token-rejected (revoked)
    stub.sendClosing('maintenance');
    await until(() => status(sup, id) === 'retrying', 5_000, 'retrying');
    clock.advance(clock.pending()[0]!.ms);
    await until(() => status(sup, id) === 'connected', 5_000, 'connected');
    stub.sendClosing('shutdown');
    await until(() => status(sup, id) === 'stopped', 5_000, 'stopped');
    clock.advance(clock.pending()[0]!.ms);
    await until(() => status(sup, id) === 'connected', 5_000, 'connected');
    stub.sendClosing('revoked');
    await until(() => status(sup, id) === 'token-rejected', 5_000, 'token-rejected');
    // 401 / 404 / 5xx / other 4xx / 3xx whose bodies carry the token
    const leaking = (code: number) => (_req: unknown, res: ServerResponse) => {
      res.writeHead(code, { 'content-type': 'application/json', location: `http://x/${TOKEN}` });
      res.end(JSON.stringify({ code: 'unauthenticated', message: `token ${TOKEN}` }));
    };
    for (const code of [401, 404, 502, 403, 302]) {
      stub.onHost = leaking(code);
      await sup.test(id);
    }
    stub.onHost = null;
    stub.hostInfo = { ...STUB_HOST_INFO, protocol: 9 };
    await sup.test(id); // protocol-mismatch
    stub.hostInfo = { ...STUB_HOST_INFO, hostId: 'h_other' };
    await sup.test(id); // other-host
    stub.hostInfo = { protocol: 1 };
    await sup.test(id); // bad-response
    // unreachable and token-unreadable
    await sup.update(id, { url: `http://127.0.0.1:${await closedPort()}` });
    fs.rmSync(path.join(registryDir, 'secret.key'));
    const unreadable = supervisor({ records: store.list(), clock: new ManualClock() });
    unreadable.start();
    await until(() => status(unreadable, id) === 'token-unreadable', 5_000, 'token-unreadable');

    const seen = new Set(logs.map((l) => /: ([a-z-]+) \(/.exec(l)?.[1]).filter(Boolean));
    for (const s of ['connected', 'retrying', 'stopped', 'token-rejected', 'bad-response', 'protocol-mismatch', 'other-host', 'unreachable', 'token-unreadable']) {
      expect(seen.has(s), `a log line for ${s}`).toBe(true);
    }
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(TOKEN.slice(5));
      expect(line).toContain(id); // the log carries id, url and code
    }
  });
});
