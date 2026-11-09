/**
 * 2.1.77 — M59 `4dvcvsa7` / M60 `zw3gpb7p` / M01 `qi8w2tmj`: the starter content
 * of a Skill / Writing Style project, written when onboarding closes. The final
 * write of the wizard (one `PATCH /api/config`) carries `skill.name` and
 * `skill.description` collected by the type step; the starter page's
 * placeholders are filled from the file after that write, and `skill.entry`
 * points at the page unless it already had a value. Skip sends only the closing
 * flag, so the placeholders stay literal.
 *
 * The router is wired as the project context wires it (project-context.ts):
 * `onOnboardingCompleted` → `writeStarterContent(cwd, effectiveBaseDir, entry)`,
 * with the type's capability set (`skill-exposure`, so the `skill.*` keys are active).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath } from '../config.js';
import { configRouter } from '../routes/config.js';
import { writeStarterContent } from './bootstrap.js';
import { SKILL_PROJECT_TYPE, WRITING_STYLE_PROJECT_TYPE } from '../project-types/entries.js';
import type { ProjectTypeEntry } from '../project-types/registry.js';
import { projectCapabilitySet } from '../project-types/capabilities.js';
import type { SkillRegistry } from '../services/skill-registry.js';

vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    probePathScope: (...args: Parameters<typeof actual.probePathScope>) => ({
      ...actual.probePathScope(...args),
      strength: 'soft' as const,
    }),
  };
});

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-starter-onb-'));
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

function freshProject(entry: ProjectTypeEntry, extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'pages'), { recursive: true });
  fs.writeFileSync(
    configPath(cwd),
    JSON.stringify({
      $schemaVersion: 4,
      name: 'My Project',
      projectType: entry.slug,
      roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
      onboardingCompleted: false,
      ...extra,
    }),
  );
}

const app = (entry: ProjectTypeEntry) =>
  express()
    .use(express.json())
    .use(
      configRouter({
        cwd,
        skillRegistry: { isSelectable: () => true, unselectableReason: () => '' } as unknown as SkillRegistry,
        capabilities: projectCapabilitySet(entry.capabilities),
        onOnboardingCompleted: (dir) => writeStarterContent(cwd, dir, entry),
      }),
    );

/** The wizard's final write: common values plus the type step's keys, in one body. */
const finalWrite = (name: string, description: string) => ({
  name: 'My Project',
  writingStyle: null,
  language: null,
  agent: { conversationalLanguage: null },
  skill: { name, description },
  onboardingCompleted: true,
});

const entryPage = () => fs.readFileSync(path.join(cwd, 'pages', 'index.md'), 'utf8');

describe('Skill project — starter content after onboarding (M59)', () => {
  it('[ac:ac-po-domknieciu-onboardingu-projektu-ty] after onboarding closes, the entry page contains the skill name and description typed in Skill details', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    const res = await request(app(SKILL_PROJECT_TYPE)).patch('/config').send(finalWrite('pdf-tools', 'Work with PDF files.'));
    expect(res.status).toBe(200);
    const page = entryPage();
    expect(page).toContain('# pdf-tools\n');
    expect(page).toContain('title: "pdf-tools"');
    expect(page).toContain('\nWork with PDF files.\n');
    expect(page).not.toContain('{skill.name}');
    expect(page).not.toContain('{skill.description}');
  });

  it('[ac:ac-po-domknieciu-onboardingu-projektu-ty-2] after onboarding closes, skill.entry points at the skill entry page', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    await request(app(SKILL_PROJECT_TYPE)).patch('/config').send(finalWrite('pdf-tools', 'Work with PDF files.'));
    const file = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8'));
    expect(file.skill.entry).toBe(SKILL_PROJECT_TYPE.starterContent!.path);
    expect(fs.existsSync(path.join(cwd, 'pages', file.skill.entry))).toBe(true);
  });

  it('[ac:ac-po-domknieciu-onboardingu-projektu-ty-5] after onboarding of a skill project, index.md of the base space has the value saved in the step in place of {skill.name}', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    await request(app(SKILL_PROJECT_TYPE)).patch('/config').send(finalWrite('pdf-tools', 'Work with PDF files.'));
    expect(entryPage()).toBe(
      SKILL_PROJECT_TYPE.starterContent!.template
        .replaceAll('{skill.name}', 'pdf-tools')
        .replaceAll('{skill.description}', 'Work with PDF files.'),
    );
  });

  it('[ac:ac-po-domknieciu-onboardingu-projektu-ty-6] after onboarding of a skill project without an earlier skill.entry, the config read returns skill.entry pointing at the saved entry page', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    const before = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8'));
    expect(before.skill?.entry).toBeUndefined();
    await request(app(SKILL_PROJECT_TYPE)).patch('/config').send(finalWrite('pdf-tools', 'Work with PDF files.'));
    // Written to the file by the activation's starter step, not only the read's default.
    expect(JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')).skill.entry).toBe('index.md');
    const read = await request(app(SKILL_PROJECT_TYPE)).get('/config');
    expect(read.status).toBe(200);
    expect(read.body.skill.entry).toBe('index.md');
    expect(fs.existsSync(path.join(cwd, 'pages', read.body.skill.entry))).toBe(true);
  });

  it('[ac:ac-wartosc-skill-entry-ustawiona-przed-d] a skill.entry set before onboarding closes is left unchanged after the entry page is written', async () => {
    freshProject(SKILL_PROJECT_TYPE, { skill: { entry: 'guide.md' } });
    await request(app(SKILL_PROJECT_TYPE)).patch('/config').send(finalWrite('pdf-tools', 'Work with PDF files.'));
    expect(fs.existsSync(path.join(cwd, 'pages', 'index.md'))).toBe(true);
    const file = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8'));
    expect(file.skill.entry).toBe('guide.md');
    expect(file.skill.name).toBe('pdf-tools');
  });

  it('[ac:ac-po-pominieciu-onboardingu-projektu-ty] after skipping onboarding of a skill project, index.md of the base space contains {skill.name} literally', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    const res = await request(app(SKILL_PROJECT_TYPE)).patch('/config').send({ onboardingCompleted: true });
    expect(res.status).toBe(200);
    expect(entryPage()).toContain('# {skill.name}\n');
  });

  it('[ac:ac-pominiecie-onboardingu-projektu-typu] after skipping onboarding of a Skill project, the entry page contains {skill.name} and {skill.description} literally', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    await request(app(SKILL_PROJECT_TYPE)).patch('/config').send({ onboardingCompleted: true });
    const page = entryPage();
    expect(page).toBe(SKILL_PROJECT_TYPE.starterContent!.template);
    expect(page).toContain('{skill.name}');
    expect(page).toContain('{skill.description}');
  });
});

