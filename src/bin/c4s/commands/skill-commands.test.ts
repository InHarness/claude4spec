/**
 * 0.2.99 M37 — `c4s list-skills` and `c4s load-skill-file`, both
 * `server-delegating`. Asserted against a real HTTP server, so the URL each one
 * builds is part of what is checked, as is the absence of any disk fallback.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { __resetDelegateTargets } from '../delegate.js';
import { runListSkills } from './list-skills.js';
import { runLoadSkillFile } from './load-skill-file.js';

const CONFIG = {
  name: 'test-project',
  roots: [],
  entitiesDir: 'entities',
  writingStyle: null,
  onboarding: {},
};

describe('c4s skills registry commands (0.2.99)', () => {
  let registryDir: string;
  let projectDir: string;
  let prevHome: string | undefined;
  let stdout: string;
  let server: http.Server;
  let seen: string[];
  let status: number;
  let reply: unknown;

  beforeEach(async () => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-sk-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-sk-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;

    seen = [];
    status = 200;
    reply = {};
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');
      if (url.endsWith('/config')) return res.end(JSON.stringify(CONFIG));
      seen.push(url);
      res.statusCode = status;
      res.end(JSON.stringify(reply));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default', port });
    registry.registerProject(ws, projectDir);
    __resetDelegateTargets();

    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    __resetDelegateTargets();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const args = (...argv: string[]) =>
    parseArgs([...argv, '--project', path.basename(projectDir), '--workspace', 'default']);

  describe('list-skills', () => {
    const whole = {
      listing: [{ slug: 'ui-view-mockup-generator', description: 'Author the HTML mockup of a ui-view.' }],
      writingStyle: { slug: 'layered-vertical-slices', title: 'Layered Vertical Slices' },
    };

    it('[ac:ac-c4s-list-skills-bez-context-type-wypi] without --context-type asks for the whole registry and prints it', async () => {
      reply = whole;
      await runListSkills(args('list-skills'));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/\/skills$/);
      expect(JSON.parse(stdout)).toEqual(whole);
    });

    it('passes --context-type through as ?contextType=, unvalidated — the server owns the enum', async () => {
      reply = { listing: [], writingStyle: null };
      await runListSkills(args('list-skills', '--context-type', 'brief'));
      expect(seen[0]).toMatch(/\/skills\?contextType=brief$/);

      status = 400;
      reply = { error: { code: 'INVALID_ARGUMENT', message: "unknown contextType 'x'; expected one of chat, brief, patch, ask" } };
      await expect(runListSkills(args('list-skills', '--context-type', 'x'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('chat, brief, patch, ask'),
      });
    });
  });

  describe('load-skill-file', () => {
    it('[ac:ac-c4s-load-skill-file-slug-file-relpath] --file reads one package file and prints its content', async () => {
      reply = { slug: 'house-style', path: 'workflows/brief.md', content: 'the methodology\n' };
      await runLoadSkillFile(args('load-skill-file', 'house-style', '--file', 'workflows/brief.md'));
      expect(seen[0]).toMatch(/\/skills\/house-style\?file=workflows%2Fbrief\.md$/);
      expect(JSON.parse(stdout)).toEqual(reply);

      stdout = '';
      await runLoadSkillFile(args('load-skill-file', 'house-style', '--file', 'workflows/brief.md', '--format', 'text'));
      expect(stdout).toBe('the methodology\n\n');
    });

    it('without --file opens the package', async () => {
      reply = { slug: 'house-style', content: 'body', files: [] };
      await runLoadSkillFile(args('load-skill-file', 'house-style'));
      expect(seen[0]).toMatch(/\/skills\/house-style$/);
    });

    it('refuses a missing or dot-segment slug before building a URL', async () => {
      await expect(runLoadSkillFile(args('load-skill-file'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      await expect(runLoadSkillFile(args('load-skill-file', '..'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      expect(seen).toEqual([]);
    });

    it.each(['SKILL_NOT_FOUND', 'SKILL_FILE_NOT_FOUND', 'NOT_TEXT', 'INVALID_ARGUMENT'])(
      'propagates %s from the server verbatim',
      async (code) => {
        status = code === 'INVALID_ARGUMENT' ? 400 : 404;
        reply = { error: { code, message: 'refused' } };
        await expect(runLoadSkillFile(args('load-skill-file', 'house-style', '--file', 'x'))).rejects.toMatchObject({ code });
      },
    );
  });

  describe('no server', () => {
    it('[ac:ac-c4s-list-skills-uruchomione-bez-dzial] list-skills fails the health-check, never reads skills from disk', async () => {
      // A skill the command could have found on disk, if it were looking.
      const dir = path.join(projectDir, '.claude', 'skills', 'house-style');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\ntitle: h\ndescription: d\nversion: 1\nlanguage: en\n---\nbody\n');

      await new Promise<void>((resolve) => server.close(() => resolve()));
      __resetDelegateTargets();
      await expect(runListSkills(args('list-skills'))).rejects.toMatchObject({ code: 'SERVER_NOT_RUNNING' });
      expect(seen).toEqual([]);
      expect(stdout).toBe('');
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
  });
});
