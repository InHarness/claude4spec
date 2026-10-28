import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { WorkspaceFileError, workspaceFilePath, type WorkspaceFileErrorCode } from './home-workspace.js';
import { readSlotMarker, writeSlotMarker } from './slot-marker.js';
import { migrateLegacyDbIfNeeded } from './db-migration.js';
import { listWorkspaces } from './list-workspaces.js';

/**
 * 2.1.58 (M31 `vaa83o17`, `t97gncju`, `4y64rsxf`, `44viw74p`, `fzno8pd4`,
 * `vzkw903j`): the workspace with a home directory — the committed
 * `<home>/.claude4spec/workspace.json` composed with the machine-local registry
 * entry into one view, validated before listen (`openView`, which the
 * launcher's `prepareStart` calls before `startServer` binds the port).
 *
 * Every test runs over a throwaway registry home AND a throwaway repo — nothing
 * touches the developer's `~/.claude4spec`.
 */
describe('M31 — workspace with a home directory', () => {
  let tmp: string;
  let registryHome: string;
  let home: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-home-ws-'));
    registryHome = path.join(tmp, 'registry');
    home = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.mkdirSync(registryHome, { recursive: true });
    fs.writeFileSync(
      path.join(registryHome, 'workspaces.json'),
      JSON.stringify({
        $schemaVersion: 3,
        workspaces: [{ name: 'team', mode: 'prod', defaultPort: 4601, home }],
      }),
    );
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const writeWorkspaceFile = (content: unknown): void => {
    fs.writeFileSync(
      workspaceFilePath(home),
      typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    );
  };
  const readRegistryEntry = (): Record<string, unknown> =>
    (JSON.parse(fs.readFileSync(path.join(registryHome, 'workspaces.json'), 'utf8')) as {
      workspaces: Record<string, unknown>[];
    }).workspaces[0]!;

  /** The refusal the start gets: `openView` is the step the launcher (`prepareStart`) runs before listen. */
  const startRefusal = (): WorkspaceFileError => {
    try {
      new WorkspaceRegistry(registryHome).openView('team');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceFileError);
      return err as WorkspaceFileError;
    }
    throw new Error('expected the start to be refused');
  };

  it('[ac:ac-workspace-json-nie-zawiera-zadnego-at] workspace.json carries no machine-local attribute — mode, defaultPort, bindHost, publicUrl, lastOpened, lastOpenedProject, trust stay in the registry entry', () => {
    writeWorkspaceFile({ projects: [], plugins: ['@acme/c4s-plugin-x'] });
    const registry = new WorkspaceRegistry(registryHome);
    const ws = registry.openView('team');

    // Every server write that touches either file.
    const project = registry.registerProject(ws, path.join(home, 'specs', 'app'));
    registry.setNetwork('team', { bindHost: '0.0.0.0', publicUrl: 'https://specs.example.com' });
    registry.touchLastOpened('team', project.id);
    registry.setProjectTrust(ws, project.id, true);
    registry.setSpecSkillHooksTrust(ws, project.id, true);
    registry.selectOrCreate({ name: 'team' });

    const text = fs.readFileSync(workspaceFilePath(home), 'utf8');
    const onDisk = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual(['plugins', 'projects']);
    expect(onDisk.projects).toEqual([{ id: project.id, path: 'specs/app' }]);
    expect(onDisk.plugins).toEqual(['@acme/c4s-plugin-x']);
    for (const key of [
      'mode',
      'defaultPort',
      'bindHost',
      'publicUrl',
      'lastOpened',
      'lastOpenedProject',
      'trustProjectPlugins',
      'trustSpecSkillHooks',
      'projectTrust',
    ]) {
      expect(text).not.toContain(`"${key}"`);
    }

    // …and they did land — in the machine-local registry entry.
    const entry = readRegistryEntry();
    expect(entry).toMatchObject({
      mode: 'prod',
      defaultPort: 4601,
      bindHost: '0.0.0.0',
      publicUrl: 'https://specs.example.com',
      home,
      projectTrust: { [project.id]: { path: 'specs/app', trustProjectPlugins: true, trustSpecSkillHooks: true } },
    });
    expect(typeof entry.lastOpened).toBe('string');
    expect(entry.lastOpenedProject).toBe(project.id);
    // The registry entry of a home workspace holds no composition of its own.
    expect(entry.projects).toBeUndefined();
    expect(entry.plugins).toBeUndefined();
  });

  it('[ac:ac-start-procesu-w-workspace-ie-z-katalo] the start creates <home>/.claude4spec/.gitignore with the single entry local/ when it is absent', () => {
    writeWorkspaceFile({ projects: [], plugins: [] });
    const gitignore = path.join(home, '.claude4spec', '.gitignore');
    expect(fs.existsSync(gitignore)).toBe(false);

    new WorkspaceRegistry(registryHome).openView('team');

    expect(fs.readFileSync(gitignore, 'utf8')).toBe('local/\n');
  });

  it('[ac:ac-start-procesu-w-workspace-ie-z-katalo] the start appends local/ to an existing .gitignore that lacks it, keeps the other lines, and never duplicates it', () => {
    writeWorkspaceFile({ projects: [], plugins: [] });
    const gitignore = path.join(home, '.claude4spec', '.gitignore');
    fs.writeFileSync(gitignore, '*.tmp');

    new WorkspaceRegistry(registryHome).openView('team');
    expect(fs.readFileSync(gitignore, 'utf8')).toBe('*.tmp\nlocal/\n');

    // A second start finds the entry and leaves the file as it is.
    new WorkspaceRegistry(registryHome).openView('team');
    expect(fs.readFileSync(gitignore, 'utf8')).toBe('*.tmp\nlocal/\n');
  });

  it.each<[string, string | null]>([
    ['absent', null],
    ['not JSON', '{ "projects": [ '],
    ['not an object', '[]'],
    ['projects not an array', JSON.stringify({ projects: {}, plugins: [] })],
    ['plugins missing', JSON.stringify({ projects: [] })],
    ['an absolute project path', JSON.stringify({ projects: [{ id: 'a', path: '/abs/a' }], plugins: [] })],
    ['a project path with ..', JSON.stringify({ projects: [{ id: 'a', path: '../outside' }], plugins: [] })],
    ['a project path naming the home itself', JSON.stringify({ projects: [{ id: 'a', path: '.' }], plugins: [] })],
    ['a project entry that is not an object', JSON.stringify({ projects: ['specs/a'], plugins: [] })],
  ])(
    '[ac:ac-nieczytelny-albo-niezgodny-z-ksztalte] workspace.json %s refuses the start with WORKSPACE_FILE_INVALID and the file path',
    (_label, content) => {
      if (content !== null) writeWorkspaceFile(content);
      const err = startRefusal();
      expect(err.code).toBe<WorkspaceFileErrorCode>('WORKSPACE_FILE_INVALID');
      expect(err.file).toBe(workspaceFilePath(home));
      expect(err.message).toContain('WORKSPACE_FILE_INVALID');
      expect(err.message).toContain(workspaceFilePath(home));
      // Nothing is repaired: the file stays exactly as the human left it.
      if (content === null) expect(fs.existsSync(workspaceFilePath(home))).toBe(false);
      else expect(fs.readFileSync(workspaceFilePath(home), 'utf8')).toBe(content);
    },
  );

  it('[ac:ac-wpis-projektu-bez-id-w-workspace-json] a project entry without id refuses the start with WORKSPACE_PROJECT_ID_MISSING pointing at the entry', () => {
    const content = JSON.stringify({
      projects: [
        { id: 'api', path: 'specs/api' },
        { path: 'specs/web' },
      ],
      plugins: [],
    });
    writeWorkspaceFile(content);

    const err = startRefusal();

    expect(err.code).toBe<WorkspaceFileErrorCode>('WORKSPACE_PROJECT_ID_MISSING');
    expect(err.entry).toBe(1);
    expect(err.message).toContain('projects[1]');
    expect(err.message).toContain('specs/web');
    // The server never assigns the id itself — only adding a project does.
    expect(fs.readFileSync(workspaceFilePath(home), 'utf8')).toBe(content);
  });

  it('[ac:ac-id-powtorzony-w-workspace-json-blokuj] an id repeated in workspace.json refuses the start with WORKSPACE_PROJECT_ID_DUPLICATE, the id and both paths', () => {
    const content = JSON.stringify({
      projects: [
        { id: 'api', path: 'specs/api' },
        { id: 'web', path: 'specs/web' },
        { id: 'api', path: 'specs/api-v2' },
      ],
      plugins: [],
    });
    writeWorkspaceFile(content);

    const err = startRefusal();

    expect(err.code).toBe<WorkspaceFileErrorCode>('WORKSPACE_PROJECT_ID_DUPLICATE');
    expect(err.id).toBe('api');
    expect(err.paths).toEqual(['specs/api', 'specs/api-v2']);
    expect(err.message).toContain('"api"');
    expect(err.message).toContain('specs/api-v2');
    expect(fs.readFileSync(workspaceFilePath(home), 'utf8')).toBe(content);
  });

  it('[ac:ac-po-zmianie-sciezki-zaufanego-projektu] after the trusted id is moved to another path in workspace.json the project reads as untrusted until consent is given again', () => {
    writeWorkspaceFile({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] });
    const first = new WorkspaceRegistry(registryHome);
    const ws = first.openView('team');
    first.setProjectTrust(ws, 'app', true);
    first.setSpecSkillHooksTrust(ws, 'app', true);
    expect(first.getProjectTrust(ws, 'app')).toBe(true);
    expect(first.getSpecSkillHooksTrust(ws, 'app')).toBe(true);
    // The consent is recorded together with the relative path it was given for.
    expect(readRegistryEntry().projectTrust).toEqual({
      app: { path: 'specs/app', trustProjectPlugins: true, trustSpecSkillHooks: true },
    });

    // A commit moves the trusted id onto another directory (other code); the
    // change applies from the next start.
    writeWorkspaceFile({ projects: [{ id: 'app', path: 'specs/other' }], plugins: [] });
    const restarted = new WorkspaceRegistry(registryHome);
    const wsAfter = restarted.openView('team');
    expect(restarted.getProjectTrust(wsAfter, 'app')).toBeUndefined();
    expect(restarted.getSpecSkillHooksTrust(wsAfter, 'app')).toBe(false);
    expect(restarted.getProject(wsAfter, 'app')).toEqual({ id: 'app', cwd: path.join(home, 'specs', 'other') });

    // Consent given again — for the new path — and only the re-given flag holds.
    restarted.setProjectTrust(wsAfter, 'app', true);
    expect(restarted.getProjectTrust(wsAfter, 'app')).toBe(true);
    expect(restarted.getSpecSkillHooksTrust(wsAfter, 'app')).toBe(false);
    expect(readRegistryEntry().projectTrust).toEqual({ app: { path: 'specs/other', trustProjectPlugins: true } });
  });

  it('[section:t97gncju] the view composes the registry entry with workspace.json — projects resolved against home, plugins from the file; an outside change applies from the next start', () => {
    writeWorkspaceFile({ projects: [{ id: 'api', path: 'specs/api' }], plugins: ['@acme/p'] });
    const registry = new WorkspaceRegistry(registryHome);
    const view = registry.openView('team');
    expect(view.home).toBe(home);
    expect(view.plugins).toEqual(['@acme/p']);
    expect(view.projects).toEqual([{ id: 'api', cwd: path.join(home, 'specs', 'api') }]);
    expect(registry.resolveWorkspacesForCwd(path.join(home, 'specs', 'api')).map((w) => w.name)).toEqual(['team']);

    // `git pull` while the process runs: this process keeps its view…
    writeWorkspaceFile({ projects: [{ id: 'web', path: 'specs/web' }], plugins: [] });
    expect(registry.getWorkspace('team')!.projects.map((p) => p.id)).toEqual(['api']);
    // …and the next start sees the new composition.
    expect(new WorkspaceRegistry(registryHome).openView('team').projects.map((p) => p.id)).toEqual(['web']);
  });

  it('[section:fzno8pd4] registration mints the id into workspace.json from committed content only — unique within the file, never against local slots — and updates the view at once', () => {
    writeWorkspaceFile({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] });
    const registry = new WorkspaceRegistry(registryHome);
    const ws = registry.openView('team');
    // A machine-local slot named like the would-be id does not reserve it.
    fs.mkdirSync(path.join(home, '.claude4spec', 'local', 'billing'), { recursive: true });

    const billing = registry.registerProject(ws, path.join(home, 'services', 'billing'));
    const clash = registry.registerProject(ws, path.join(home, 'other', 'app'));

    expect(billing.id).toBe('billing');
    expect(clash.id).toBe('app-2');
    expect(JSON.parse(fs.readFileSync(workspaceFilePath(home), 'utf8'))).toEqual({
      projects: [
        { id: 'app', path: 'specs/app' },
        { id: 'billing', path: 'services/billing' },
        { id: 'app-2', path: 'other/app' },
      ],
      plugins: [],
    });
    // Idempotent per path; the server's own write is visible without a restart.
    expect(registry.registerProject(ws, path.join(home, 'services', 'billing')).id).toBe('billing');
    expect(registry.getWorkspace('team')!.projects.map((p) => p.id)).toEqual(['app', 'billing', 'app-2']);
    // The home itself and a directory outside it cannot be projects of it.
    expect(() => registry.registerProject(ws, home)).toThrow(/inside the home/);
    expect(() => registry.registerProject(ws, path.join(tmp, 'elsewhere'))).toThrow(/inside the home/);
  });

  it('[section:vzkw903j] slots live in <home>/.claude4spec/local/<id>/; a slot recorded for another directory is quarantined and the project starts on an empty slot', () => {
    writeWorkspaceFile({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] });
    const registry = new WorkspaceRegistry(registryHome);
    const ws = registry.openView('team');
    const local = path.join(home, '.claude4spec', 'local');
    expect(registry.slotsDir(ws)).toBe(local);
    expect(registry.slotDir(ws, 'app')).toBe(path.join(local, 'app'));

    // A slot left by a different directory under the same id (e.g. before a commit moved it).
    const slot = path.join(local, 'app');
    writeSlotMarker(slot, path.join(home, 'old', 'app'));
    fs.writeFileSync(path.join(slot, 'db.sqlite'), 'someone else’s history');

    const dir = registry.prepareSlot(ws, 'app', path.join(home, 'specs', 'app'));

    expect(dir).toBe(slot);
    expect(fs.existsSync(path.join(slot, 'db.sqlite'))).toBe(false);
    expect(readSlotMarker(slot)).toEqual({ cwd: path.join(home, 'specs', 'app') });
    const quarantined = fs.readdirSync(path.join(local, '.quarantine'));
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatch(/^app-\d+$/);
    expect(fs.readFileSync(path.join(local, '.quarantine', quarantined[0]!, 'db.sqlite'), 'utf8')).toBe(
      'someone else’s history',
    );

    // Its own slot is kept on the next build.
    fs.writeFileSync(path.join(slot, 'db.sqlite'), 'own history');
    registry.prepareSlot(ws, 'app', path.join(home, 'specs', 'app'));
    expect(fs.readFileSync(path.join(slot, 'db.sqlite'), 'utf8')).toBe('own history');
  });

  it('a broken workspace.json refuses only its own start — listing, resolution and registration in the other workspaces go on', () => {
    writeWorkspaceFile('{ "projects": [ ');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new WorkspaceRegistry(registryHome);
      const solo = registry.selectOrCreate({ name: 'solo', port: 4602 });

      // Registration in a healthy workspace, with the legacy-index relocation
      // that scans every workspace's slots directory.
      const cwd = path.join(tmp, 'legacy');
      fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude4spec', 'db.sqlite'), 'legacy index');
      const project = registry.registerProject(solo, cwd);
      expect(migrateLegacyDbIfNeeded(registry, solo, cwd, project.id)).toBe(true);
      expect(fs.readFileSync(path.join(registryHome, 'solo', project.id, 'db.sqlite'), 'utf8')).toBe('legacy index');

      // The composed listing keeps every entry; the broken one reads empty and says why.
      const views = registry.listWorkspaces();
      expect(views.map((w) => w.name)).toEqual(['team', 'solo']);
      const team = views.find((w) => w.name === 'team')!;
      expect(team.projects).toEqual([]);
      expect(team.plugins).toEqual([]);
      expect(team.fileError?.code).toBe<WorkspaceFileErrorCode>('WORKSPACE_FILE_INVALID');
      expect(team.fileError?.message).toContain(workspaceFilePath(home));
      expect(views.find((w) => w.name === 'solo')!.fileError).toBeUndefined();
      expect(registry.resolveWorkspacesForCwd(cwd).map((w) => w.name)).toEqual(['solo']);

      // `c4s list-workspaces` answers every row; the broken one names its refusal on stderr.
      const rows = listWorkspaces(new WorkspaceRegistry(registryHome));
      expect(rows.map((r) => [r.name, r.projectCount])).toEqual(
        expect.arrayContaining([
          ['team', 0],
          ['solo', 1],
        ]),
      );
      expect(rows).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('WORKSPACE_FILE_INVALID'));

      // …while the start of the workspace that owns the file is still refused.
      expect(() => registry.openView('team')).toThrow(WorkspaceFileError);
      expect(startRefusal().code).toBe<WorkspaceFileErrorCode>('WORKSPACE_FILE_INVALID');
    } finally {
      warn.mockRestore();
    }
  });

  it('registration, removal and trust take the workspace kind from the view — workspaces.json is read once, under the lock', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const solo = registry.selectOrCreate({ name: 'solo', port: 4602 });
    const registryFile = path.join(registryHome, 'workspaces.json');
    const read = vi.spyOn(fs, 'readFileSync');
    const registryReads = (): number => read.mock.calls.filter(([f]) => f === registryFile).length;
    try {
      const project = registry.registerProject(solo, path.join(tmp, 'proj'));
      expect(registryReads()).toBe(1);
      registry.setProjectTrust(solo, project.id, true);
      expect(registryReads()).toBe(2);
      expect(registry.removeProject(solo, project.id)).toBe(true);
      expect(registryReads()).toBe(3);
    } finally {
      read.mockRestore();
    }
  });

  it('[section:ssn335r8] the start reads workspace.json once, after ensuring .gitignore — selecting the entry reads no home file', () => {
    writeWorkspaceFile({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] });
    const file = workspaceFilePath(home);
    const gitignore = path.join(home, '.claude4spec', '.gitignore');
    const registry = new WorkspaceRegistry(registryHome);
    const origRead = fs.readFileSync.bind(fs);
    // Whether .gitignore was already in place at each read of workspace.json.
    const gitignoreAtRead: boolean[] = [];
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === file) gitignoreAtRead.push(fs.existsSync(gitignore));
      return origRead(...args);
    }) as typeof fs.readFileSync);
    const fileReads = (): number => gitignoreAtRead.length;
    try {
      const entry = registry.selectOrCreateEntry({ name: 'team' });
      expect(entry.home).toBe(home);
      expect(fileReads()).toBe(0);

      const view = registry.openView('team');
      expect(view.projects.map((p) => p.id)).toEqual(['app']);
      expect(gitignoreAtRead).toEqual([true]);

      // Every later read of the view reuses it.
      registry.getWorkspace('team');
      registry.listWorkspaces();
      registry.openView('team');
      expect(fileReads()).toBe(1);
    } finally {
      read.mockRestore();
    }
  });

  it('[section:vzkw903j] a registry workspace keeps its slots under the registry home', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const ws = registry.selectOrCreate({ name: 'solo' });
    expect(ws.home).toBeUndefined();
    expect(registry.slotDir(ws, 'p')).toBe(path.join(registryHome, 'solo', 'p'));
    // A registry workspace has no file to compose — the view is the entry.
    expect(registry.openView('solo').projects).toEqual([]);
  });
});
