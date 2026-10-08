import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderSpecReaderSkill,
  renderBriefImplementerSkill,
  renderRefactorSkill,
  buildExternalSkillContext,
  buildExternalSkillsBundle,
  writeFileSet,
  externalSkillsMetadata,
  isSkillSlug,
  ALL_SKILL_SLUGS,
} from './external-skills-service.js';
import type { ExternalSkillContext } from './types.js';
import type { ProjectRecord } from '../workspace/types.js';

const SKILL_DIRS = [
  'c4s-spec-reader',
  'c4s-brief-implementer',
  'c4s-refactor',
] as const;

// 2.1.0: address injected into every generated SKILL.md — see ExternalSkillContext.
const FIXTURE_CTX: ExternalSkillContext = {
  id: 'my-spec-project',
  workspace: 'default',
  publicUrl: 'https://c4s.example.dev',
};
const IDENTITY = `--server '${FIXTURE_CTX.publicUrl}' --project '${FIXTURE_CTX.id}'`;

describe('renderers', () => {
  it('bake in --server <publicUrl> --project <id> in every c4s command, no filesystem fallback', () => {
    const outputs = {
      'c4s-spec-reader': renderSpecReaderSkill(FIXTURE_CTX),
      'c4s-brief-implementer': renderBriefImplementerSkill(FIXTURE_CTX),
      'c4s-refactor': renderRefactorSkill(FIXTURE_CTX),
    };
    for (const [name, body] of Object.entries(outputs)) {
      expect(body, name).toContain(IDENTITY);
      // No slug-era selector survives: --workspace is implied by --server.
      expect(body, name).not.toMatch(/--workspace '/);
      // Every `c4s <verb>` command line in a sh block carries the address.
      for (const line of body.split('\n').filter((l) => /^c4s [a-z_-]+ /.test(l) && !l.trimEnd().endsWith('\\'))) {
        expect(line, `${name}: ${line}`).toContain(IDENTITY);
      }
      // 2.1.0: identical stale-address hint in all three skills.
      expect(body, name).toContain('## Stale address — `PROJECT_NOT_IN_WORKSPACE`');
      expect(body, name).toContain(
        `the server at \`${FIXTURE_CTX.publicUrl}\` does not serve the project \`${FIXTURE_CTX.id}\``,
      );
      expect(body, name).toContain('Stop and ask the user to regenerate this skill');
      // frontmatter description starts with a verb (Read… / Implement… / Detect…)
      const desc = body.match(/^description:\s*(\S+)/m)?.[1];
      expect(desc, `${name} description verb`).toMatch(/^(Read|Implement|Detect)/);
      expect(body, name).not.toMatch(/walk up the directory tree/);
      expect(body, name).not.toContain('PROJECT_SLUG_NOT_FOUND');
      // 0.1.106: strictly CLI-only — no filesystem-fallback reads/writes, no MCP setup block.
      expect(body, name).not.toMatch(/[Ff]allback \(no/);
      expect(body, name).not.toMatch(/yq -i/);
      expect(body, name).not.toContain('mcp.json');
    }
    expect(outputs['c4s-brief-implementer']).toContain('c4s mark-brief-implemented');
    // 0.1.108: Path 2 (code-fix) routes through native create-mode now — the old
    // `--ct chat` + `runTransagent` workaround is gone.
    // 0.2.64: no provenance flag — passing no window is what keeps `to` open.
    // 0.2.94: Path 2 mints the brief with a finished body and starts no turn, so
    // `--ct brief` is gone from the skill entirely — asserting on its absence is
    // what keeps the old flow from creeping back in as prose.
    expect(outputs['c4s-refactor']).toContain('c4s create-brief --body-file');
    expect(outputs['c4s-refactor']).not.toContain('--ct brief');
    expect(outputs['c4s-refactor']).not.toContain('--source');
    expect(outputs['c4s-refactor']).not.toContain('runTransagent');
    expect(outputs['c4s-refactor']).not.toMatch(/--ct chat/);
  });
});

describe('c4s-brief-implementer loop (0.2.96 verbs)', () => {
  it('[ac:ac-body-c4s-brief-implementer-skill-md-op] discovers with list-briefs, reads with get-brief, files feedback with create-patch', () => {
    const body = renderBriefImplementerSkill(FIXTURE_CTX);
    const identity = IDENTITY;
    expect(body).toContain(`c4s list-briefs --status pending --limit 10 ${identity}`);
    expect(body).toContain(`c4s get-brief <brief-path> ${identity}`);
    expect(body).toMatch(/printf '%s\\n' "\$PATCH_BODY" \| c4s create-patch/);
    expect(body).toContain('c4s mark-brief-implemented <brief-path>');
    // the description names the new verbs too
    const desc = body.match(/^description:.*$/m)?.[0] ?? '';
    expect(desc).toContain('get-brief');
    expect(desc).toContain('c4s create-patch');
    // no escape hatch: a failed command stops, it does not fall back to spec files
    expect(body).toContain('even when a `c4s` command fails');
    // 0.2.96 renamed the verbs without an alias — the old spellings must not
    // survive anywhere in any generated skill, or an agent calls a dead command.
    for (const out of [body, renderRefactorSkill(FIXTURE_CTX), renderSpecReaderSkill(FIXTURE_CTX)]) {
      expect(out).not.toMatch(/read-brief|file-patch/);
    }
  });
});

describe('c4s-spec-reader body (2.1.8 — get-page has no line window)', () => {
  const body = renderSpecReaderSkill(FIXTURE_CTX);

  it('[ac:ac-body-c4s-spec-reader-skill-md-zawiera] carries the tag↔CLI mapping, resolve, page/section navigation, discovery and c4s ask — CLI-only', () => {
    // tag ↔ CLI mapping: exactly five rows, one per tag
    const mappingRows = body.split('\n').filter((l) => /^\| `<[a-z_]+ .*\/>` \| `c4s [a-z_]+ /.test(l));
    expect(mappingRows).toHaveLength(5);
    for (const tag of ['inline_mention', 'single_element', 'element_list', 'tagged_list', 'tagged_list_mixed']) {
      expect(mappingRows.some((r) => r.startsWith(`| \`<${tag} `) && r.includes(`c4s ${tag} --`)), tag).toBe(true);
    }
    // c4s resolve
    expect(body).toContain(`c4s resolve some-page.md ${IDENTITY}`);
    // navigation section: search-pages → anchor → batched get-sections, outline, list-pages, get-page
    expect(body).toContain('## Navigating pages and sections');
    expect(body).toMatch(/c4s search-pages --query "<phrase>" .*# hits carry an anchor/);
    expect(body).toContain(`c4s get-sections --anchors a,b,c ${IDENTITY}`);
    expect(body).toContain(`c4s get-page-outline --root-id pages --path some/page.md ${IDENTITY}`);
    expect(body).toContain(`c4s list-pages --root-id pages`);
    expect(body).toContain(`c4s get-page --root-id pages --path some/page.md ${IDENTITY}`);
    // the get-page guard is gone (2.1.8): no `--range` anywhere in the skill
    expect(body).not.toContain('--range');
    // discovery section and the c4s ask mention
    expect(body).toContain('## Discovery');
    expect(body).toContain(`c4s catalog ${IDENTITY}`);
    expect(body).toContain(`c4s ask "<question>" ${IDENTITY}`);
    // CLI-only: no MCP setup section
    expect(body).not.toMatch(/^#+ .*MCP setup/im);
    expect(body).not.toContain('mcp.json');
    expect(body).toContain('CLI-only');
  });

  it('[ac:ac-body-c4s-spec-reader-skill-md-zawiera-2] search → anchor → batched get-sections, outline as a document-order tree, get-page as anchor-keyed sections whose cut read resumes via outline + sections', () => {
    // search hit already carries the anchor, then ONE batched get-sections
    expect(body).toContain('a search hit already carries the anchor');
    expect(body).toContain(`c4s get-sections --anchors a,b,c ${IDENTITY}`);
    expect(body).toContain('Fetch sections in **batches**');
    expect(body).toContain('Asking anchor-by-anchor costs one command per section');
    // outline: a tree in document order
    expect(body).toContain('comes back as a tree in document order');
    // get-page: sections keyed by anchor, frontmatter and preamble, XML tags untouched
    expect(body).toContain('The page comes back as **structure**');
    expect(body).toContain('{ rootId, path, hash, frontmatter?, preamble?, results[] }');
    expect(body).toContain('Each item of `results` is one section');
    expect(body).toContain('The anchor is a field');
    expect(body).toContain('`frontmatter.raw` is the frontmatter verbatim');
    expect(body).toContain('`preamble` is the text above the first heading');
    expect(body).toContain('XML tags in `body` are left untouched');
    // a cut read resumes through get-page-outline + get-sections — never a line window
    expect(body).toContain(
      'There is no line window on `get-page`: to continue a cut read, go through `get-page-outline` and `get-sections`.',
    );
    expect(body).not.toMatch(/--range|non-section-indexed|indexed root/);
  });
});

describe('buildExternalSkillContext', () => {
  const project: ProjectRecord = {
    cwd: '/abs/my-spec-project',
    id: 'my-spec-project',
    addedAt: '2026-01-01T00:00:00.000Z',
  };

  it('carries { id, workspace, publicUrl } — no slug, no directory', () => {
    const ctx = buildExternalSkillContext(project, { name: 'default', defaultPort: 4500 });
    expect(ctx).toEqual({ id: 'my-spec-project', workspace: 'default', publicUrl: 'http://localhost:4500' });
    expect(JSON.stringify(ctx)).not.toContain('/abs/');
  });

  it("uses the workspace's publicUrl when set, and an explicit override over it", () => {
    const ws = { name: 'team', defaultPort: 4500, publicUrl: 'https://c4s.firma.dev' };
    expect(buildExternalSkillContext(project, ws).publicUrl).toBe('https://c4s.firma.dev');
    expect(buildExternalSkillContext(project, ws, 'https://other.dev/').publicUrl).toBe('https://other.dev');
  });

  it('renders identical skills before and after the spec repo moved', () => {
    const moved = { ...project, cwd: '/elsewhere/renamed-dir' };
    const ws = { name: 'default', defaultPort: 4500 };
    expect(buildExternalSkillsBundle(buildExternalSkillContext(moved, ws))).toEqual(
      buildExternalSkillsBundle(buildExternalSkillContext(project, ws)),
    );
  });
});

describe('isSkillSlug / ALL_SKILL_SLUGS', () => {
  it('recognizes exactly the three known slugs', () => {
    expect(ALL_SKILL_SLUGS).toEqual(['spec-reader', 'brief-implementer', 'refactor']);
    for (const slug of ALL_SKILL_SLUGS) expect(isSkillSlug(slug)).toBe(true);
    expect(isSkillSlug('bogus')).toBe(false);
  });
});

describe('externalSkillsMetadata', () => {
  it('returns exactly three entries with no SKILL.md content', () => {
    const meta = externalSkillsMetadata();
    expect(meta).toHaveLength(3);
    expect(meta.map((m) => m.slug).sort()).toEqual(['brief-implementer', 'refactor', 'spec-reader']);
    for (const m of meta) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.description).toBe('string');
    }
  });
});

