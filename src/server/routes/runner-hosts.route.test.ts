import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../workspace/registry.js';
import { MSG_NOT_FOUND } from '../runner-hosts/host-checks.js';
import { RunnerHostStore } from '../runner-hosts/host-records.js';
import { RunnerHostSupervisor } from '../runner-hosts/supervisor.js';
import { errorHandler } from './errors.js';
import { runnerHostsRouter } from './runner-hosts.js';
import { ManualClock, RunnerHostStub, STUB_HOST_INFO, until } from '../../../tests/helpers/runner-host-stub.js';

/**
 * M54 L4 (`pyxt16pa`, 2.1.62) — `/api/workspace/runner-hosts` through supertest,
 * over the real store (registry in a temp `C4S_HOME`, the M05 key there too)
 * and the real supervisor. Runner hosts are local HTTP stubs on ephemeral ports
 * (`tests/helpers/runner-host-stub.ts`); the supervisor's timeouts and budget
 * run on a `ManualClock`, never by real waiting. Every supervisor and stub is
 * closed in `afterEach`, so no stream, attempt or retry timer outlives a test.
 */

const TOKEN = 'c4sr_Q1w2E3r4T5y6U7i8O9p0AsDfGhJkL';
const TOKEN_2 = 'c4sr_Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0';
const BASE = '/api/workspace/runner-hosts';

/** DTO `runner-host-response`: every field the DTO names (all present in an answer, `label` as `null` when unset). */
const RESPONSE_FIELDS = [
  'binding',
  'id',
  'label',
  'lastError',
  'lastEventAt',
  'restartedAt',
  'status',
  'statusSince',
  'token',
  'url',
];

const STATUSES = [
  'connecting',
  'connected',
  'unreachable',
  'retrying',
  'stopped',
  'token-rejected',
  'token-unreadable',
  'protocol-mismatch',
  'other-host',
  'bad-response',
];

type Body = Record<string, unknown>;

