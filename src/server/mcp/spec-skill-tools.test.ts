import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { RootRegistry } from '../roots/registry.js';
import type { Root } from '../../shared/types.js';
import { registerCoreReactions } from '../workspace/core-reactions.js';
import { mountRegistryRoots } from '../workspace/root-registry-runtime.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { profileAdmits } from '../operations/profiles.js';
import {
  SPEC_SKILL_TOOLS_SERVER,
  SpecSkillTools,
  UPDATE_SKILL_FILE_DESCRIPTION,
  buildSpecSkillToolsServer,
} from './spec-skill-tools.js';
import type { SkillWriteDeps } from '../services/skill-write.js';
import { SkillRegistry, toPackageFiles } from '../services/skill-registry.js';
import { registerProjectRootedSkills } from '../services/project-rooted-skills.js';
import { ProjectExposedSkillSource, exposedReadOnlyReason } from '../services/project-exposed-skills.js';

/**
 * 2.1.9 (M52) — `spec-skill-tools` · `update_skill_file`, the write channel of
 * the project's skill packages. The rig mounts the registry roots exactly as
 * `project-context.ts` does and hands the server the facade of the `skills`
 * root, so every write below goes through that root's record store.
 */

registerCoreReactions();
registerCoreOperations();

const USER_ROOTS: Root[] = [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }];

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

const SKILL_MD = ['---', 'title: Release notes', 'description: How to write a release note.', 'version: 1', 'language: en', '---', '', '# Release notes', ''].join('\n');