describe('buildExternalSkillsBundle', () => {
  it('defaults to all three skills, keyed by <dirName>/SKILL.md', () => {
    const bundle = buildExternalSkillsBundle(FIXTURE_CTX);
    expect([...bundle.keys()].sort()).toEqual([
      'c4s-brief-implementer/SKILL.md',
      'c4s-refactor/SKILL.md',
      'c4s-spec-reader/SKILL.md',
    ]);
    expect(bundle.get('c4s-refactor/SKILL.md')).toBe(renderRefactorSkill(FIXTURE_CTX));
  });

  it('narrows to an explicit selection', () => {
    const bundle = buildExternalSkillsBundle(FIXTURE_CTX, ['spec-reader']);
    expect([...bundle.keys()]).toEqual(['c4s-spec-reader/SKILL.md']);
  });

  it('is deterministic for the same ctx', () => {
    const before = buildExternalSkillsBundle(FIXTURE_CTX);
    const after = buildExternalSkillsBundle(FIXTURE_CTX);
    expect([...before.entries()]).toEqual([...after.entries()]);
  });
});

describe('writeFileSet', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skills-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes every entry, creating the target dir lazily', () => {
    const bundle = buildExternalSkillsBundle(FIXTURE_CTX);
    const written = writeFileSet(dir, bundle);
    expect(written).toHaveLength(3);
    for (const d of SKILL_DIRS) {
      expect(fs.existsSync(path.join(dir, d, 'SKILL.md'))).toBe(true);
    }
  });

  it('overwrites unconditionally, no hash-diff', () => {
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    const target = path.join(dir, 'c4s-refactor', 'SKILL.md');
    fs.writeFileSync(target, '# hand-edited', 'utf8');
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    expect(fs.readFileSync(target, 'utf8')).toBe(renderRefactorSkill(FIXTURE_CTX));
  });

  it('[ac:ac-claude4spec-patches-powstaje-wylaczn] never creates a patches directory — that is the server\'s, lazily', () => {
    const bundle = buildExternalSkillsBundle(FIXTURE_CTX);
    for (const [relPath] of bundle) expect(relPath).not.toMatch(/patches/);
    writeFileSet(dir, bundle);
    expect(fs.readdirSync(dir).sort()).toEqual([...SKILL_DIRS].sort());
  });

  it('leaves sibling non-SKILL.md files untouched', () => {
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    const sibling = path.join(dir, 'c4s-refactor', 'NOTES.md');
    fs.writeFileSync(sibling, 'my own notes', 'utf8');
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    expect(fs.readFileSync(sibling, 'utf8')).toBe('my own notes');
  });
});
