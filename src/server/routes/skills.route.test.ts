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
        listing: [{ slug: 'mockups', description: 'author mockups', origin: 'plugin' }],
        writingStyle: { slug: 'house-style', title: 'house-style title' },
      });
    });

    it('[entity:skill-listing-response] rows carry { slug, description, origin } (no project outside project-exposed) and writingStyle stands beside them', async () => {
      for (const url of ['/api/skills', '/api/skills?contextType=chat']) {
        const res = await request(app).get(url);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(['listing', 'writingStyle']);
        expect(res.body.listing).toHaveLength(1);
        const row = res.body.listing[0];
        expect(Object.keys(row).sort()).toEqual(['description', 'origin', 'slug']);
        expect(row).toEqual({ slug: 'mockups', description: 'author mockups', origin: 'plugin' });
        expect(res.body.writingStyle).toEqual({ slug: 'house-style', title: 'house-style title' });
      }
      // Empty set for a legal value is a true answer, with the style still beside it.
      expect((await request(app).get('/api/skills?contextType=ask')).body).toEqual({
        listing: [],
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

    it('[entity:skill-package-response] opening shape: slug, title, description, scope, source, content, files (no hash from a read-only source); subfile shape: slug, path, content', async () => {
      const opened = await request(app).get('/api/skills/house-style');
      expect(opened.status).toBe(200);
      expect(Object.keys(opened.body).sort()).toEqual(['content', 'description', 'files', 'scope', 'slug', 'source', 'title']);
      expect(opened.body).toMatchObject({
        slug: 'house-style',
        title: 'house-style title',
        description: 'about house-style',
        scope: 'writing-style',
        source: 'user',
      });
      expect(opened.body.content).toContain('the body');
      expect(opened.body.content).not.toContain('version: 1');
      for (const f of opened.body.files) {
        expect(Object.keys(f).sort()).toEqual(['bytes', 'isText', 'lines', 'path']);
      }
      expect((await request(app).get('/api/skills/mockups')).body.source).toBe('plugin');

      const sub = await request(app).get('/api/skills/house-style').query({ file: 'workflows/brief.md' });
      expect(Object.keys(sub.body).sort()).toEqual(['content', 'path', 'slug']);
      // Over the budget, the subfile shape adds truncated + truncationHint.
      const cut = await request(app).get('/api/skills/house-style').query({ file: 'workflows/huge.md' });
      expect(Object.keys(cut.body).sort()).toEqual(['content', 'path', 'slug', 'truncated', 'truncationHint']);
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
