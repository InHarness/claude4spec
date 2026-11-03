import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GitService } from '../../src/server/services/git.js';
import { closeWorkspaceDbs, openWorkspaceDb } from '../../src/server/db/workspace-db.js';
import { remoteRunRegistry, type RemoteRunRegistry } from '../../src/server/runs/remote-run-registry.js';
import type { RunRemoteDeps, RunRemoteHost } from '../../src/server/runs/run-remote.js';
import type { RunReadDeps } from '../../src/server/runs/run-read.js';

/**
 * Test fixture of `run_remote` (M55): a real repository whose `main` tracks
 * `origin/main` in a bare repository, laid out as
 *
 *   <repo>/                       repository root
 *   <repo>/ws/                    workspace home (`.claude4spec/workspace.json`)
 *   <repo>/ws/app/                the thread's project (`.claude4spec/config.json`)
 *   <repo>/ws/app/plans/p1.md     a plan, pushed
 *
 * the real workspace DB of the home, and a local HTTP stub of a runner's Runs
 * API — never a real `c4s-runner`.
 */

const pexec = promisify(execFile);

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout.trim();
}

export function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export interface RecordedPut {
  method: string;
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

export type RunnerReply = { status: number; body: Record<string, unknown> };

/** A runner's Runs API stub: records every request, answers with `reply` (default `202`). */
export class RunsApiStub {
  readonly server: http.Server;
  readonly requests: RecordedPut[] = [];
  reply: (req: RecordedPut) => RunnerReply = (req) => ({
    status: 202,
    body: { runId: req.url.split('/').pop(), state: 'queued' },
  });

  constructor() {
    this.server = http.createServer((req, res) => {
      let text = '';
      req.on('data', (c) => (text += c));
      req.on('end', () => {
        const recorded: RecordedPut = {
          method: req.method ?? '',
          url: req.url ?? '',
          authorization: req.headers.authorization,
          body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        };
        this.requests.push(recorded);
        const { status, body } = this.reply(recorded);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** A base URL nothing listens on. */
export async function deadUrl(): Promise<string> {
  const s = http.createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

export function host(id: string, url: string, over: Partial<RunRemoteHost> = {}): RunRemoteHost {
  return {
    id,
    name: `name-${id}`,
    url,
    token: `c4sr_token_${id}`,
    status: 'connected',
    hostId: `h_${id}`,
    capabilities: ['runs'],
    ...over,
  };
}

export interface RunRemoteFixture {
  tmp: string;
  bare: string;
  repo: string;
  home: string;
  project: string;
  plansDir: string;
  git: GitService;
  registry: RemoteRunRegistry;
  hosts: RunRemoteHost[];
  /**
   * The workspace's projects as `run_remote` reads them (`app` first, its plans
   * in `plansDir`); {@link addProject} appends to it.
   */
  projects: Array<{ id: string; plansRoot: string }>;
  /**
   * Add a project `ws/<id>/` to the workspace (and to `workspace.json`), with a
   * plan `p1.md` in its `.claude4spec/plans/`. Nothing is committed: call
   * {@link pushAll} when the test needs it on the upstream.
   */
  addProject(id: string): { dir: string; plansDir: string };
  /** `homeless: true` makes `workspace()` a registry workspace. */
  deps(over?: Partial<RunRemoteDeps> & { homeless?: boolean; pinned?: string | null }): RunRemoteDeps;
  /** Commit every change and push it. */
  pushAll(message: string): Promise<string>;
  upstreamTip(): Promise<string>;
  /** Push a commit changing `rel` from a second clone; returns the new remote tip. */
  pushFromOtherClone(rel: string, content: string): Promise<string>;
  /** `get_run` / `cancel_run` dependencies; one project (`app`) unless `projects` is given. */
  readDeps(over?: Partial<RunReadDeps> & { homeless?: boolean }): RunReadDeps;
  /**
   * What a Run leaves on the remote: from a second clone, a commit on `main`'s
   * tip that writes `files` (paths relative to the repository) and, as the tip,
   * the Run record `ws/.claude4spec/runs/<runId>/run.json`, pushed as
   * `refs/runs/<runId>/work`. Returns the tip sha (the runner's `resultSha`).
   */
  pushRunRecord(runId: string, record: Record<string, unknown>, files?: Record<string, string>): Promise<string>;
  /** Fast-forward the local `main` onto the shadow and push it — the acceptance as git sees it. */
  acceptShadow(runId: string): Promise<void>;
  /** Rows of `remote_run`. */
  rows(): Array<{ run_id: string; host_id: string }>;
  dispose(): void;
}

export async function makeRunRemoteFixture(opts: { gitEnabled?: boolean } = {}): Promise<RunRemoteFixture> {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-run-remote-')));
  const bare = path.join(tmp, 'remote.git');
  const repo = path.join(tmp, 'repo');
  const home = path.join(repo, 'ws');
  const project = path.join(home, 'app');
  const plansDir = path.join(project, 'plans');
  await pexec('git', ['init', '--bare', '-b', 'main', bare]);
  fs.mkdirSync(repo);
  await git(['init', '-b', 'main'], repo);
  await git(['config', 'user.email', 'test@example.com'], repo);
  await git(['config', 'user.name', 'Test'], repo);
  write(repo, '.gitignore', '.claude4spec/local/\n');
  write(home, '.claude4spec/workspace.json', JSON.stringify({ projects: [{ id: 'app', path: 'app' }] }, null, 2));
  write(
    project,
    '.claude4spec/config.json',
    JSON.stringify(
      {
        $schemaVersion: 4,
        name: 'app',
        roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
        git: { enabled: opts.gitEnabled ?? true },
      },
      null,
      2,
    ),
  );
  write(project, 'pages/index.md', '# index\n');
  write(plansDir, 'p1.md', '---\ntype: plan\ntitle: P1\n---\n# P1\n');
  await git(['add', '-A'], repo);
  await git(['commit', '-m', 'init'], repo);
  await git(['remote', 'add', 'origin', bare], repo);
  await git(['push', '-u', 'origin', 'main'], repo);

  const gitService = new GitService(project, [path.join(project, 'pages')]);
  const registry = remoteRunRegistry(() => openWorkspaceDb({ name: 'ws', home }));
  const hosts: RunRemoteHost[] = [];
  const projects: Array<{ id: string; plansRoot: string }> = [{ id: 'app', plansRoot: plansDir }];

  const fixture: RunRemoteFixture = {
    tmp,
    bare,
    repo,
    home,
    project,
    plansDir,
    git: gitService,
    registry,
    hosts,
    projects,
    addProject(id) {
      const dir = path.join(home, id);
      const projectPlans = path.join(dir, '.claude4spec/plans');
      write(dir, '.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: id }, null, 2));
      write(projectPlans, 'p1.md', `---\ntype: plan\ntitle: ${id} P1\n---\n# ${id} P1\n`);
      projects.push({ id, plansRoot: projectPlans });
      write(
        home,
        '.claude4spec/workspace.json',
        JSON.stringify({ projects: [{ id: 'app', path: 'app' }, ...projects.slice(1).map((p) => ({ id: p.id, path: p.id }))] }, null, 2),
      );
      return { dir, plansDir: projectPlans };
    },
    deps(over = {}) {
      const { homeless, pinned, ...rest } = over;
      return {
        workspace: () => (homeless ? { name: 'ws' } : { name: 'ws', home }),
        projectId: 'app',
        git: gitService,
        plans: {
          rootDir: plansDir,
          pinnedPlanPath: () => (pinned === undefined ? 'p1.md' : pinned),
          exists: async (p) => fs.existsSync(path.join(plansDir, p)),
        },
        projects: () => projects,
        hosts: () => hosts,
        registry: () => registry,
        ...rest,
      };
    },
    readDeps(over = {}) {
      const { homeless, ...rest } = over;
      return {
        workspace: () => (homeless ? { name: 'ws' } : { name: 'ws', home }),
        git: gitService,
        projects: () => [{ projectId: 'app', git: gitService }],
        hosts: () => hosts,
        registry: () => registry,
        ...rest,
      };
    },
    async pushRunRecord(runId, record, files = {}) {
      const other = path.join(tmp, `run-${runId}-${Math.random().toString(36).slice(2)}`);
      await pexec('git', ['clone', bare, other]);
      await git(['config', 'user.email', 'runner@example.com'], other);
      await git(['config', 'user.name', 'Runner'], other);
      if (Object.keys(files).length > 0) {
        for (const [rel, content] of Object.entries(files)) write(other, rel, content);
        await git(['add', '-A'], other);
        await git(['commit', '-m', `run ${runId}: work`], other);
      }
      write(other, `ws/.claude4spec/runs/${runId}/run.json`, JSON.stringify(record, null, 2));
      await git(['add', '-A'], other);
      await git(['commit', '-m', `run ${runId}: record`], other);
      await git(['push', 'origin', `HEAD:refs/runs/${runId}/work`], other);
      return git(['rev-parse', 'HEAD'], other);
    },
    async acceptShadow(runId) {
      await git(['fetch', 'origin', `+refs/runs/${runId}/work:refs/runs/${runId}/work`], repo);
      await git(['merge', '--ff-only', `refs/runs/${runId}/work`], repo);
      await git(['push'], repo);
    },
    async pushAll(message) {
      await git(['add', '-A'], repo);
      await git(['commit', '-m', message], repo);
      await git(['push'], repo);
      return git(['rev-parse', 'HEAD'], repo);
    },
    upstreamTip: () => git(['rev-parse', 'main'], bare),
    async pushFromOtherClone(rel, content) {
      const other = path.join(tmp, `other-${Math.random().toString(36).slice(2)}`);
      await pexec('git', ['clone', bare, other]);
      await git(['config', 'user.email', 'other@example.com'], other);
      await git(['config', 'user.name', 'Other'], other);
      write(other, rel, content);
      await git(['add', '-A'], other);
      await git(['commit', '-m', `other: ${rel}`], other);
      await git(['push'], other);
      return git(['rev-parse', 'HEAD'], other);
    },
    rows() {
      return openWorkspaceDb({ name: 'ws', home })
        .prepare('SELECT run_id, host_id FROM remote_run ORDER BY created_at, run_id')
        .all() as Array<{ run_id: string; host_id: string }>;
    },
    dispose() {
      closeWorkspaceDbs();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  return fixture;
}
