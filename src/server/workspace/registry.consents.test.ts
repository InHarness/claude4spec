import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RegisterHomeError, WorkspaceRegistry } from './registry.js';
import { WorkspaceSelectionError } from './start-selection.js';
import { workspaceFilePath } from './home-workspace.js';
import { invalidateOnConsentChange } from './consent-invalidation.js';
import { writeConfig } from '../config.js';
import { SkillNameSyntaxError } from '../services/skill-name.js';

/**
 * 2.1.67 (M31 Domain + L10): the registry entry's per-project trust — the
 * plugin consent and the confirmed skill attachments — the two new idempotent
 * core mutations (`registerHome`, `setSkillUsesConfirmation`), the entry-write
 * guarantee, the voiding of both consents on a path change, and the context
 * invalidation in the server process. Criteria are the sections' anchors of
 * `pages/modules/m31-workspace.md`. Every test runs over a throwaway registry
 * home and throwaway repos — never the developer's `~/.claude4spec`.
 */
describe('M31 — registry consents and core operations (2.1.67)', () => {
  let tmp: string;
  let registryHome: string;
  /** A workspace home with a committed description. */
  let home: string;
  /** Stands in for `$HOME` in the selection rule. */
  let userHome: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-consents-'));
    registryHome = path.join(tmp, 'registry');
    home = path.join(tmp, 'repo');
    userHome = path.join(tmp, 'me');
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.mkdirSync(userHome, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const registryFile = () => path.join(registryHome, 'workspaces.json');
  const readDisk = (): { workspaces: Array<Record<string, any>> } =>
    JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
  const entryNamed = (name: string) => readDisk().workspaces.find((w) => w.name === name)!;
  const writeWorkspaceFile = (content: unknown) =>
    fs.writeFileSync(workspaceFilePath(home), JSON.stringify(content, null, 2));
  const projectDir = (rel: string, uses: string[] = []) => {
    const dir = path.join(home, rel);
    fs.mkdirSync(dir, { recursive: true });
    writeConfig(dir, { name: path.basename(rel), skill: { uses } });
    return dir;
  };
  /** A home entry registered without a server, its view opened like the start does. */
  const openHome = (projects: Array<{ id: string; path: string }>) => {
    writeWorkspaceFile({ projects, plugins: [] });
    const registry = new WorkspaceRegistry(registryHome);
    const { entry } = registry.registerHome(home, { name: 'team', userHome });
    return { registry, ws: registry.openView(entry.name) };
  };

  it('[m31:whxy8m3r] a home entry carries `home` and, in place of projects[]/plugins[], per-project trust keyed by project id: the plugin consent and the confirmed skill attachments', () => {
    projectDir('specs/app', ['spec-style']);
    const { registry, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
    registry.setProjectTrust(ws, 'app', true);
    registry.setSkillUsesConfirmation(ws, 'app', ['spec-style']);

    const entry = entryNamed('team');
    expect(entry.home).toBe(home);
    expect(entry.projects).toBeUndefined();
    expect(entry.plugins).toBeUndefined();
    expect(entry.projectTrust).toEqual({
      app: { path: 'specs/app', trustProjectPlugins: true, confirmedSkillUses: ['spec-style'] },
    });
    // The view folds both consents into the project record.
    expect(registry.getProject(ws, 'app')).toMatchObject({
      id: 'app',
      trustProjectPlugins: true,
      confirmedSkillUses: ['spec-style'],
    });
  });

  it('[m31:bzgfftsf] registerProject is idempotent per path: the first call mints the record, later calls reuse its stored id without a duplicate; in a home workspace the record lands in workspace.json with a path relative to home', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const regWs = registry.selectOrCreate({ name: 'default', userHome });
    const dir = path.join(tmp, 'solo');
    fs.mkdirSync(dir);
    const first = registry.registerProject(regWs, dir);
    const again = registry.registerProject(registry.getWorkspace('default')!, dir);
    expect(again.id).toBe(first.id);
    expect(entryNamed('default').projects.map((p: { id: string }) => p.id)).toEqual([first.id]);

    const appDir = projectDir('specs/app');
    const { registry: homeReg, ws } = openHome([]);
    const minted = homeReg.registerProject(ws, appDir);
    const repeated = homeReg.registerProject(homeReg.openView('team'), appDir);
    expect(repeated.id).toBe(minted.id);
    const file = JSON.parse(fs.readFileSync(workspaceFilePath(home), 'utf8'));
    expect(file.projects).toEqual([{ id: minted.id, path: 'specs/app' }]);
    // A plain registry entry of the registry: no composition there for a home.
    expect(entryNamed('team').projects).toBeUndefined();
  });

  it('[m31:e491l9fb] setProjectTrust writes the flag under the registry lock: into the ProjectRecord of a registry workspace, into the home entry keyed (home, project-id) with the relative path — never into workspace.json', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const regWs = registry.selectOrCreate({ name: 'default', userHome });
    const dir = path.join(tmp, 'solo');
    fs.mkdirSync(dir);
    const project = registry.registerProject(regWs, dir);
    registry.setProjectTrust(regWs, project.id, true);
    expect(entryNamed('default').projects[0]).toMatchObject({ id: project.id, trustProjectPlugins: true });
    // The lock is released after the write (read-modify-write, not a held lock).
    expect(fs.existsSync(registryFile() + '.lock')).toBe(false);

    projectDir('specs/app');
    const { registry: homeReg, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
    const before = fs.readFileSync(workspaceFilePath(home), 'utf8');
    homeReg.setProjectTrust(ws, 'app', true);
    expect(entryNamed('team').projectTrust).toEqual({ app: { path: 'specs/app', trustProjectPlugins: true } });
    expect(fs.readFileSync(workspaceFilePath(home), 'utf8')).toBe(before);
    expect(homeReg.getProjectTrust(ws, 'app')).toBe(true);
  });

  it('[m31:xurq19of] listWorkspaces reads the whole registry without the advisory lock, returns the kind and the home of a home entry, and answers an empty list when the registry file is absent', () => {
    expect(new WorkspaceRegistry(registryHome).listWorkspaces()).toEqual([]);

    const { registry } = openHome([]);
    registry.selectOrCreate({ name: 'default', userHome });
    // A lock held by a live writer does not block a pure read.
    fs.writeFileSync(registryFile() + '.lock', String(process.pid));
    const views = new WorkspaceRegistry(registryHome).listWorkspaces();
    expect(views.map((w) => w.name).sort()).toEqual(['default', 'team']);
    expect(views.find((w) => w.name === 'team')!.home).toBe(home);
    expect(views.find((w) => w.name === 'default')!.home).toBeUndefined();
    // The read did not take or drop the lock.
    expect(fs.readFileSync(registryFile() + '.lock', 'utf8')).toBe(String(process.pid));
  });

  describe('registerHome', () => {
    it('[m31:zktorogu] registers an existing home without a server and creates no file: no directory, no .gitignore, no workspace.json, no local/', () => {
      writeWorkspaceFile({ projects: [], plugins: [] });
      const before = fs.readdirSync(path.join(home, '.claude4spec')).sort();
      const registry = new WorkspaceRegistry(registryHome);
      const result = registry.registerHome(home, { userHome });

      expect(result.created).toBe(true);
      expect(result.entry).toMatchObject({ name: 'repo', home, mode: 'prod', defaultPort: 4500 });
      // Never opened: no lastOpened.
      expect(entryNamed('repo')).not.toHaveProperty('lastOpened');
      expect(entryNamed('repo')).not.toHaveProperty('projects');
      expect(fs.readdirSync(path.join(home, '.claude4spec')).sort()).toEqual(before);
      expect(fs.existsSync(path.join(home, '.claude4spec', '.gitignore'))).toBe(false);
      expect(fs.existsSync(path.join(home, '.claude4spec', 'local'))).toBe(false);
    });

    it('[m31:zktorogu] refuses $HOME (INVALID_ARGS) and a directory without .claude4spec/workspace.json (WORKSPACE_FILE_MISSING) or with an invalid one (WORKSPACE_FILE_INVALID), writing nothing', () => {
      const registry = new WorkspaceRegistry(registryHome);
      const codeOf = (fn: () => unknown) => {
        try {
          fn();
        } catch (err) {
          expect(err).toBeInstanceOf(RegisterHomeError);
          return (err as RegisterHomeError).code;
        }
        throw new Error('expected a refusal');
      };
      fs.mkdirSync(path.join(userHome, '.claude4spec'), { recursive: true });
      fs.writeFileSync(workspaceFilePath(userHome), JSON.stringify({ projects: [], plugins: [] }));
      expect(codeOf(() => registry.registerHome(userHome, { userHome }))).toBe('INVALID_ARGS');
      // No workspace.json in `home` yet.
      expect(codeOf(() => registry.registerHome(home, { userHome }))).toBe('WORKSPACE_FILE_MISSING');
      fs.writeFileSync(workspaceFilePath(home), '{ not json');
      expect(codeOf(() => registry.registerHome(home, { userHome }))).toBe('WORKSPACE_FILE_INVALID');
      expect(fs.existsSync(registryFile())).toBe(false);
      // The missing-file refusal created nothing either.
      expect(fs.existsSync(path.join(home, '.claude4spec', '.gitignore'))).toBe(false);
    });

    it('[m31:zktorogu] keeps the selection rule refusals: a project directory (CWD_IS_PROJECT), a directory inside another home (CWD_INSIDE_HOME), a name of an entry with another home (WORKSPACE_HOME_MISMATCH), a port of another entry (PORT_TAKEN_BY_WORKSPACE)', () => {
      writeWorkspaceFile({ projects: [], plugins: [] });
      const registry = new WorkspaceRegistry(registryHome);
      registry.registerHome(home, { name: 'team', userHome, port: 4600 });
      registry.selectOrCreate({ name: 'other', userHome, port: 4700 });

      const selectionCode = (fn: () => unknown) => {
        try {
          fn();
        } catch (err) {
          expect(err).toBeInstanceOf(WorkspaceSelectionError);
          return (err as WorkspaceSelectionError).code;
        }
        throw new Error('expected a refusal');
      };
      const inner = path.join(home, 'nested');
      fs.mkdirSync(path.join(inner, '.claude4spec'), { recursive: true });
      fs.writeFileSync(workspaceFilePath(inner), JSON.stringify({ projects: [], plugins: [] }));
      expect(selectionCode(() => registry.registerHome(inner, { userHome }))).toBe('CWD_INSIDE_HOME');

      const project = path.join(tmp, 'proj');
      fs.mkdirSync(path.join(project, '.claude4spec'), { recursive: true });
      fs.writeFileSync(path.join(project, '.claude4spec', 'config.json'), JSON.stringify({ name: 'proj' }));
      fs.writeFileSync(workspaceFilePath(project), JSON.stringify({ projects: [], plugins: [] }));
      expect(selectionCode(() => registry.registerHome(project, { userHome }))).toBe('CWD_IS_PROJECT');

      const second = path.join(tmp, 'second');
      fs.mkdirSync(path.join(second, '.claude4spec'), { recursive: true });
      fs.writeFileSync(workspaceFilePath(second), JSON.stringify({ projects: [], plugins: [] }));
      expect(selectionCode(() => registry.registerHome(second, { name: 'team', userHome }))).toBe('WORKSPACE_HOME_MISMATCH');
      expect(selectionCode(() => registry.registerHome(second, { userHome, port: 4700 }))).toBe('PORT_TAKEN_BY_WORKSPACE');
      expect(readDisk().workspaces.map((w) => w.name).sort()).toEqual(['other', 'team']);
    });

    it('[m31:zktorogu] a repeat returns the existing entry unchanged except defaultPort, overwritten as the flag table says', () => {
      writeWorkspaceFile({ projects: [], plugins: [] });
      const registry = new WorkspaceRegistry(registryHome);
      const first = registry.registerHome(home, { name: 'team', userHome, port: 4600 });
      expect(first.created).toBe(true);

      const same = registry.registerHome(home, { userHome });
      expect(same.created).toBe(false);
      expect(same.entry).toEqual(first.entry);

      const samePort = registry.registerHome(home, { userHome, port: 4600 });
      expect(samePort).toEqual({ entry: first.entry, created: false });

      const moved = registry.registerHome(home, { name: 'team', userHome, port: 4650 });
      expect(moved.created).toBe(false);
      expect(moved.entry).toEqual({ ...first.entry, defaultPort: 4650 });
      expect(readDisk().workspaces).toEqual([{ ...first.entry, defaultPort: 4650 }]);
    });

    it('[m31:zktorogu] a start with --cwd <home> selects the registered entry by step 2; the same --port changes nothing, another one overwrites and persists defaultPort', () => {
      writeWorkspaceFile({ projects: [], plugins: [] });
      const registry = new WorkspaceRegistry(registryHome);
      registry.registerHome(home, { name: 'team', userHome, port: 4600 });

      const started = registry.selectOrCreateEntry({ cwd: home, userHome });
      expect(started).toMatchObject({ name: 'team', home, defaultPort: 4600 });
      expect(registry.selectOrCreateEntry({ cwd: home, port: 4600, userHome }).defaultPort).toBe(4600);
      expect(registry.selectOrCreateEntry({ cwd: home, port: 4610, userHome }).defaultPort).toBe(4610);
      expect(entryNamed('team').defaultPort).toBe(4610);
      expect(readDisk().workspaces).toHaveLength(1);
    });
  });

  describe('setSkillUsesConfirmation', () => {
    it('[m31:naxqsfra] replaces the confirmed list whole, accepts names outside the project skill.uses and returns them apart', () => {
      const registry = new WorkspaceRegistry(registryHome);
      const ws = registry.selectOrCreate({ name: 'default', userHome });
      const dir = path.join(tmp, 'solo');
      fs.mkdirSync(dir);
      writeConfig(dir, { name: 'solo', skill: { uses: ['spec-style', 'shared-glossary'] } });
      const project = registry.registerProject(ws, dir);

      const first = registry.setSkillUsesConfirmation(ws, project.id, ['spec-style', 'shared-glossary']);
      expect(first).toEqual({
        workspace: 'default',
        projectId: project.id,
        cwd: dir,
        confirmedSkillUses: ['spec-style', 'shared-glossary'],
        notInSkillUses: [],
      });

      // The second call replaces, it does not merge; a name outside skill.uses is stored and reported.
      const second = registry.setSkillUsesConfirmation(ws, project.id, ['shared-glossary', 'stranger', 'stranger']);
      expect(second!.confirmedSkillUses).toEqual(['shared-glossary', 'stranger']);
      expect(second!.notInSkillUses).toEqual(['stranger']);
      expect(entryNamed('default').projects[0].confirmedSkillUses).toEqual(['shared-glossary', 'stranger']);

      // An empty list clears.
      registry.setSkillUsesConfirmation(ws, project.id, []);
      expect(entryNamed('default').projects[0].confirmedSkillUses).toEqual([]);
      // An id that is not a project of the workspace writes nothing.
      expect(registry.setSkillUsesConfirmation(ws, 'nope', ['x'])).toBeNull();
    });

    it('[m31:naxqsfra] in a home workspace the list is kept with the same key, lock and relative path as setProjectTrust, never in workspace.json', () => {
      projectDir('specs/app', ['spec-style']);
      const { registry, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
      const before = fs.readFileSync(workspaceFilePath(home), 'utf8');
      registry.setProjectTrust(ws, 'app', true);
      const result = registry.setSkillUsesConfirmation(ws, 'app', ['spec-style', 'extra']);
      expect(result!.notInSkillUses).toEqual(['extra']);
      expect(entryNamed('team').projectTrust).toEqual({
        app: { path: 'specs/app', trustProjectPlugins: true, confirmedSkillUses: ['spec-style', 'extra'] },
      });
      expect(fs.readFileSync(workspaceFilePath(home), 'utf8')).toBe(before);
      expect(fs.existsSync(registryFile() + '.lock')).toBe(false);
    });

    it('[ac:ac-zapis-potwierdzen-z-nazwa-poza-skladn] a confirmation list with one name outside the `skill.name` syntax is refused whole: the registry file is byte-identical and the context is not invalidated', () => {
      projectDir('specs/app', ['spec-style']);
      const { registry, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
      registry.setSkillUsesConfirmation(ws, 'app', ['spec-style']);
      const cache = { invalidate: vi.fn() };
      const off = invalidateOnConsentChange(registry, ws, cache);
      const before = fs.readFileSync(registryFile(), 'utf8');

      // Each one breaks the syntax `^[a-z0-9]+(-[a-z0-9]+)*$`; valid names next to it do not save the write.
      for (const bad of ['Spec-Style', 'spec_style', '-spec', 'spec-', 'spec--style', 'spec style', 'spéc', '']) {
        let thrown: unknown;
        try {
          registry.setSkillUsesConfirmation(ws, 'app', ['shared-glossary', bad, 'other-skill']);
        } catch (err) {
          thrown = err;
        }
        expect(thrown, JSON.stringify(bad)).toBeInstanceOf(SkillNameSyntaxError);
        expect((thrown as SkillNameSyntaxError).names).toEqual([bad]);
        expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before);
      }
      expect(entryNamed('team').projectTrust.app.confirmedSkillUses).toEqual(['spec-style']);
      expect(cache.invalidate).not.toHaveBeenCalled();
      // Digits and single hyphens are in the syntax: the same write with valid names goes through.
      expect(registry.setSkillUsesConfirmation(ws, 'app', ['shared-glossary', 'v2-rules'])!.confirmedSkillUses).toEqual([
        'shared-glossary',
        'v2-rules',
      ]);
      expect(cache.invalidate).toHaveBeenCalledTimes(1);
      off();
    });

    it('[m31:naxqsfra] a project outside the workspace: nothing is written, the context is not invalidated, the result is none', () => {
      projectDir('specs/app', ['spec-style']);
      const { registry, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
      registry.setSkillUsesConfirmation(ws, 'app', ['spec-style']);
      const cache = { invalidate: vi.fn() };
      const off = invalidateOnConsentChange(registry, ws, cache);
      const before = fs.readFileSync(registryFile(), 'utf8');
      expect(registry.setSkillUsesConfirmation(ws, 'stranger', ['spec-style'])).toBeNull();
      expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before);
      expect(entryNamed('team').projectTrust.stranger).toBeUndefined();
      expect(cache.invalidate).not.toHaveBeenCalled();
      off();
    });
  });

  it('[m31:44viw74p] a change of the project path voids both consents — the plugin trust and the confirmed skill attachments — until given again', () => {
    projectDir('specs/app', ['spec-style']);
    const { registry, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
    registry.setProjectTrust(ws, 'app', true);
    registry.setSkillUsesConfirmation(ws, 'app', ['spec-style']);
    expect(registry.getProject(ws, 'app')).toMatchObject({ trustProjectPlugins: true, confirmedSkillUses: ['spec-style'] });

    // A commit moves the trusted id onto another directory; applies from the next start.
    projectDir('specs/other', ['spec-style']);
    writeWorkspaceFile({ projects: [{ id: 'app', path: 'specs/other' }], plugins: [] });
    const restarted = new WorkspaceRegistry(registryHome);
    const wsAfter = restarted.openView('team');
    const voided = restarted.getProject(wsAfter, 'app')!;
    expect(voided.trustProjectPlugins).toBeUndefined();
    expect(voided.confirmedSkillUses).toBeUndefined();

    // Re-confirming the attachments for the new path does not revive the plugin consent.
    restarted.setSkillUsesConfirmation(wsAfter, 'app', ['spec-style']);
    expect(entryNamed('team').projectTrust).toEqual({ app: { path: 'specs/other', confirmedSkillUses: ['spec-style'] } });
    expect(restarted.getProjectTrust(wsAfter, 'app')).toBeUndefined();
  });

  it('[m31:zovs1ohc] the new mutations write the entry as a read-modify-write of the freshly read registry under its lock, keeping fields the writer does not know', () => {
    projectDir('specs/app', ['spec-style']);
    const { registry, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
    // Another process (a newer binary, M54) writes fields after our view was taken.
    const onDisk = readDisk();
    onDisk.workspaces[0]!.futureField = { nested: [1, 2] };
    onDisk.workspaces[0]!.runnerHosts = [{ id: 'h1' }];
    fs.writeFileSync(registryFile(), JSON.stringify(onDisk));

    registry.setSkillUsesConfirmation(ws, 'app', ['spec-style']);
    registry.setProjectTrust(ws, 'app', false);
    registry.registerHome(home, { userHome, port: 4620 });
    const entry = entryNamed('team');
    expect(entry.futureField).toEqual({ nested: [1, 2] });
    expect(entry.runnerHosts).toEqual([{ id: 'h1' }]);
    expect(entry.defaultPort).toBe(4620);
    expect(entry.projectTrust.app).toEqual({ path: 'specs/app', confirmedSkillUses: ['spec-style'], trustProjectPlugins: false });
  });

  it('[m31:m31ctx001] in the server process setProjectTrust and setSkillUsesConfirmation invalidate the project context; a write by another process (the CLI) does not', () => {
    projectDir('specs/app', ['spec-style']);
    const { registry, ws } = openHome([{ id: 'app', path: 'specs/app' }]);
    const cache = { invalidate: vi.fn() };
    const off = invalidateOnConsentChange(registry, ws, cache);

    registry.setSkillUsesConfirmation(ws, 'app', ['spec-style']);
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
    expect(cache.invalidate).toHaveBeenLastCalledWith('app');
    registry.setProjectTrust(ws, 'app', true);
    expect(cache.invalidate).toHaveBeenCalledTimes(2);

    // The CLI writes through its own registry instance — no listener of the server there.
    const cli = new WorkspaceRegistry(registryHome);
    cli.setSkillUsesConfirmation(cli.openView('team'), 'app', []);
    expect(cache.invalidate).toHaveBeenCalledTimes(2);

    // A write refused (no such project) invalidates nothing; after shutdown nothing either.
    registry.setSkillUsesConfirmation(ws, 'nope', ['x']);
    expect(cache.invalidate).toHaveBeenCalledTimes(2);
    registry.setProjectTrust(ws, 'nope', true);
    expect(cache.invalidate).toHaveBeenCalledTimes(2);
    off();
    registry.setProjectTrust(ws, 'app', false);
    expect(cache.invalidate).toHaveBeenCalledTimes(2);
  });
});