describe('Writing Style project — starter content after onboarding (M60)', () => {
  it('[ac:ac-po-domknieciu-onboardingu-projektu-ty-3] after onboarding closes, the entry page contains the style name and description typed in Style details', async () => {
    freshProject(WRITING_STYLE_PROJECT_TYPE);
    const res = await request(app(WRITING_STYLE_PROJECT_TYPE)).patch('/config').send(finalWrite('terse', 'Short sentences only.'));
    expect(res.status).toBe(200);
    const page = entryPage();
    expect(page).toBe(
      WRITING_STYLE_PROJECT_TYPE.starterContent!.template
        .replaceAll('{skill.name}', 'terse')
        .replaceAll('{skill.description}', 'Short sentences only.'),
    );
    expect(page).toContain('# terse\n');
    expect(page).toContain('\nShort sentences only.\n');
  });

  it('[ac:ac-po-domknieciu-onboardingu-projektu-ty-4] after onboarding closes, skill.entry points at the style entry page', async () => {
    freshProject(WRITING_STYLE_PROJECT_TYPE);
    await request(app(WRITING_STYLE_PROJECT_TYPE)).patch('/config').send(finalWrite('terse', 'Short sentences only.'));
    const read = await request(app(WRITING_STYLE_PROJECT_TYPE)).get('/config');
    expect(read.body.skill.entry).toBe(WRITING_STYLE_PROJECT_TYPE.starterContent!.path);
    expect(fs.existsSync(path.join(cwd, 'pages', read.body.skill.entry))).toBe(true);
  });

  it('[ac:ac-pominiecie-onboardingu-projektu-typu-2] after skipping onboarding of a Writing Style project, the entry page contains {skill.name} and {skill.description} literally', async () => {
    freshProject(WRITING_STYLE_PROJECT_TYPE);
    await request(app(WRITING_STYLE_PROJECT_TYPE)).patch('/config').send({ onboardingCompleted: true });
    const page = entryPage();
    expect(page).toBe(WRITING_STYLE_PROJECT_TYPE.starterContent!.template);
    expect(page).toContain('{skill.name}');
    expect(page).toContain('{skill.description}');
  });
});

describe('the final write carries the type keys (M16 r2q6o6vi)', () => {
  it('[ac:ac-wartosci-skill-name-i-skill-descripti] skill.name and skill.description in the same single PATCH as the common values are all persisted by that one request', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    const res = await request(app(SKILL_PROJECT_TYPE)).patch('/config').send({ ...finalWrite('pdf-tools', 'Work with PDF files.'), name: 'Renamed' });
    expect(res.status).toBe(200);
    const file = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8'));
    expect(file.name).toBe('Renamed');
    expect(file.onboardingCompleted).toBe(true);
    expect(file.skill).toMatchObject({ name: 'pdf-tools', description: 'Work with PDF files.' });
  });

  it('[ac:ac-odmowa-koncowego-zapisu-wskazujaca-sk] a refusal of skill.name names the key, and nothing of the atomic write is saved', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    const res = await request(app(SKILL_PROJECT_TYPE)).patch('/config').send(finalWrite('Not Kebab', 'Work with PDF files.'));
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('skill.name');
    const file = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8'));
    expect(file.onboardingCompleted).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'pages', 'index.md'))).toBe(false);
  });

  it('[ac:ac-odmowa-koncowego-zapisu-wskazujaca-kl] a refusal of a Languages key names that key, and onboarding stays open', async () => {
    freshProject(SKILL_PROJECT_TYPE);
    const res = await request(app(SKILL_PROJECT_TYPE))
      .patch('/config')
      .send({ ...finalWrite('pdf-tools', 'd'), language: 'Klingon' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('language');
    expect(JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')).onboardingCompleted).toBe(false);
  });
});
