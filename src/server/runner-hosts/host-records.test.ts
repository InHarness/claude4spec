import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { decrypt } from '../services/agent-credential-crypto.js';
import { WorkspaceRegistry } from '../workspace/registry.js';
import type { WorkspaceRecord } from '../workspace/types.js';
import { RunnerHostError } from './host-input.js';
import { RunnerHostStore, type RunnerHostBinding } from './host-records.js';

const pexecFile = promisify(execFile);

/**
 * M54 `fo9bukuw` / `4pxwyo22` / `qc6t2y7m` — the runner-host record store.
 * Every test runs on a temp registry dir with `C4S_HOME` pointed at it (the
 * secrets primitive's `secret.key` lands there), never the developer's
 * `~/.claude4spec`.
 */
describe('M54 runner-host records (fo9bukuw, 4pxwyo22)', () => {
  let dir: string;
  let registryDir: string;
  let savedC4sHome: string | undefined;

  const TOKEN = 'c4sr_Q1w2E3r4T5y6U7i8O9p0AsDfGhJkL';
  const binding: RunnerHostBinding = {
    hostId: 'host-7f3a',
    hostName: 'build-box',
    runnerVersion: '0.4.1',
    startedAt: '2026-10-29T08:00:00.000Z',
  };

  const registryFile = () => path.join(registryDir, 'workspaces.json');
  const readEntry = (name: string) =>
    JSON.parse(fs.readFileSync(registryFile(), 'utf8')).workspaces.find((w: { name: string }) => w.name === name);
  /** Every file under `root`, recursively, as text. */
  const filesUnder = (root: string): Array<{ file: string; text: string }> => {
    if (!fs.existsSync(root)) return [];
    const out: Array<{ file: string; text: string }> = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) out.push(...filesUnder(p));
      else if (e.isFile()) out.push({ file: p, text: fs.readFileSync(p, 'utf8') });
    }
    return out;
  };

  /** A workspace with a home and one registered project carrying a `config.json`. */
  const homeWorkspace = () => {
    const home = path.join(dir, 'repo');
    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ cwd: home, userHome: path.join(dir, 'user-home') });
    const projectDir = path.join(home, 'proj');
    fs.mkdirSync(path.join(projectDir, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.claude4spec', 'config.json'), JSON.stringify({ name: 'proj' }, null, 2));
    registry.registerProject(ws, projectDir);
    return { registry, ws, home, projectDir };
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-runner-hosts-'));
    registryDir = path.join(dir, 'registry');
    savedC4sHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;
  });
  afterEach(() => {
    if (savedC4sHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = savedC4sHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('[ac:ac-dodany-host-pojawia-sie-w-runnerhosts] an added host appears in runnerHosts of the CURRENT workspace entry in workspaces.json, as id + normalized url + label + encrypted token with last4 + empty binding', () => {
    const registry = new WorkspaceRegistry(registryDir);
    const current = registry.selectOrCreate({ name: 'default' });
    registry.selectOrCreate({ name: 'other' });

    const added = new RunnerHostStore(registry, current).add({
      url: '  HTTP://Build-Box.Local:7000/ ',
      token: `  ${TOKEN} `,
      label: ' lab ',
    });

    const hosts = readEntry('default').runnerHosts;
    expect(hosts).toHaveLength(1);
    expect(Object.keys(hosts[0]).sort()).toEqual(['binding', 'id', 'label', 'tokenCiphertext', 'tokenLast4', 'url']);
    expect(hosts[0]).toMatchObject({
      id: added.id,
      url: 'http://build-box.local:7000',
      label: 'lab',
      tokenLast4: TOKEN.slice(-4),
      binding: null,
    });
    expect(typeof hosts[0].id).toBe('string');
    expect(hosts[0].id.length).toBeGreaterThan(0);
    // Only the current workspace's entry got the record.
    expect(readEntry('other').runnerHosts).toBeUndefined();
    // The store reads it back from the file.
    expect(new RunnerHostStore(new WorkspaceRegistry(registryDir), current).list()).toEqual([added]);
  });

  it('[ac:ac-dodany-host-nie-pojawia-sie-w-config] an added host does not appear in the config.json of any project (registry and home workspaces)', () => {
    const { registry, ws, projectDir } = homeWorkspace();
    const regProjectDir = path.join(dir, 'reg-proj');
    fs.mkdirSync(path.join(regProjectDir, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(regProjectDir, '.claude4spec', 'config.json'), JSON.stringify({ name: 'reg' }, null, 2));
    const regWs = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(regWs, regProjectDir);

    const configs = [projectDir, regProjectDir].map((p) => path.join(p, '.claude4spec', 'config.json'));
    const before = configs.map((f) => fs.readFileSync(f, 'utf8'));

    const a = new RunnerHostStore(registry, ws).add({ url: 'http://runner-a.local:7000', token: TOKEN, label: 'alpha' });
    const b = new RunnerHostStore(registry, regWs).add({ url: 'http://runner-b.local:7000', token: TOKEN, label: 'beta' });

    configs.forEach((f, i) => {
      const text = fs.readFileSync(f, 'utf8');
      expect(text).toBe(before[i]);
      for (const needle of ['runnerHosts', a.id, b.id, 'runner-a.local', 'runner-b.local', a.tokenCiphertext, TOKEN]) {
        expect(text).not.toContain(needle);
      }
    });
    // ...while both records are in the registry.
    expect(readEntry(ws.name).runnerHosts.map((h: { id: string }) => h.id)).toEqual([a.id]);
    expect(readEntry('default').runnerHosts.map((h: { id: string }) => h.id)).toEqual([b.id]);
  });

  it('[ac:ac-dodany-host-nie-pojawia-sie-w-workspa] an added host does not appear in the committed workspace.json of the workspace home', () => {
    const { registry, ws, home } = homeWorkspace();
    const workspaceJson = path.join(home, '.claude4spec', 'workspace.json');
    const before = fs.readFileSync(workspaceJson, 'utf8');

    const added = new RunnerHostStore(registry, ws).add({ url: 'http://runner.local:7000', token: TOKEN, label: 'lab' });
    new RunnerHostStore(registry, ws).update(added.id, { label: 'renamed', url: 'http://moved.local:7000' });

    const after = fs.readFileSync(workspaceJson, 'utf8');
    expect(after).toBe(before);
    for (const needle of ['runnerHosts', added.id, 'runner.local', 'moved.local', added.tokenCiphertext, TOKEN]) {
      expect(after).not.toContain(needle);
    }
    expect(readEntry(ws.name).runnerHosts).toHaveLength(1);
  });

  it('[ac:ac-dodany-host-nie-pojawia-sie-w-zadnym] an added host does not appear in any file under <home>/.claude4spec/local/', () => {
    const { registry, ws, home } = homeWorkspace();
    const localDir = path.join(home, '.claude4spec', 'local');

    const added = new RunnerHostStore(registry, ws).add({ url: 'http://runner.local:7000', token: TOKEN, label: 'lab' });
    // A registration after the add writes under local/ (the workspace.json lock) — still nothing of the host.
    const second = path.join(home, 'proj-2');
    fs.mkdirSync(second, { recursive: true });
    registry.registerProject(ws, second);

    expect(fs.existsSync(localDir)).toBe(true);
    for (const { file, text } of filesUnder(localDir)) {
      for (const needle of ['runnerHosts', added.id, 'runner.local', added.tokenCiphertext, added.tokenLast4, TOKEN]) {
        expect(text, file).not.toContain(needle);
      }
    }
    expect(readEntry(ws.name).runnerHosts.map((h: { id: string }) => h.id)).toEqual([added.id]);
  });

  it('[ac:ac-plik-rejestru-nie-zawiera-tokenu-jawn] the registry file never holds the token in plain text — after add and after a token change — while the ciphertext decrypts back with the M05 key kept outside the home', () => {
    const { registry, ws, home } = homeWorkspace();
    const store = new RunnerHostStore(registry, ws);
    const added = store.add({ url: 'http://runner.local:7000', token: TOKEN });

    let bytes = fs.readFileSync(registryFile(), 'utf8');
    expect(bytes).not.toContain(TOKEN);
    expect(bytes).not.toContain(TOKEN.slice('c4sr_'.length));
    const stored = readEntry(ws.name).runnerHosts[0];
    expect(stored.tokenLast4).toBe(TOKEN.slice(-4));
    expect(stored.tokenCiphertext).not.toContain(TOKEN);
    expect(decrypt(stored.tokenCiphertext)).toBe(TOKEN);

    const NEW_TOKEN = 'c4sr_zXcVbNm0987654321PoIuYtReWq';
    store.updateBinding(added.id, binding);
    const changed = store.update(added.id, { token: NEW_TOKEN });
    bytes = fs.readFileSync(registryFile(), 'utf8');
    expect(bytes).not.toContain(NEW_TOKEN);
    expect(bytes).not.toContain(TOKEN);
    expect(changed.tokenLast4).toBe(NEW_TOKEN.slice(-4));
    expect(decrypt(readEntry(ws.name).runnerHosts[0].tokenCiphertext)).toBe(NEW_TOKEN);
    // A new token clears the binding.
    expect(readEntry(ws.name).runnerHosts[0].binding).toBeNull();

    // The key is the global one in the registry dir — never under the workspace home.
    expect(fs.existsSync(path.join(registryDir, 'secret.key'))).toBe(true);
    expect(filesUnder(home).some(({ file }) => path.basename(file) === 'secret.key')).toBe(false);
  });

  it('[ac:ac-rownolegle-dodanie-w-dwoch-procesach] parallel adds in two processes keep both records (and every record of each)', async () => {
    const registry = new WorkspaceRegistry(registryDir);
    registry.selectOrCreate({ name: 'default' });
    // No secret.key yet: both children make their first encryption at once and must agree on one key.
    expect(fs.existsSync(path.join(registryDir, 'secret.key'))).toBe(false);

    const repoRoot = process.cwd();
    const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
    const storeModule = path.join(repoRoot, 'src', 'server', 'runner-hosts', 'host-records.ts');
    const registryModule = path.join(repoRoot, 'src', 'server', 'workspace', 'registry.ts');
    const probe = path.join(dir, 'add-hosts.mts');
    fs.writeFileSync(
      probe,
      `import { WorkspaceRegistry } from ${JSON.stringify(registryModule)};\n` +
        `import { RunnerHostStore } from ${JSON.stringify(storeModule)};\n` +
        `const [who, count] = [process.argv[2], Number(process.argv[3])];\n` +
        `const registry = new WorkspaceRegistry(process.env.C4S_HOME);\n` +
        // The view is taken once, before any write — like a long-lived server process.
        `const ws = registry.getWorkspace('default');\n` +
        `const store = new RunnerHostStore(registry, ws);\n` +
        `const ids = [];\n` +
        `for (let i = 0; i < count; i++) ids.push(store.add({ url: 'http://' + who + '-' + i + '.local:7000', token: ${JSON.stringify(TOKEN)} }).id);\n` +
        `process.stdout.write(JSON.stringify(ids));\n`,
    );
    const run = (who: string) =>
      pexecFile(tsx, [probe, who, '6'], { cwd: repoRoot, env: { ...process.env, C4S_HOME: registryDir }, encoding: 'utf8' });

    const [a, b] = await Promise.all([run('alpha'), run('beta')]);
    const idsA = JSON.parse(a.stdout) as string[];
    const idsB = JSON.parse(b.stdout) as string[];

    const hosts = readEntry('default').runnerHosts as Array<{ id: string; url: string; tokenCiphertext: string }>;
    expect(hosts).toHaveLength(12);
    expect(hosts.map((h) => h.id).sort()).toEqual([...idsA, ...idsB].sort());
    expect(new Set(hosts.map((h) => h.url)).size).toBe(12);
    // Every stored token is readable with the one key both processes share.
    for (const h of hosts) expect(decrypt(h.tokenCiphertext)).toBe(TOKEN);
    expect(fs.readdirSync(registryDir).filter((f) => f.startsWith('secret.key'))).toEqual(['secret.key']);
    expect(fs.existsSync(registryFile() + '.lock')).toBe(false);
  }, 60_000);

  it('[ac:ac-rownolegle-dodanie-w-dwoch-procesach] two writers whose views were both taken before either add keep both records — the duplicate check runs on the file', () => {
    const first = new WorkspaceRegistry(registryDir);
    const ws = first.selectOrCreate({ name: 'default' });
    const second = new WorkspaceRegistry(registryDir);
    const viewOfSecond = second.getWorkspace('default') as WorkspaceRecord;
    const storeA = new RunnerHostStore(first, ws);
    const storeB = new RunnerHostStore(second, viewOfSecond);
    // Both "processes" list before anything is added: their views are empty.
    expect(storeA.list()).toEqual([]);
    expect(storeB.list()).toEqual([]);

    const a = storeA.add({ url: 'http://runner-a.local:7000', token: TOKEN });
    const b = storeB.add({ url: 'http://runner-b.local:7000', token: TOKEN });
    expect(readEntry('default').runnerHosts.map((h: { id: string }) => h.id)).toEqual([a.id, b.id]);

    // The same normalized url from the other writer is a duplicate, though its view never saw it.
    let err: unknown;
    try {
      storeB.add({ url: 'HTTP://Runner-A.local:7000/', token: TOKEN });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RunnerHostError);
    expect((err as RunnerHostError).code).toBe('RUNNER_HOST_DUPLICATE');
    expect(readEntry('default').runnerHosts).toHaveLength(2);
  });

  it('[ac:ac-usuniecie-rekordu-w-jednym-procesie-i] removing a record in one process and updating its binding in another does not bring the record back', () => {
    const remover = new WorkspaceRegistry(registryDir);
    const ws = remover.selectOrCreate({ name: 'default' });
    const removerStore = new RunnerHostStore(remover, ws);
    const doomed = removerStore.add({ url: 'http://doomed.local:7000', token: TOKEN });
    const kept = removerStore.add({ url: 'http://kept.local:7000', token: TOKEN });

    // The other process took its view while the record still existed.
    const binder = new WorkspaceRegistry(registryDir);
    const binderStore = new RunnerHostStore(binder, binder.getWorkspace('default') as WorkspaceRecord);
    const view = binderStore.list();
    expect(view.map((h) => h.id)).toEqual([doomed.id, kept.id]);

    removerStore.remove(doomed.id);
    expect(binderStore.updateBinding(doomed.id, binding)).toBeNull();

    const hosts = readEntry('default').runnerHosts as Array<{ id: string; binding: unknown }>;
    expect(hosts.map((h) => h.id)).toEqual([kept.id]);
    expect(hosts[0]?.binding).toBeNull();
    // A binding update of a record that is there still lands.
    expect(binderStore.updateBinding(kept.id, binding)?.binding).toEqual(binding);
    expect(readEntry('default').runnerHosts).toEqual([{ ...kept, binding }]);
  });

  it('[section:fo9bukuw] a url change keeps the binding, is checked for duplicates, and keeps the id; unknown fields of a record survive every write', () => {
    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const store = new RunnerHostStore(registry, ws);
    const a = store.add({ url: 'http://a.local:7000', token: TOKEN, label: 'a' });
    const b = store.add({ url: 'http://b.local:7000', token: TOKEN });
    store.updateBinding(a.id, binding);

    // A newer binary wrote a field into record a that this process does not know.
    const onDisk = JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
    onDisk.workspaces[0].runnerHosts[0].futureField = { x: 1 };
    fs.writeFileSync(registryFile(), JSON.stringify(onDisk, null, 2));

    const moved = store.update(a.id, { url: 'https://proxy.local/runner-a/' });
    expect(moved.id).toBe(a.id);
    expect(moved.url).toBe('https://proxy.local/runner-a');
    expect(moved.binding).toEqual(binding);
    expect(() => store.update(b.id, { url: 'HTTPS://proxy.local:443/runner-a' })).toThrow(RunnerHostError);
    // Re-saving its own url is not a duplicate of itself.
    expect(store.update(a.id, { url: 'https://proxy.local/runner-a', label: '' }).label).toBeUndefined();
    expect(() => store.update('missing', { label: 'x' })).toThrow(/not found/);
    expect(() => store.remove('missing')).toThrow(/not found/);

    const stored = readEntry('default').runnerHosts[0];
    expect(stored.futureField).toEqual({ x: 1 });
    expect(stored.binding).toEqual(binding);
    expect('label' in stored).toBe(false);
  });

  it('[section:4pxwyo22] a refused write (validation, duplicate) leaves the registry file byte-for-byte as it was', () => {
    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const store = new RunnerHostStore(registry, ws);
    store.add({ url: 'http://a.local:7000', token: TOKEN });
    const before = fs.readFileSync(registryFile(), 'utf8');

    expect(() => store.add({ url: 'http://0.0.0.0:7000', token: TOKEN })).toThrow(RunnerHostError);
    expect(() => store.add({ url: 'http://c.local:7000', token: 'not-a-master-token' })).toThrow(RunnerHostError);
    expect(() => store.add({ url: 'http://A.local:7000/', token: TOKEN })).toThrow(RunnerHostError);
    expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before);
  });
});
