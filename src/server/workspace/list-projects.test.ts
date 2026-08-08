import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listProjects } from './list-projects.js';
import type { WorkspaceRecord } from './types.js';

const dirs: string[] = [];

function projectDir(config: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-lp-'));
  dirs.push(dir);
  if (config !== null) {
    fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude4spec', 'config.json'), config, 'utf8');
  }
  return dir;
}

function workspace(projects: Array<{ id: string; name: string; cwd: string }>): WorkspaceRecord {
  return {
    name: 'default',
    mode: 'dev',
    defaultPort: 3000,
    lastOpened: new Date().toISOString(),
    projects: projects.map((p) => ({ ...p, addedAt: new Date().toISOString() })),
  };
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('list_projects (M31)', () => {
  it('answers id, slug, name and path per project', () => {
    const cwd = projectDir(JSON.stringify({ name: 'The Spec' }));
    const result = listProjects(workspace([{ id: 'abc123', name: 'app-spec', cwd }]));
    expect(result.projects).toEqual([{ id: 'abc123', slug: 'app-spec', name: 'The Spec', path: cwd }]);
  });

  it('a MALFORMED config.json yields an entry without a name, not a failure', () => {
    // One broken project must not make the workspace unlistable — that would
    // take the only discovery path away exactly when something is wrong.
    const broken = projectDir('{ not json');
    const ok = projectDir(JSON.stringify({ name: 'Fine' }));
    const result = listProjects(
      workspace([
        { id: 'a', name: 'broken', cwd: broken },
        { id: 'b', name: 'fine', cwd: ok },
      ]),
    );
    expect(result.projects[0]!.name).toBeUndefined();
    // Still addressable: `slug` comes from the registry, not the config.
    expect(result.projects[0]!.slug).toBe('broken');
    expect(result.projects[0]!.id).toBe('a');
    // And the broken one does not take its neighbour down with it.
    expect(result.projects[1]!.name).toBe('Fine');
  });

  it('an ABSENT config.json falls back to the directory basename', () => {
    // Distinct from malformed: `readConfig` defaults a missing file rather than
    // throwing, and a usable label beats a blank one. Same behaviour peer
    // discovery has always had for this field.
    const dir = projectDir(null);
    const result = listProjects(workspace([{ id: 'a', name: 'no-config', cwd: dir }]));
    expect(result.projects[0]!.name).toBe(path.basename(dir));
  });

  it('an empty workspace is an empty list, not an error', () => {
    expect(listProjects(workspace([])).projects).toEqual([]);
  });
});
