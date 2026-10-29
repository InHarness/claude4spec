import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { loadBuiltinEnvelopes, type PluginLoadRecord } from '../../../src/server/core/plugin-host/loader.js';
import { FileWatchRuntime } from '../../../src/server/fs/watcher.js';
import { WsGateway } from '../../../src/server/ws/gateway.js';
import { buildProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { bootstrapProject } from '../../../src/server/workspace/bootstrap.js';
import { configPath, migrateConfigToV3, migrateConfigToV4 } from '../../../src/server/config.js';
import type { WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.17 — M01 `3zqke46q`: a project from before the `skills` system root
 * (2.1.9) whose `roots[]` collides with it — by `id: skills`, or by a `dir` at
 * or under `.claude4spec/skills` — does not start after the upgrade, and the
 * loader migrates nothing: `config.json` stays byte for byte as it was.
 *
 * "Start" is the real path the server runs: `buildProjectContext` (project
 * activation, incl. the loader's migrations) and `bootstrapProject` (the CLI
 * `--cwd` activation). The fixtures carry legacy keys (`port`, `mode`, an older
 * `$schemaVersion`, `git.syncCommitOnRelease`) so that, without the collision,
 * both loader migrations WOULD rewrite the file — a pass here proves they refuse
 * to, not that there was nothing to do.
 */
describe('M01 — a pre-`skills` project whose roots[] collides with the skills system root', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let pluginRegistry: PluginRegistryImpl;
  let pluginRecords: PluginLoadRecord[];
  let httpServer: http.Server;
  let gateway: WsGateway;
  let watchRuntime: FileWatchRuntime;
  let seq = 0;

  const base = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };

  /** A project written by a release before 2.1.9 — legacy keys a migration would rewrite. */
  function legacyProject(userRoot: { id: string; name: string; dir: string; builtin: boolean }): {
    cwd: string;
    bytes: string;
  } {
    const cwd = path.join(home, `project-${++seq}`);
    const file = configPath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes =
      JSON.stringify(
        {
          $schemaVersion: 2,
          name: 'Legacy',
          port: 4123,
          mode: 'prod',
          roots: [base, userRoot],
          git: { syncCommitOnRelease: true },
        },
        null,
        4,
      ) + '\n';
    fs.writeFileSync(file, bytes);
    return { cwd, bytes };
  }

  const start = (cwd: string) =>
    buildProjectContext({
      registry,
      pluginRegistry,
      pluginRecords,
      frontendBase: { workspacePackages: [], envelopes: [], resolveWorkspaceRoot: () => null },
      workspace,
      projectId: `collision-${seq}`,
      cwd,
      gateway,
      watchRuntime,
      mode: 'prod',
    });

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skills-collision-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    workspace = registry.selectOrCreate({ name: 'default' });
    pluginRegistry = new PluginRegistryImpl();
    pluginRecords = (await loadBuiltinEnvelopes(pluginRegistry)).records;
    httpServer = http.createServer();
    gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
  }, 60_000);

  afterAll(async () => {
    await watchRuntime.close();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('[ac:ac-projekt-sprzed-korzenia-systemowego-s] a user root whose dir equals `.claude4spec/skills`, or lies under it, makes the project not start — the config load fails with the namespace-overlap error (D4)', async () => {
    for (const dir of ['.claude4spec/skills', '.claude4spec/skills/generated']) {
      const { cwd } = legacyProject({ id: 'gen', name: 'Generated', dir, builtin: false });
      // Project activation (the server's start of a project).
      await expect(start(cwd), dir).rejects.toThrow("config.json: 'gen' overlaps write-target 'skills'");
      // The CLI `--cwd` activation fails the same way, before the project is registered.
      expect(() => bootstrapProject(registry, workspace, cwd), dir).toThrow(
        "config.json: 'gen' overlaps write-target 'skills'",
      );
      expect(registry.getWorkspace('default')!.projects.some((p) => p.cwd === cwd), dir).toBe(false);
    }
    // Control: the same legacy project with a non-colliding dir is NOT refused by
    // the overlap rule — the error above is the collision, not the legacy shape.
    const ok = legacyProject({ id: 'gen', name: 'Generated', dir: 'generated', builtin: false });
    expect(() => migrateConfigToV4(ok.cwd)).not.toThrow();
  });

  it('[ac:ac-nieudany-start-projektu-ktorego-roots] the failed start of a project whose roots[] collides with the `skills` system root (id `skills`, dir `.claude4spec/skills` or under it) leaves config.json unchanged — the loader migrates nothing', async () => {
    const colliding = [
      { id: 'skills', name: 'Skills', dir: 'my-skills', builtin: false },
      { id: 'gen', name: 'Generated', dir: '.claude4spec/skills', builtin: false },
      { id: 'gen', name: 'Generated', dir: '.claude4spec/skills/generated', builtin: false },
    ];
    for (const entry of colliding) {
      const label = `${entry.id} @ ${entry.dir}`;
      const { cwd, bytes } = legacyProject(entry);
      const file = configPath(cwd);

      await expect(start(cwd), label).rejects.toThrow(
        entry.id === 'skills' ? /root id 'skills' is reserved for a system root/ : /overlaps write-target 'skills'/,
      );
      expect(fs.readFileSync(file, 'utf8'), label).toBe(bytes);

      expect(() => bootstrapProject(registry, workspace, cwd), label).toThrow();
      expect(fs.readFileSync(file, 'utf8'), label).toBe(bytes);

      // Each loader migration on its own (the CLI peeks v3 before bootstrap):
      // refused, and nothing written — no format bump, no rewrite of the entry.
      expect(() => migrateConfigToV3(cwd), label).toThrow();
      expect(() => migrateConfigToV4(cwd), label).toThrow();
      expect(fs.readFileSync(file, 'utf8'), label).toBe(bytes);
    }

    // Control: without the collision the same legacy file IS migrated — so the
    // byte-equality above is the loader refusing, not a file it had nothing to do to.
    const ok = legacyProject({ id: 'gen', name: 'Generated', dir: 'generated', builtin: false });
    expect(migrateConfigToV4(ok.cwd).migrated).toBe(true);
    expect(fs.readFileSync(configPath(ok.cwd), 'utf8')).not.toBe(ok.bytes);
  });
});
