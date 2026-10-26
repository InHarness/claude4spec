import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../../src/shared/plugin-host/manifest.js';
import { createPluginTestApp, type PluginTestApp } from '../../helpers/plugin-test-setup.js';

/**
 * 2.1.49 (M17 `ry0bx4ji`) — capture happens ONLY on the write path. Entity
 * changes brought in by a `sync()` merge reach the index through the index
 * reconstruction path (M29 `indexAll()` / per-file reindex — what the M31
 * reload after a HEAD change and the watcher's projection run), which upserts
 * the entity tables WITHOUT an `entity_version` INSERT. With `git.enabled` the
 * identity and the diff of a release run on the git track instead.
 *
 * A real project context (`createPluginTestApp`) in a real repository: a bare
 * "remote", the project tracking it, and a teammate's clone pushing a change to
 * an entity file while the project has a local commit of its own (divergence →
 * `merged`).
 */

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

async function identity(dir: string, name: string, email: string): Promise<void> {
  await git(['config', 'user.email', email], dir);
  await git(['config', 'user.name', name], dir);
}

/** A plugin type with one required field — the entity the teammate edits. */
function gadgetManifest(): PluginManifest {
  return {
    name: '@acme/c4s-plugin-gadgets',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    contributes: {
      entities: [
        {
          type: 'gadget',
          data: { schema: { title: { type: 'string', required: true, maxLength: 200 } } },
          slugPattern: [{ op: 'slugify', field: 'title' }],
          payloadVersion: 1,
          label: 'Gadget',
          labelPlural: 'Gadgets',
          pathPrefix: '/gadgets',
          systemPrompt: { roleNoun: 'gadget', mcpToolsLine: 'gadget-tools: ...' },
        },
      ],
    },
  };
}

// Isolate from the developer's global/system git config.
const savedEnv: Record<string, string | undefined> = {};
let emptyGlobalConfig: string;
beforeAll(() => {
  emptyGlobalConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-gitcfg-')), 'gitconfig');
  fs.writeFileSync(emptyGlobalConfig, '');
  for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_CONFIG_NOSYSTEM: '1' })) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(path.dirname(emptyGlobalConfig), { recursive: true, force: true });
});

describe('entity changes merged by sync() do not enter entity_version (M17 ry0bx4ji)', () => {
  let t: PluginTestApp | null = null;
  let base: string | null = null;

  afterEach(async () => {
    await t?.cleanup();
    t = null;
    if (base) fs.rmSync(base, { recursive: true, force: true });
    base = null;
  });

  it('[ac:ac-encja-zmieniona-scaleniem-sync-z-wyni] [section:ry0bx4ji] an entity changed by a sync() with result merged gets no new entity_version row — the index takes the merged content through the reconstruction path', async () => {
    t = await createPluginTestApp([gadgetManifest()]);
    const work = t.cwd;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-sync-ev-'));
    const bare = path.join(base, 'remote.git');
    const other = path.join(base, 'other');

    // An entity created through the write path — captured.
    const created = await request(t.app).post(`${t.baseUrl}/gadgets`).send({ title: 'First gadget' });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug as string;
    const versions = (): number =>
      (
        t!.db
          .prepare(`SELECT COUNT(*) AS n FROM entity_version WHERE entity_type = 'gadget' AND entity_slug = ?`)
          .get(slug) as { n: number }
      ).n;
    const before = versions();
    expect(before).toBeGreaterThanOrEqual(1);

    // git on, the project committed and tracking a bare remote.
    const configFile = path.join(work, '.claude4spec', 'config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(
      configFile,
      JSON.stringify({ ...config, git: { ...((config.git as object) ?? {}), enabled: true } }, null, 2) + '\n',
    );
    await git(['init', '-q', '-b', 'main'], work);
    await identity(work, 'Test', 'test@example.com');
    await git(['add', '-A'], work);
    await git(['commit', '-q', '-m', 'first'], work);
    await pexec('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    await git(['remote', 'add', 'origin', bare], work);
    await git(['push', '-q', '-u', 'origin', 'main'], work);

    // The teammate changes the entity file and pushes.
    await pexec('git', ['clone', '-q', bare, other]);
    await identity(other, 'Mate', 'mate@example.com');
    const entityRel = path.join('.claude4spec', 'entities', 'gadget', `${slug}.json`);
    const remoteEntity = JSON.parse(fs.readFileSync(path.join(other, entityRel), 'utf8')) as Record<string, unknown>;
    expect(remoteEntity.title).toBe('First gadget');
    fs.writeFileSync(path.join(other, entityRel), JSON.stringify({ ...remoteEntity, title: 'Remote title' }, null, 2) + '\n');
    await git(['commit', '-q', '-am', 'remote entity edit'], other);
    await git(['push', '-q', 'origin', 'main'], other);

    // A local commit of the project's own → the histories diverge.
    fs.writeFileSync(path.join(work, 'local-note.txt'), 'local\n');
    await git(['add', '-A'], work);
    await git(['commit', '-q', '-m', 'local'], work);

    // From here on, only the events the sync's own chain broadcasts count.
    t.broadcasts.length = 0;
    const sync = await request(t.app).post(`${t.baseUrl}/git/sync`);
    expect(sync.status).toBe(200);
    expect(sync.body.status).toBe('merged');
    expect(JSON.parse(fs.readFileSync(path.join(work, entityRel), 'utf8')).title).toBe('Remote title');

    // The watcher's chain for the merged file (M40: a HEAD change from the app
    // is labelled, not suppressed — the chain runs over the changed files) is the
    // per-file reconstruction path: the indexer broadcasts `entity:indexed` once
    // the merged content has landed in the index. Waiting for that signal AND the
    // merged title in the index proves the chain ran over the merged file (an
    // earlier chain of the create would have indexed the old title).
    await vi.waitFor(
      async () => {
        expect(
          t!.broadcasts.some(
            (e) => e.kind === 'entity:indexed' && e.type === 'gadget' && e.slug === slug && e.op === 'upsert',
          ),
        ).toBe(true);
        const indexed = await request(t!.app).get(`${t!.baseUrl}/gadgets/${slug}`);
        expect(indexed.body.data?.title).toBe('Remote title');
      },
      { timeout: 30_000, interval: 50 },
    );
    expect(versions()).toBe(before);

    // The full reconstruction path (M29 indexAll — what the M31 reload runs)
    // takes the merged content into the index as well…
    const rebuild = await request(t.app).post(`${t.baseUrl}/_meta/index-status/rebuild`).send({ projection: 'm29-entities' });
    expect(rebuild.status).toBe(200);
    const read = await request(t.app).get(`${t.baseUrl}/gadgets/${slug}`);
    expect(read.status).toBe(200);
    expect(read.body.data.title).toBe('Remote title');

    // …and neither wrote a version: the log still holds only the write-path rows.
    expect(versions()).toBe(before);
  }, 60_000);
});