async function rig(extra: Partial<SkillWriteDeps> = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-spec-skill-tools-'));
  cleanups.push(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const runtime = new FileWatchRuntime({ fsEvents: false });
  cleanups.push(() => runtime.close());
  const registry = new RootRegistry(USER_ROOTS);
  const mounted = await mountRegistryRoots({
    cwd,
    registry,
    userRoots: USER_ROOTS,
    w: runtime.scoped('context:spec-skill-tools#1'),
  });
  const skills = mounted.rootRuntimes.find((rt) => rt.root.id === 'skills');
  expect(skills, 'the skills root has a facade').toBeDefined();
  const server = buildSpecSkillToolsServer({ skillsRoot: () => ({ pages: skills!.pages }), ...extra }, 'p1');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(() => client.close());
  const call = async (args: Record<string, unknown>) => {
    const res = await client.callTool({ name: 'update_skill_file', arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    let body: Record<string, any>;
    try {
      body = JSON.parse(text) as Record<string, any>;
    } catch {
      body = { raw: text };
    }
    return { isError: res.isError === true, body };
  };
  const abs = (rel: string): string => path.join(cwd, '.claude4spec/skills', rel);
  return { client, call, abs, cwd, roots: registry };
}

describe('spec-skill-tools · update_skill_file (M52, 2.1.9)', () => {
  it('[entity:spec-skill-tools-update-skill-file] update_skill_file on spec-skill-tools: inputs slug + expectedHash (required), file + content + textEdits (optional), the entity description verbatim; answers { slug, file, hash } after writing through the skills root; refuses a stale hash (PAGE_CONFLICT), "" on an existing file, and a non package-relative file', async () => {
    const { client, call, abs } = await rig();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['update_skill_file']);
    const tool = tools[0]!;
    expect(tool.description).toBe(UPDATE_SKILL_FILE_DESCRIPTION);
    expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(
      ['content', 'expectedHash', 'file', 'slug', 'textEdits'].sort(),
    );
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(['expectedHash', 'slug']);
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);

    // "" creates; `file` defaults to SKILL.md.
    const created = await call({ slug: 'release-notes', content: SKILL_MD, expectedHash: '' });
    expect(created.isError).toBe(false);
    expect(Object.keys(created.body).sort()).toEqual(['file', 'hash', 'slug']);
    expect(created.body).toEqual({ slug: 'release-notes', file: 'SKILL.md', hash: sha(SKILL_MD) });
    expect(fs.readFileSync(abs('release-notes/SKILL.md'), 'utf-8')).toBe(SKILL_MD);

    // A subfile, then a differential write of it with the hash the last write returned.
    const sub = await call({ slug: 'release-notes', file: 'workflows/draft.md', content: 'Step one.\n', expectedHash: '' });
    expect(sub.isError).toBe(false);
    expect(sub.body.file).toBe('workflows/draft.md');
    const edited = await call({
      slug: 'release-notes',
      file: 'workflows/draft.md',
      textEdits: [{ find: 'one', replaceWith: 'two' }],
      expectedHash: sub.body.hash,
    });
    expect(edited.isError).toBe(false);
    expect(fs.readFileSync(abs('release-notes/workflows/draft.md'), 'utf-8')).toBe('Step two.\n');
    expect(edited.body.hash).toBe(sha('Step two.\n'));

    // Stale hash → conflict carrying the current hash; the file is untouched.
    const stale = await call({ slug: 'release-notes', file: 'workflows/draft.md', content: 'x', expectedHash: sub.body.hash });
    expect(stale.isError).toBe(true);
    expect(stale.body.code).toBe('PAGE_CONFLICT');
    expect(stale.body.currentHash).toBe(sha('Step two.\n'));
    expect(fs.readFileSync(abs('release-notes/workflows/draft.md'), 'utf-8')).toBe('Step two.\n');

    // "" against an existing file is a conflict too.
    const again = await call({ slug: 'release-notes', content: SKILL_MD, expectedHash: '' });
    expect(again.isError).toBe(true);
    expect(again.body.code).toBe('PAGE_CONFLICT');
    expect(again.body.currentHash).toBe(sha(SKILL_MD));

    // Not package-relative POSIX → INVALID_ARGUMENT, nothing written.
    for (const file of ['../escape.md', '/etc/passwd', 'a/../../b.md']) {
      const bad = await call({ slug: 'release-notes', file, content: 'x', expectedHash: '' });
      expect(bad.isError, file).toBe(true);
      expect(bad.body.code, file).toBe('INVALID_ARGUMENT');
    }
    // Both payloads, or neither → INVALID_ARGUMENT.
    const both = await call({ slug: 'release-notes', file: 'n.md', content: 'x', textEdits: [{ find: 'a', replaceWith: 'b' }], expectedHash: '' });
    expect(both.body.code).toBe('INVALID_ARGUMENT');
    const neither = await call({ slug: 'release-notes', file: 'n.md', expectedHash: '' });
    expect(neither.body.code).toBe('INVALID_ARGUMENT');
    expect(fs.existsSync(abs('release-notes/n.md'))).toBe(false);
  });

  it('[ac:m52-update-skill-file-requires-description] update_skill_file refuses a SKILL.md without a non-empty description — on create and on edit — and leaves the file as it was', async () => {
    const { call, abs } = await rig();

    // Create without `description` → refused, no package directory file.
    const noDescription = SKILL_MD.replace('description: How to write a release note.\n', '');
    const r1 = await call({ slug: 'notes', content: noDescription, expectedHash: '' });
    expect(r1.isError).toBe(true);
    expect(r1.body.code).toBe('INVALID_ARGUMENT');
    expect(String(r1.body.error)).toContain('description');
    expect(fs.existsSync(abs('notes/SKILL.md'))).toBe(false);

    // Empty (whitespace) description → refused.
    const blank = SKILL_MD.replace('description: How to write a release note.', 'description: "  "');
    const r2 = await call({ slug: 'notes', content: blank, expectedHash: '' });
    expect(r2.isError).toBe(true);
    expect(r2.body.code).toBe('INVALID_ARGUMENT');
    expect(fs.existsSync(abs('notes/SKILL.md'))).toBe(false);

    // No frontmatter at all → refused.
    const r3 = await call({ slug: 'notes', content: '# Notes\n', expectedHash: '' });
    expect(r3.isError).toBe(true);
    expect(r3.body.code).toBe('INVALID_ARGUMENT');

    // An edit that removes the description of an existing SKILL.md → refused, bytes kept.
    const ok = await call({ slug: 'notes', content: SKILL_MD, expectedHash: '' });
    expect(ok.isError).toBe(false);
    const r4 = await call({
      slug: 'notes',
      textEdits: [{ find: 'description: How to write a release note.\n', replaceWith: '' }],
      expectedHash: ok.body.hash,
    });
    expect(r4.isError).toBe(true);
    expect(r4.body.code).toBe('INVALID_ARGUMENT');
    expect(fs.readFileSync(abs('notes/SKILL.md'), 'utf-8')).toBe(SKILL_MD);

    // The rule is SKILL.md's alone: a subfile without frontmatter is written.
    const subfile = await call({ slug: 'notes', file: 'workflows/x.md', content: 'no header here\n', expectedHash: '' });
    expect(subfile.isError).toBe(false);
  });

  it('[entity:katalog-operacji-m52#update_skill_file] the L3 catalog row: project scope, agent-mediated, write class, internal direct and n/a with a reason in cli/mcp/rest, the five error codes, file effect, literal+diff, idempotent — and the guard is observable: a stale expectedHash is PAGE_CONFLICT', async () => {
    const row = CATALOG.require('update_skill_file');
    expect(row.scope).toBe('project');
    expect(row.mediation).toBe('agent-mediated');
    expect(row.opClass).toBe('write');
    expect(row.channels.internal).toEqual({ kind: 'direct' });
    for (const channel of ['cli', 'mcp', 'rest'] as const) {
      const cell = row.channels[channel];
      expect(cell.kind, channel).toBe('na');
      expect((cell as { reason: string }).reason.length, channel).toBeGreaterThan(0);
    }
    expect([...row.errorCodes].sort()).toEqual(
      ['FIND_NOT_FOUND', 'INVALID_ARGUMENT', 'MATCH_COUNT_MISMATCH', 'PAGE_CONFLICT', 'SKILL_READ_ONLY'].sort(),
    );
    expect(row.sideEffects).toEqual(['file']);
    expect(row.contentInput).toBe('literal+diff');
    expect(row.idempotent).toBe(true);
    // Addressing (slug, file) and the REQUIRED guard live in the input shape.
    expect(Object.keys(row.inputSchema).sort()).toEqual(['content', 'expectedHash', 'file', 'slug', 'textEdits'].sort());
    const expectedHash = row.inputSchema.expectedHash as { safeParse(v: unknown): { success: boolean } };
    expect(expectedHash.safeParse(undefined).success).toBe(false);
    expect(expectedHash.safeParse('').success).toBe(true);
    // A write: admitted where the turn may change the project, withheld from the read-only profiles.
    expect(profileAdmits('chat', row)).toBe(true);
    expect(profileAdmits('patch', row)).toBe(true);
    expect(profileAdmits('ask', row)).toBe(false);
    expect(profileAdmits('brief', row)).toBe(false);

    // The guard, observed through the internal rendering.
    const { call, abs } = await rig();
    const first = await call({ slug: 's', file: 'a.md', content: 'v1\n', expectedHash: '' });
    expect(first.isError).toBe(false);
    const second = await call({ slug: 's', file: 'a.md', content: 'v2\n', expectedHash: first.body.hash });
    expect(second.isError).toBe(false);
    const stale = await call({ slug: 's', file: 'a.md', content: 'v3\n', expectedHash: first.body.hash });
    expect(stale.isError).toBe(true);
    expect(stale.body.code).toBe('PAGE_CONFLICT');
    expect(fs.readFileSync(abs('s/a.md'), 'utf-8')).toBe('v2\n');
  });

  it('[ac:m52-update-skill-file-refuses-exposed] [entity:spec-skill-tools-update-skill-file] update_skill_file refuses to write a skill of an exposed project with SKILL_READ_ONLY — and writes nothing; a package of the project\'s own `skills` root under that slug outranks it and is writable', async () => {
    // The registry the project context wires in: the project's own `skills` root
    // (project-rooted) and one attachment, `billing-rules`, exposed by `billing`.
    const skillRegistry = SkillRegistry.load([], { rescanTtlMs: 0 });
    // As the project context wires it: the winner, and whether the project's own root holds the package.
    let absOf: (rel: string) => string = () => '';
    const readOnlyReason = (slug: string) => exposedReadOnlyReason(skillRegistry.winnerOf(slug), fs.existsSync(absOf(slug)));
    const { call, abs, cwd, roots } = await rig({ readOnlyReason });
    absOf = abs;
    registerProjectRootedSkills(skillRegistry, roots, cwd);
    skillRegistry.registerSource(
      new ProjectExposedSkillSource('p1', {
        uses: () => ['billing-rules'],
        listExposed: () => [
          { projectId: 'billing', name: 'billing-rules', description: 'How billing works.', entry: 'index.md', scope: 'contextual', contextTypes: undefined },
        ],
        readProvider: async () => ({ entry: 'index.md', content: '# Billing\n', files: toPackageFiles({}) }),
      }),
    );
    expect(skillRegistry.winnerOf('billing-rules')?.source).toBe('project-exposed');

    for (const args of [
      { slug: 'billing-rules', content: SKILL_MD, expectedHash: '' },
      { slug: 'billing-rules', file: 'notes.md', content: 'x\n', expectedHash: '' },
    ]) {
      const res = await call(args);
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('SKILL_READ_ONLY');
      expect(String(res.body.error)).toContain('read-only');
      expect(String(res.body.error)).toContain('ask({ project: "billing" })');
    }
    expect(fs.existsSync(abs('billing-rules'))).toBe(false);

    // A slug the registry does not resolve to an exposed project is written as before.
    expect((await call({ slug: 'release-notes', content: SKILL_MD, expectedHash: '' })).isError).toBe(false);
    // An own package under the same slug (here written by hand, `contextual` like the exposed one)
    // outranks it in the chain and lies in the project's own root: writable again.
    fs.mkdirSync(abs('billing-rules'), { recursive: true });
    fs.writeFileSync(abs('billing-rules/SKILL.md'), SKILL_MD.replace('language: en', 'language: en\nscope: contextual'));
    expect(skillRegistry.winnerOf('billing-rules')?.source).toBe('project-rooted');
    const own = await call({ slug: 'billing-rules', file: 'notes.md', content: 'x\n', expectedHash: '' });
    expect(own.isError).toBe(false);
  });

  it('the context-scoped element hands out a fresh server per call and none after the context disposes it (M52 L10)', () => {
    const element = new SpecSkillTools({ skillsRoot: () => undefined }, 'p1');
    const a = element.build();
    const b = element.build();
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
    expect(a!.tools.map((t) => t.name)).toEqual(['update_skill_file']);
    expect(SPEC_SKILL_TOOLS_SERVER).toBe('spec-skill-tools');
    element.dispose();
    expect(element.disposed).toBe(true);
    expect(element.build()).toBeNull();
  });
});