describe('M54 runner-host routes — /api/workspace/runner-hosts', () => {
  let dir: string;
  let savedC4sHome: string | undefined;
  let registry: WorkspaceRegistry;
  let store: RunnerHostStore;
  let clock: ManualClock;
  let supervisor: RunnerHostSupervisor;
  let app: express.Express;
  let stubs: RunnerHostStub[];

  /** One supervised host's view, found by id in `supervisor.list()`. */
  const viewOf = (id: string) => supervisor.list().find((v) => v.record.id === id) ?? null;
  const newStub = async () => {
    const stub = await RunnerHostStub.start();
    stubs.push(stub);
    return stub;
  };
  const registryText = () => fs.readFileSync(registry.filePath, 'utf8');
  const storedHosts = () =>
    (JSON.parse(registryText()).workspaces as Array<{ name: string; runnerHosts?: Array<Record<string, unknown>> }>).find(
      (w) => w.name === 'default',
    )?.runnerHosts ?? [];
  const list = async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    return res.body.data as Body[];
  };
  /** A host added through the API and connected to `stub`, its stream open. */
  const addConnected = async (stub: RunnerHostStub, body: Body = {}) => {
    const res = await request(app)
      .post(BASE)
      .send({ url: stub.url(), token: TOKEN, ...body });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('connected');
    await until(() => stub.streams.size === 1, 5_000, 'open stream');
    return res.body.data as Body;
  };
  /**
   * Moves the supervisor's clock in 500 ms steps (each followed by a real tick
   * for the sockets) until `pending` settles; returns the answer and the
   * clock time it took. Fails if it does not settle within `limitMs`.
   */
  const settleWithin = async (pending: Promise<request.Response>, limitMs: number) => {
    let settled = false;
    const done = pending.then((res) => {
      settled = true;
      return res;
    });
    const t0 = clock.now();
    while (!settled && clock.now() - t0 < limitMs) {
      clock.advance(500);
      const tickEnd = Date.now() + 50;
      while (!settled && Date.now() < tickEnd) await new Promise((r) => setTimeout(r, 5));
    }
    expect(settled).toBe(true);
    return { res: await done, elapsedMs: clock.now() - t0 };
  };
  /** A request started now (supertest runs it on `then`). */
  const start = (req: request.Test): Promise<request.Response> => new Promise((resolve, reject) => req.then(resolve, reject));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-runner-hosts-route-'));
    const registryDir = path.join(dir, 'registry');
    savedC4sHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;
    registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default' });
    store = new RunnerHostStore(registry, ws);
    clock = new ManualClock();
    supervisor = new RunnerHostSupervisor({ store, records: [], clock, random: () => 0 });
    stubs = [];
    app = express();
    app.use(express.json());
    app.use(BASE, runnerHostsRouter({ supervisor }));
    app.use('/api', errorHandler);
    // The supervisor logs `id`, `url`, status and code; keep the test output quiet.
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(() => {});
    }
  });

  afterEach(async () => {
    await supervisor.close();
    for (const stub of stubs) await stub.close();
    vi.restoreAllMocks();
    if (savedC4sHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = savedC4sHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // --- endpoints and DTOs: method, path, status codes, shape ---------------

  it('[endpoint:get-api-workspace-runner-hosts] [dto:runner-host-response] GET lists the hosts as `{data, total}` with exactly the DTO fields', async () => {
    const empty = await request(app).get(BASE);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ data: [], total: 0 });

    const stub = await newStub();
    await addConnected(stub, { label: 'kb-ec2' });
    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const [host] = res.body.data as Body[];
    expect(Object.keys(host!).sort()).toEqual(RESPONSE_FIELDS);
    expect(host).toMatchObject({
      url: stub.url(),
      label: 'kb-ec2',
      token: { isSet: true, last4: TOKEN.slice(-4) },
      binding: {
        hostId: STUB_HOST_INFO.hostId,
        hostName: STUB_HOST_INFO.name,
        runnerVersion: STUB_HOST_INFO.runnerVersion,
        startedAt: STUB_HOST_INFO.startedAt,
      },
      status: 'connected',
      lastError: null,
      restartedAt: null,
    });
    expect(typeof host!.id).toBe('string');
    expect(STATUSES).toContain(host!.status);
    expect(new Date(host!.statusSince as string).toISOString()).toBe(host!.statusSince);
    expect(Object.keys(host!.binding as Body).sort()).toEqual(['hostId', 'hostName', 'runnerVersion', 'startedAt']);
  });

  it('[endpoint:get-api-workspace-runner-hosts] GET pages with `limit` + `offset` (at most 200) and refuses an invalid window with 400', async () => {
    const a = await newStub();
    const b = await newStub();
    const first = await addConnected(a);
    const second = await addConnected(b);

    const page = await request(app).get(BASE).query({ limit: 1, offset: 1 });
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(2);
    expect((page.body.data as Body[]).map((h) => h.id)).toEqual([second.id]);
    const head = await request(app).get(BASE).query({ limit: 1 });
    expect((head.body.data as Body[]).map((h) => h.id)).toEqual([first.id]);

    for (const query of [{ limit: 201 }, { limit: 0 }, { limit: 'abc' }, { offset: -1 }]) {
      const res = await request(app).get(BASE).query(query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });

  it('[endpoint:post-api-workspace-runner-hosts] [dto:create-runner-host-request] POST adds a host: 201 with `runner-host-response`; a body breaking the DTO is 400', async () => {
    const stub = await newStub();
    const res = await request(app).post(BASE).send({ url: `${stub.url()}/`, token: `  ${TOKEN}  `, label: 'kb' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_FIELDS);
    expect(res.body.data).toMatchObject({ url: stub.url(), label: 'kb', token: { isSet: true, last4: TOKEN.slice(-4) } });
    expect(storedHosts()).toHaveLength(1);

    const refused: Body[] = [
      { token: TOKEN }, // url missing
      { url: stub.url() }, // token missing
      { url: stub.url(), token: '' }, // token empty
      { url: stub.url(), token: '   ' }, // token empty after the trim
      { url: 42, token: TOKEN },
      { url: stub.url(), token: 42 },
      { url: stub.url(), token: TOKEN, label: 7 },
      { url: stub.url(), token: TOKEN, extra: true },
    ];
    for (const body of refused) {
      const bad = await request(app).post(BASE).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION');
    }
    const notObject = await request(app).post(BASE).set('content-type', 'application/json').send('[1]');
    expect(notObject.status).toBe(400);
    expect(storedHosts()).toHaveLength(1);
  });

  it('[endpoint:patch-api-workspace-runner-hosts-id] [dto:update-runner-host-request] PATCH changes a host: 200 with `runner-host-response`; a body breaking the DTO is 400', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    const res = await request(app).patch(`${BASE}/${added.id}`).send({ label: 'renamed' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_FIELDS);
    expect(res.body.data).toMatchObject({ id: added.id, label: 'renamed', status: 'connected' });
    // A label alone leaves the subscription untouched.
    expect(stub.count('/host')).toBe(1);

    for (const body of [{ url: 1 }, { token: false }, { label: null }, { name: 'x' }]) {
      const bad = await request(app).patch(`${BASE}/${added.id}`).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION');
    }
    expect(storedHosts()[0]).toMatchObject({ label: 'renamed' });
  });

  it('[endpoint:post-api-workspace-runner-hosts-id-test] [dto:test-runner-host-request] POST …/:id/test: 200 with `runner-host-response`; a non-boolean `rebind` is 400', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    const res = await request(app).post(`${BASE}/${added.id}/test`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_FIELDS);
    expect(res.body.data).toMatchObject({ id: added.id, status: 'connected' });
    // Next to the live stream the test is `GET /host` alone.
    expect(stub.count('/host')).toBe(2);
    expect(stub.count('/host/events')).toBe(1);

    const withBody = await request(app).post(`${BASE}/${added.id}/test`).send({ rebind: false });
    expect(withBody.status).toBe(200);
    for (const body of [{ rebind: 'yes' }, { rebind: 1 }, { force: true }]) {
      const bad = await request(app).post(`${BASE}/${added.id}/test`).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION');
    }
  });

  it('[endpoint:delete-api-workspace-runner-hosts-id] [dto:remove-runner-host-response] DELETE removes the host with its token: 200 `{data: {id}}`', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    const res = await request(app).delete(`${BASE}/${added.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: added.id } });
    expect(storedHosts()).toEqual([]);
    expect(await list()).toEqual([]);
    await until(() => stub.streams.size === 0, 5_000, 'stream closed');
  });

  // --- add ------------------------------------------------------------------

  it('[ac:ac-dodanie-osiagalnego-hosta-zwraca-stat] adding a reachable host returns status `connected`', async () => {
    const stub = await newStub();
    const res = await request(app).post(BASE).send({ url: stub.url(), token: TOKEN });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('connected');
    expect(res.body.data.lastError).toBeNull();
  });

  it('[ac:ac-dodanie-osiagalnego-hosta-konczy-sie] adding a reachable host answers within 15 s', async () => {
    const stub = await newStub();
    const startedAt = performance.now();
    const { res, elapsedMs } = await settleWithin(start(request(app).post(BASE).send({ url: stub.url(), token: TOKEN })), 15_000);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('connected');
    expect(elapsedMs).toBeLessThanOrEqual(15_000);
    expect(performance.now() - startedAt).toBeLessThan(15_000);
  });

  it('[ac:ac-dodanie-nieosiagalnego-hosta-konczy-s] adding an unreachable host answers within 15 s, the record saved with its status', async () => {
    const stub = await newStub();
    stub.onHost = () => {}; // holds GET /host without an answer: the attempt can only end by a timeout
    const pending = start(request(app).post(BASE).send({ url: stub.url(), token: TOKEN }));
    await until(() => stub.count('/host') === 1, 5_000, 'GET /host');
    const { res, elapsedMs } = await settleWithin(pending, 15_000);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('unreachable');
    expect(elapsedMs).toBeLessThanOrEqual(15_000);
    expect(storedHosts()).toHaveLength(1);
  });

  it('[ac:ac-pierwsze-powiazanie-hosta-zostawia-re] the first binding of a host leaves `restartedAt` empty', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    expect(added.binding).toMatchObject({ hostId: STUB_HOST_INFO.hostId, startedAt: STUB_HOST_INFO.startedAt });
    expect(added.restartedAt).toBeNull();
    const [listed] = await list();
    expect(listed!.binding).toMatchObject({ hostId: STUB_HOST_INFO.hostId });
    expect(listed!.restartedAt).toBeNull();
  });

  it('[ac:ac-przy-odpowiedzi-404-lasterror-mowi-ze] with a 404 answer `lastError` says the base URL does not point to the runner API', async () => {
    const stub = await newStub();
    stub.onHost = (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>Not Found</h1>');
    };
    const res = await request(app).post(BASE).send({ url: stub.url('/wrong'), token: TOKEN });
    expect(res.status).toBe(201);
    expect(res.body.data.lastError.message).toBe(MSG_NOT_FOUND);
    expect(res.body.data.lastError.message).toMatch(/Base URL does not point to a c4s-runner control API/);
    const [listed] = await list();
    expect((listed!.lastError as Body).message).toBe(MSG_NOT_FOUND);
  });

  it('[ac:ac-dodanie-url-a-rownego-istniejacemu-po] adding a URL equal to an existing one after normalization gives 409', async () => {
    const stub = await newStub();
    await addConnected(stub);
    const res = await request(app)
      .post(BASE)
      .send({ url: `HTTP://127.0.0.1:${stub.port}/`, token: TOKEN_2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RUNNER_HOST_DUPLICATE');
    expect(storedHosts()).toHaveLength(1);
    expect(await list()).toHaveLength(1);
  });

  // --- the list and the secret boundary --------------------------------------

  it('[ac:ac-odczyt-listy-nie-wysyla-zadania-do-za] reading the list sends no request to any host', async () => {
    const a = await newStub();
    const b = await newStub();
    await addConnected(a);
    await addConnected(b);
    const before = [a.requests.length, a.connections, b.requests.length, b.connections];
    await list();
    await list();
    await new Promise((r) => setTimeout(r, 50));
    expect([a.requests.length, a.connections, b.requests.length, b.connections]).toEqual(before);
  });

  it('[ac:ac-odpowiedz-listy-nie-zawiera-tokenu] the list answer does not contain the token', async () => {
    const stub = await newStub();
    await addConnected(stub);
    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(TOKEN);
    // Not even the token's characters before its last four.
    expect(res.text).not.toContain(TOKEN.slice(0, -4));
  });

  it('[ac:ac-odpowiedz-listy-nie-zawiera-szyfrogra] the list answer does not contain the token ciphertext', async () => {
    const stub = await newStub();
    await addConnected(stub);
    const ciphertext = storedHosts()[0]!.tokenCiphertext as string;
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.length).toBeGreaterThan(8);
    const res = await request(app).get(BASE);
    expect(res.text).not.toContain(ciphertext);
    expect(res.text).not.toContain('tokenCiphertext');
  });

  it('[ac:ac-odpowiedz-listy-podaje-dla-tokenu-wyl] the list answer gives only `isSet` and `last4` for the token', async () => {
    const stub = await newStub();
    await addConnected(stub);
    const [host] = await list();
    expect(host!.token).toEqual({ isSet: true, last4: TOKEN.slice(-4) });
    expect(Object.keys(host!.token as Body).sort()).toEqual(['isSet', 'last4']);
    // No other field carries anything of the token.
    const { token: _mask, ...rest } = host!;
    expect(JSON.stringify(rest)).not.toContain(TOKEN.slice(-4));
  });

  it('[ac:ac-inny-startedat-przy-tym-samym-hostid] another `startedAt` with the same `hostId` sets `restartedAt` in the list answer', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    expect(added.restartedAt).toBeNull();
    // The runner restarted: the same host, a new startedAt, seen on the stream.
    stub.hostInfo = { ...STUB_HOST_INFO, startedAt: '2026-10-29T11:00:00Z' };
    stub.send('host', stub.hostInfo);
    await until(() => viewOf(added.id as string)?.state.restartedAt != null, 5_000, 'restart noticed');
    const [listed] = await list();
    expect(listed!.restartedAt).toBe(new Date(clock.now()).toISOString());
    expect(listed!.binding).toMatchObject({ hostId: STUB_HOST_INFO.hostId, startedAt: '2026-10-29T11:00:00Z' });
    expect(listed!.status).toBe('connected');
  });

  // --- change ---------------------------------------------------------------

  it('[ac:ac-edycja-z-pustym-polem-tokenu-zostawia] an edit with an empty token field leaves the token unchanged', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    const stored = storedHosts()[0]!;
    for (const token of ['', '   ']) {
      const res = await request(app).patch(`${BASE}/${added.id}`).send({ token, label: `renamed${token.length}` });
      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual({ isSet: true, last4: TOKEN.slice(-4) });
      // The binding survives: no new token was saved.
      expect(res.body.data.binding).toMatchObject({ hostId: STUB_HOST_INFO.hostId });
    }
    const after = storedHosts()[0]!;
    expect(after.tokenCiphertext).toBe(stored.tokenCiphertext);
    expect(after.tokenLast4).toBe(TOKEN.slice(-4));
    expect(after.binding).toEqual(stored.binding);
  });

  it('[ac:ac-zmiana-tokenu-po-ktorej-host-odpowiad] a token change after which the host answers with another `hostId` gives status `connected`', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    // The runner was rebuilt: a new token and a new identity.
    stub.acceptedToken = TOKEN_2;
    stub.hostInfo = { ...STUB_HOST_INFO, hostId: 'h_rebuilt0' };
    const res = await request(app).patch(`${BASE}/${added.id}`).send({ token: TOKEN_2 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('connected');
    expect(res.body.data.token).toEqual({ isSet: true, last4: TOKEN_2.slice(-4) });
  });

  it('[ac:ac-zmiana-tokenu-po-ktorej-host-odpowiad-2] a token change after which the host answers with another `hostId` stores the new binding', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    expect(storedHosts()[0]!.binding).toMatchObject({ hostId: STUB_HOST_INFO.hostId });
    stub.acceptedToken = TOKEN_2;
    stub.hostInfo = { ...STUB_HOST_INFO, hostId: 'h_rebuilt0', name: 'kb-ec2-new' };
    const res = await request(app).patch(`${BASE}/${added.id}`).send({ token: TOKEN_2 });
    expect(res.status).toBe(200);
    expect(res.body.data.binding).toMatchObject({ hostId: 'h_rebuilt0', hostName: 'kb-ec2-new' });
    expect(storedHosts()[0]!.binding).toMatchObject({ hostId: 'h_rebuilt0', hostName: 'kb-ec2-new' });
  });

  it('[ac:ac-zmiana-url-a-na-url-innego-rekordu-da] changing the URL to another record\'s URL gives 409', async () => {
    const a = await newStub();
    const b = await newStub();
    await addConnected(a);
    const second = await addConnected(b);
    const res = await request(app).patch(`${BASE}/${second.id}`).send({ url: `${a.url()}/` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RUNNER_HOST_DUPLICATE');
    expect(storedHosts().map((h) => h.url)).toEqual([a.url(), b.url()]);
  });

  // --- test -----------------------------------------------------------------

  it('[ac:ac-test-nieosiagalnego-hosta-konczy-sie] testing an unreachable host answers within 15 s', async () => {
    const stub = await newStub();
    stub.onHost = () => {}; // never answers
    const adding = start(request(app).post(BASE).send({ url: stub.url(), token: TOKEN }));
    await until(() => stub.count('/host') === 1, 5_000, 'GET /host of the add');
    const added = (await settleWithin(adding, 15_000)).res.body.data as Body;

    expect(added.status).toBe('unreachable');

    const before = stub.count('/host');
    const testing = start(request(app).post(`${BASE}/${added.id}/test`));
    await until(() => stub.count('/host') > before, 5_000, 'GET /host of the test');
    const { res, elapsedMs } = await settleWithin(testing, 15_000);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('unreachable');
    expect(elapsedMs).toBeLessThanOrEqual(15_000);
  });

  it('[ac:ac-test-z-rebind-zapisuje-nowe-powiazani] a test with `rebind`, when the host answers with another `hostId`, stores the new binding', async () => {
    const stub = await newStub();
    const added = await addConnected(stub);
    // Same token, another identity at this address.
    stub.hostInfo = { ...STUB_HOST_INFO, hostId: 'h_rebuilt0' };
    stub.send('host', stub.hostInfo);
    await until(() => viewOf(added.id as string)?.state.status === 'other-host', 5_000, 'other-host');

    // Without consent the binding stays.
    const plain = await request(app).post(`${BASE}/${added.id}/test`).send({});
    expect(plain.body.data.status).toBe('other-host');
    expect(storedHosts()[0]!.binding).toMatchObject({ hostId: STUB_HOST_INFO.hostId });

    const res = await request(app).post(`${BASE}/${added.id}/test`).send({ rebind: true });
    expect(res.status).toBe(200);
    expect(res.body.data.binding).toMatchObject({ hostId: 'h_rebuilt0' });
    expect(res.body.data.status).toBe('connected');
    expect(storedHosts()[0]!.binding).toMatchObject({ hostId: 'h_rebuilt0' });
  });

  // --- unknown id -------------------------------------------------------------

  it('[ac:ac-zmiana-nieznanego-id-daje-404] changing an unknown `id` gives 404', async () => {
    const res = await request(app).patch(`${BASE}/no-such-id`).send({ label: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('[ac:ac-test-nieznanego-id-daje-404] testing an unknown `id` gives 404', async () => {
    const res = await request(app).post(`${BASE}/no-such-id/test`).send({ rebind: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('[ac:ac-usuniecie-nieznanego-id-daje-404] removing an unknown `id` gives 404', async () => {
    const res = await request(app).delete(`${BASE}/no-such-id`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // --- input rules: 400 on add and on change, nothing written ------------------

  /**
   * One refused value, on add (POST) and on change (PATCH of an existing,
   * connected record): both 400 VALIDATION, the file untouched.
   */
  const refusedOnAddAndChange = async (field: 'url' | 'token', values: string[]) => {
    const stub = await newStub();
    const added = await addConnected(stub);
    const fileBefore = registryText();
    for (const value of values) {
      const body = field === 'url' ? { url: value, token: TOKEN_2 } : { url: `${stub.url()}/other`, token: value };
      const onAdd = await request(app).post(BASE).send(body);
      expect(onAdd.status, `POST ${field}=${JSON.stringify(value)}`).toBe(400);
      expect(onAdd.body.error.code).toBe('VALIDATION');
      expect(onAdd.text).not.toContain(TOKEN_2);

      const onChange = await request(app).patch(`${BASE}/${added.id}`).send({ [field]: value });
      expect(onChange.status, `PATCH ${field}=${JSON.stringify(value)}`).toBe(400);
      expect(onChange.body.error.code).toBe('VALIDATION');
    }
    expect(registryText()).toBe(fileBefore);
    expect(await list()).toHaveLength(1);
  };

  it('[ac:ac-url-niebedacy-absolutnym-http-s-daje] a URL that is not an absolute http(s) one gives 400', async () => {
    await refusedOnAddAndChange('url', ['localhost:7777', '/runner', 'not a url', 'ftp://127.0.0.1:7777', 'ws://127.0.0.1:7777']);
  });

  it('[ac:ac-url-z-adresem-0-0-0-0-daje-400] a URL with the address `0.0.0.0` gives 400', async () => {
    await refusedOnAddAndChange('url', ['http://0.0.0.0:7777', 'https://0.0.0.0']);
  });

  it('[ac:ac-url-z-fragmentem-daje-400] a URL with a fragment gives 400', async () => {
    await refusedOnAddAndChange('url', ['http://127.0.0.1:7777#host', 'http://127.0.0.1:7777/#']);
  });

  it('[ac:ac-url-z-query-daje-400] a URL with a query gives 400', async () => {
    await refusedOnAddAndChange('url', ['http://127.0.0.1:7777?a=1', 'http://127.0.0.1:7777/?']);
  });

  it('[ac:ac-url-z-userinfo-daje-400] a URL with userinfo gives 400', async () => {
    await refusedOnAddAndChange('url', ['http://user:pw@127.0.0.1:7777', 'http://user@127.0.0.1:7777']);
  });

  it('[ac:ac-token-bez-prefiksu-tokenu-mastera-daj] a token without the master-token prefix gives 400', async () => {
    await refusedOnAddAndChange('token', ['Q1w2E3r4T5y6U7i8O9p0AsDfGhJkL', 'c4s_Q1w2E3r4T5y6', 'C4SR_Q1w2E3r4T5y6']);
  });

  it('[ac:ac-token-ze-znakiem-spoza-drukowalnego-a] a token with a character outside printable ASCII gives 400', async () => {
    await refusedOnAddAndChange('token', ['c4sr_Q1w2é3r4', 'c4sr_Q1w2\u0001E3r4', 'c4sr_Q1w2\tE3r4', 'c4sr_Q1w2E3r4🔑']);
  });
});
