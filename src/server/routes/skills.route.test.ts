import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { skillsRouter } from './skills.js';
import { SkillRegistry, SkillResolver } from '../services/skill-registry.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';

/**
 * 0.2.99 — the `rest` rendering of M37: `GET /skills` (`list_skills`) and
 * `GET /skills/:slug?file=` (`load_skill_file`). Semantics are the core's
 * (`skill-operations.test.ts`); what is pinned here is the envelope — status per
 * code, `file` as a query parameter, and truncation signalled on this channel too.
 */
describe('skillsRouter', () => {
  let tmp: string;
  let app: express.Express;
  let registry: SkillRegistry;

  function writeStyle(slug: string): string {
    const dir = path.join(tmp, '.claude', 'skills', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\ntitle: ${slug} title\ndescription: about ${slug}\nversion: 1\nlanguage: en\nscope: writing-style\n---\n# ${slug}\nthe body\n`,
    );
    return dir;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skills-route-'));
    const dir = writeStyle('house-style');
    fs.mkdirSync(path.join(dir, 'workflows'));
    fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'methodology\n');
    fs.writeFileSync(path.join(dir, 'workflows', 'huge.md'), 'y'.repeat(DEFAULT_BUDGET_CHARS + 1));
    fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0xff, 0xfe]));
    fs.mkdirSync(path.join(tmp, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude4spec', 'config.json'), JSON.stringify({ writingStyle: 'house-style' }));

    registry = SkillRegistry.load([{ dir: path.join(tmp, '.claude', 'skills'), source: 'user' }], { rescanTtlMs: 0 });
    registry.addPluginSkill({
      slug: 'mockups',
      title: 'Mockups',
      description: 'author mockups',
      version: 1,
      language: 'en',
      scope: 'contextual',
      contextTypes: ['chat'],
      content: 'mockup body',
    });
    app = express();
    app.use('/api/skills', skillsRouter({ skillRegistry: registry, skillResolver: new SkillResolver(registry, tmp) }));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('GET /api/skills', () => {
    it('without contextType answers the whole registry, with the active style beside the listing', async () => {
      const res = await request(app).get('/api/skills');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        listing: [{ slug: 'mockups', description: 'author mockups' }],
        writingStyle: { slug: 'house-style', title: 'house-style title' },
      });
    });

    it('narrows to the resolver set of a context type', async () => {
      expect((await request(app).get('/api/skills?contextType=chat')).body.listing).toHaveLength(1);
      expect((await request(app).get('/api/skills?contextType=brief')).body.listing).toEqual([]);
    });

    it('answers 400 INVALID_ARGUMENT listing the legal values for an unknown contextType', async () => {
      const res = await request(app).get('/api/skills?contextType=breif');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ARGUMENT');
      expect(res.body.error.message).toContain('chat, brief, patch, ask');
    });
  });

  describe('GET /api/skills/:slug', () => {
    it('opens the package: body + manifest, no disk path', async () => {
      const res = await request(app).get('/api/skills/house-style');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ slug: 'house-style', scope: 'writing-style', title: 'house-style title' });
      expect(res.body.files.map((f: { path: string }) => f.path)).toEqual(['logo.png', 'workflows/brief.md', 'workflows/huge.md']);
      expect(JSON.stringify(res.body)).not.toContain(tmp);
    });

    it('reads a subfile addressed by the ?file= query parameter', async () => {
      const res = await request(app).get('/api/skills/house-style').query({ file: 'workflows/brief.md' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ slug: 'house-style', path: 'workflows/brief.md', content: 'methodology\n' });
    });

    it('opens a plugin skill outside the active context set — access is not gated by context', async () => {
      const res = await request(app).get('/api/skills/mockups');
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('mockup body');
    });

    it('[ac:ac-podplik-przekraczajacy-budzet-wraca-z] signals truncation over REST as well', async () => {
      const res = await request(app).get('/api/skills/house-style').query({ file: 'workflows/huge.md' });
      expect(res.status).toBe(200);
      expect(res.body.truncated).toBe(true);
      expect(res.body.truncationHint).toEqual(expect.stringContaining('workflows/huge.md'));
      expect(res.body.content).toHaveLength(DEFAULT_BUDGET_CHARS);
    });

    it.each([
      ['/api/skills/hose-style', undefined, 404, 'SKILL_NOT_FOUND'],
      ['/api/skills/house-style', 'nope.md', 404, 'SKILL_FILE_NOT_FOUND'],
      ['/api/skills/house-style', 'logo.png', 415, 'NOT_TEXT'],
      ['/api/skills/house-style', '../../../etc/passwd', 400, 'INVALID_ARGUMENT'],
      ['/api/skills/house-style', '/etc/passwd', 400, 'INVALID_ARGUMENT'],
    ])('%s?file=%s → %i %s', async (url, file, status, code) => {
      const res = await request(app).get(url).query(file === undefined ? {} : { file });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });
  });
});
