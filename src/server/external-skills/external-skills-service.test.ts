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
import { SERVER_REQUIRED_BLOCK, skillIdentity, staleAddressBlock } from './server-required.js';
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

// ---------------------------------------------------------------------------
// 2.1.14 (M22) — the shared blocks of the three renderers and the rewritten
// c4s-spec-reader body. The page sections below are the spec page
// `modules/m22-external-skills/c4s-spec-reader.md` at release 2.1.14, verbatim
// (placeholders `<publicUrl>` / `<id>` unsubstituted); the renderer emits them
// 1:1 with the placeholders substituted.
// ---------------------------------------------------------------------------

const SPEC_READER_PAGE_2_1_14: Record<string, string> = {
  "coz7bila": "This skill is bound to one claude4spec specification project — every `c4s` command below carries its identity (`--server '<publicUrl>' --project '<id>'`), so it works from any cwd, including a foreign code repo whose pages reference this spec's entities. Do NOT `cd` into the spec repo; the identity is baked in, not derived from cwd.\n\n**CLI-only — no filesystem fallback.** Every command below goes through `c4s`. If `c4s` isn't installed, STOP and ask the user to install it — never read the spec repo's pages or entity files directly.",
  "sws0pnrn": "Every `c4s` command in this skill talks to a running `npx @inharness-ai/claude4spec` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.\n\n`SERVER_NOT_RUNNING` **(exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.\n\nTwo neighbouring codes mean something else, and starting a server will not fix either: `SERVER_NOT_RECOGNIZED` (something is listening, but it is not claude4spec) and `PROJECT_NOT_IN_WORKSPACE` (the server is fine, but it does not serve this skill's project — see \"Stale address\" below). Report those as they are.",
  "h4vfz91m": "`PROJECT_NOT_IN_WORKSPACE` means the server at `<publicUrl>` does not serve the project `<id>` — the address baked into this skill is stale. **Stop and ask the user to regenerate this skill** (Settings → External Integrations, or `c4s install-skills`). Do not guess another `--project` or `--server` value.",
  "t8xj5140": "Install `claude4spec` (Node 20+) and use the `c4s` CLI. Subcommand names match XML tag names 1:1 — append `--server '<publicUrl>' --project '<id>'` to every command below.\n\n| XML tag | CLI equivalent |\n|---------|----------------|\n| `<inline_mention type=\"endpoint\" slug=\"X\"/>` | `c4s inline_mention --type endpoint --slug X --server '<publicUrl>' --project '<id>'` |\n| `<single_element type=\"dto\" slug=\"X\"/>` | `c4s single_element --type dto --slug X --server '<publicUrl>' --project '<id>'` |\n| `<element_list type=\"endpoint\" slugs=\"a,b,c\"/>` | `c4s element_list --type endpoint --slugs a,b,c --server '<publicUrl>' --project '<id>'` |\n| `<tagged_list type=\"dto\" tags=\"auth\" filter=\"and\"/>` | `c4s tagged_list --type dto --tags auth --filter and --server '<publicUrl>' --project '<id>'` |\n| `<tagged_list_mixed tags=\"public\"/>` | `c4s tagged_list_mixed --tags public --server '<publicUrl>' --project '<id>'` |",
  "foj9tbk4": "```sh\nc4s resolve some-page.md --server '<publicUrl>' --project '<id>'                # writes markdown with tags expanded inline\nc4s resolve some-page.md --format json --server '<publicUrl>' --project '<id>'   # writes { content, resolved: [...] }\n```\n\nThis is a RENDER convenience, and the only surface that still offers it. It takes a path to a markdown file **you already have** — a page in the repo you are working in, for instance. It is not how you read the specification's own pages, and there is no MCP equivalent: expanding a tag pastes the entity's payload over the reference, and the reference is the more useful half. To read a spec page, ask for it with `get-page` (tags stay unexpanded) and follow the embeds you care about by slug (`c4s single_element --type <t> --slug <s>`).",
  "dw3xlkgn": "A whole page is often more than you need. Pages are addressed by the full key `(rootId, path)` — the same relative path can exist in several roots, so `--root-id` is required and there is no silent fallback. Sections are addressed by `anchor` alone (globally unique), so section commands take no root.\n\nThe normal path from \"I have a phrase\" to \"I have the text\" is TWO commands, not three — a search hit already carries the anchor, so there is nothing to look up in between:\n\n```sh\nc4s search-pages --query \"<phrase>\" --server '<publicUrl>' --project '<id>'   # hits carry an anchor\nc4s get-sections --anchors a,b,c --server '<publicUrl>' --project '<id>'      # bodies of several sections in ONE call\n```\n\nFetch sections in **batches** — `get-sections` takes a comma-separated list and returns `{ results: [...] }` in input order. An unknown anchor comes back as an error **inside its own item**, so one bad anchor does not lose the other sections. Asking anchor-by-anchor costs one command per section for no benefit.\n\nTo see what a page contains before pulling any of it, ask for its outline. It comes back as a tree in document order — a table of contents — and every node carries the section's anchor, its heading, its level and the size of its own body, so you can pick exactly the anchors worth fetching:\n\n```sh\nc4s get-page-outline --root-id pages --path some/page.md --server '<publicUrl>' --project '<id>'\nc4s list-pages --root-id pages [--prefix modules/] --server '<publicUrl>' --project '<id>'\n```\n\nWhole page, when you really want all of it:\n\n```sh\nc4s get-page --root-id pages --path some/page.md --server '<publicUrl>' --project '<id>'\n```\n\nThe page comes back as **structure**, not as one text: `{ rootId, path, hash, frontmatter?, preamble?, results[] }`. Each item of `results` is one section — `anchor`, `heading_text`, `heading_level`, `body` — in document order. The anchor is a field, so you pass it straight to `get-sections`; `body` holds neither the anchor line nor the heading line. `frontmatter.raw` is the frontmatter verbatim and `frontmatter.fields` its parsed keys (absent when the YAML does not parse); `preamble` is the text above the first heading. `hash` is what a write expects. Add `--format text` to get the page assembled back into markdown for reading.\n\nXML tags in `body` are left untouched — the tag is the edge to another entity, so expanding it would replace a link with a payload. Resolve the tags you care about with the commands above. On a page over the response budget, some items come back with `truncated: true` and no `body`, and `message` names their anchors — fetch those with `get-sections`. There is no line window on `get-page`: to continue a cut read, go through `get-page-outline` and `get-sections`.",
  "wy9a0mdr": "- `c4s catalog --server '<publicUrl>' --project '<id>'` — the ENTRY POINT: page roots (`id`, `name`, `dir`, `builtin`, `pageCount`), active entity types with counts + version + description + roleNoun + mcpToolsLine per type, tag count. Start here; it is cheap and it tells you what else is worth asking.\n- `c4s describe --type <t> --server '<publicUrl>' --project '<id>'` — what a type IS: JSON Schemas, the value `constraints` a write must satisfy, `selectableFields` (the names `--select` accepts), `contentFields` (fields no generic read carries, each with the operation that issues them) and `searchableFields`. Worth calling before a READ, not just before a write.\n- `c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>] --server '<publicUrl>' --project '<id>'` — the project tags. Counts are OFF by default (they are a product of tags by types); `--co-occurring-with` returns the tags sharing entities with one you name, which is how you discover a taxonomy without already knowing it.\n- `c4s list-entities --type endpoint [--tags auth] [--tag-filter and|or] [--sort createdAt|title|slug] [--dir asc|desc] [--mode items|count] --server '<publicUrl>' --project '<id>'` — full paginated traversal of one type. Rows are `{ slug, title }`: discovery answers with keys, and you follow up with `get-entities` for content. `--mode count` answers \"how many\" without listing. Only the default `createdAt` order has a write-stable offset window.\n- `c4s get-entities --type dto --slugs a,b,c [--select <f1,f2>] --server '<publicUrl>' --project '<id>'` — several entities in one call. `--select` names top-level fields (`slug`, `title` and `tags` always come back); omit it for every field except content-bearing ones, or pass `--select=` for the identity skeleton alone.\n- `c4s get-field-content --type diagram --slug <s> --field source --server '<publicUrl>' --project '<id>'` — the content of ONE content-bearing field. Such a field is carried by no generic read (you get `has<Field>` / `<field>Bytes` instead), so this is the only way to read one.\n- `c4s search-entities --type ac --query \"<phrase>\" [--fields <f1,f2>] --server '<publicUrl>' --project '<id>'` — text search inside one type (the type is required); the output always declares `searchedFields`, so an empty result is distinguishable from an unsearched field.\n- `c4s resolve-identity --query \"<fragment>\" [--types endpoint,dto] --server '<publicUrl>' --project '<id>'` — the only cross-type command: \"what is this called?\" from a fragment of a name.\n- `c4s check-consistency [--severity <s>] [--rule <r>] --server '<publicUrl>' --project '<id>'` — the spec's own diagnostics (broken references, drift between disk and index).\n\nEvery list command accepts `--limit` / `--offset` and reports `total` + `hasMore` — measure before you fetch.\n\nEvery command above is one of the fifteen read-only **discovery operations** under a CLI name. The operation owns the behaviour — pagination, response budget, sort order, and what an error suggests you do next; the command is a transport over it. The mapping, when you need to read the operation's contract:\n\n| CLI command | Operation |\n|-------------|-----------|\n| `c4s catalog` | `overview` |\n| `c4s describe` | `describe_types` |\n| `c4s list-tags` | `list_tags` |\n| `c4s inline_mention` / `single_element` / `element_list` / `detail` | `get_entities` (one projection each) |\n| `c4s get-field-content` | `get_field_content` |\n| `c4s tagged_list` / `tagged_list_mixed` | `list_entities` (tag-filtered) |\n| `c4s get-entities` / `c4s list-entities` | `get_entities` / `list_entities` (the canonical surface the aliases above sit on) |\n| `c4s list-pages` / `c4s get-page` | `list_pages` / `get_page` |\n| `c4s get-page-outline` / `c4s get-sections` | `get_page_outline` / `get_sections` |\n| `c4s search-pages` / `c4s search-entities` | `search_pages` / `search_entities` |\n| `c4s check-consistency` / `c4s resolve-identity` | `check_consistency` / `resolve_identity` |\n| `c4s find-references` | `find_references` |\n\nAll output is JSON (pretty) by default. Use `--compact` for pipelines and `--format text` for terminal-friendly output. Errors go to stderr as JSON with an exit code > 0, and an error is navigable rather than merely a refusal: a `*_NOT_FOUND` names the alternatives it knows about, and an `INVALID_ARGUMENT` names the call that would have worked. Read the `hint` before guessing again.\n\nNone of these commands mutates the project: they render read operations of the specification, and `c4s` opens no database of its own.",
  "a28ukbcn": "When a question goes beyond resolving entities or pages, `c4s ask` runs a synchronous agent turn against the specification:\n\n```sh\nc4s ask \"<question>\" --server '<publicUrl>' --project '<id>'\n```\n\nIt needs the same running server every other command here needs — see \"Server required\" above. What is different about it is the cost, not the requirement: it runs a full agent turn rather than answering from the index, so it can also come back `AGENT_UNAVAILABLE` or `TIMEOUT`.",
  "zvd7wn4t": "If `c4s` reports `PROJECT_NOT_IN_WORKSPACE` or `PROJECT_ID_NOT_FOUND`, this skill's baked-in address (`--server '<publicUrl>' --project '<id>'`) is stale — stop and ask the user to regenerate the skill (see \"Stale address\" above). If `c4s ask` reports the server isn't recognized as a claude4spec server, or that the project failed to build (`PROJECT_BUILD_FAILED`), that's a problem on the spec repo/server side — report it to the user; don't try to fix the spec repo from here.",
};

const SPEC_READER_HEADINGS: Array<[anchor: string, heading: string]> = [
  ['coz7bila', '# c4s-spec-reader'],
  ['sws0pnrn', '## Server required — for every step'],
  ['h4vfz91m', '## Stale address — `PROJECT_NOT_IN_WORKSPACE`'],
  ['t8xj5140', '## Resolving a tag'],
  ['foj9tbk4', '## Expanding a whole page'],
  ['dw3xlkgn', '## Navigating pages and sections'],
  ['wy9a0mdr', '## Discovery'],
  ['a28ukbcn', '## Asking the spec agent'],
  ['zvd7wn4t', '## Errors'],
];

/** A ctx whose every value is distinctive, so a leak of any one is greppable. */
const LEAK_CTX: ExternalSkillContext = {
  id: 'proj-q7x2',
  workspace: 'ws-zz9-unique',
  publicUrl: 'https://spec.example.test:4999',
};

const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();
const substitute = (t: string, ctx: ExternalSkillContext): string =>
  t.replaceAll('<publicUrl>', ctx.publicUrl).replaceAll('<id>', ctx.id);

/** Rendered body split into `heading → section text (without the heading line)`. */
function renderedSections(rendered: string): Map<string, string> {
  const body = rendered.slice(rendered.indexOf('\n---\n') + 5);
  const out = new Map<string, string>();
  let heading: string | null = null;
  let buf: string[] = [];
  for (const line of body.split('\n')) {
    if (/^#{1,2} /.test(line)) {
      if (heading !== null) out.set(heading, buf.join('\n'));
      heading = line;
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (heading !== null) out.set(heading, buf.join('\n'));
  return out;
}

function expectSectionVerbatim(anchor: string, ctx: ExternalSkillContext = LEAK_CTX): void {
  const heading = SPEC_READER_HEADINGS.find(([a]) => a === anchor)![1];
  const got = renderedSections(renderSpecReaderSkill(ctx)).get(heading);
  expect(got, `section ${heading} missing`).toBeDefined();
  expect(squash(got!)).toBe(squash(substitute(SPEC_READER_PAGE_2_1_14[anchor]!, ctx)));
}

describe('M22 shared renderer blocks (2.1.14)', () => {
  const renderers = {
    'c4s-spec-reader': renderSpecReaderSkill,
    'c4s-brief-implementer': renderBriefImplementerSkill,
    'c4s-refactor': renderRefactorSkill,
  } as const;

  it('[section:m22dserv] all three renderers carry the same "Server required" block, the same ctx-parameterized "Stale address" block and the quoted identity on every c4s command', () => {
    const identity = `--server '${LEAK_CTX.publicUrl}' --project '${LEAK_CTX.id}'`;
    expect(skillIdentity(LEAK_CTX)).toBe(identity);
    for (const [name, render] of Object.entries(renderers)) {
      const out = render(LEAK_CTX);
      expect(out, name).toContain(SERVER_REQUIRED_BLOCK);
      expect(out, name).toContain(staleAddressBlock(LEAK_CTX));
      // the stale block is parameterized by publicUrl and id
      expect(staleAddressBlock(LEAK_CTX)).toContain(`the server at \`${LEAK_CTX.publicUrl}\` does not serve the project \`${LEAK_CTX.id}\``);
      // Server required: stop on SERVER_NOT_RUNNING, the two neighbouring codes told apart
      expect(SERVER_REQUIRED_BLOCK).toContain('`SERVER_NOT_RUNNING` **(exit 8) from any command — stop.**');
      expect(SERVER_REQUIRED_BLOCK).toContain('`SERVER_NOT_RECOGNIZED`');
      expect(SERVER_REQUIRED_BLOCK).toContain('`PROJECT_NOT_IN_WORKSPACE`');
      // every c4s command line (sh block or table cell) carries the quoted identity
      const commands = out
        .split('\n')
        .flatMap((l) => (/^c4s [a-z_-]+ /.test(l) && !l.trimEnd().endsWith('\\') ? [l] : []));
      expect(commands.length, name).toBeGreaterThan(0);
      for (const c of commands) expect(c, `${name}: ${c}`).toContain(identity);
      // no unquoted identity survives anywhere
      expect(out, name).not.toContain(`--server ${LEAK_CTX.publicUrl}`);
      expect(out, name).not.toContain(`--project ${LEAK_CTX.id}`);
    }
  });

  it('[section:m22dserv] the workspace reaches neither a c4s call nor anywhere else in the skill text', () => {
    for (const [name, render] of Object.entries(renderers)) {
      const out = render(LEAK_CTX);
      expect(out, name).not.toContain(LEAK_CTX.workspace);
      expect(out, name).not.toContain('--workspace');
      expect(out, name).not.toContain('<workspace>');
    }
    // two ctx differing only in workspace render the same bundle
    expect(buildExternalSkillsBundle({ ...LEAK_CTX, workspace: 'other-ws' })).toEqual(buildExternalSkillsBundle(LEAK_CTX));
  });

  it('[section:m22dserv] publicUrl loses its trailing slashes when the context is built, so an address with and without "/" renders the same skill', () => {
    const project = { id: 'proj-q7x2' };
    const bare = buildExternalSkillContext(project, { name: 'w', defaultPort: 4500, publicUrl: 'https://spec.example.test' });
    const slashed = buildExternalSkillContext(project, { name: 'w', defaultPort: 4500, publicUrl: 'https://spec.example.test///' });
    const overridden = buildExternalSkillContext(project, { name: 'w', defaultPort: 4500 }, 'https://spec.example.test/');
    expect(bare.publicUrl).toBe('https://spec.example.test');
    expect(slashed.publicUrl).toBe('https://spec.example.test');
    expect(overridden.publicUrl).toBe('https://spec.example.test');
    expect(buildExternalSkillsBundle(slashed)).toEqual(buildExternalSkillsBundle(bare));
    expect(buildExternalSkillsBundle(overridden)).toEqual(buildExternalSkillsBundle(bare));
    expect(renderSpecReaderSkill(slashed)).not.toContain("test/'");
  });
});

describe('c4s-spec-reader body (2.1.14 rewrite)', () => {
  it('[section:m22dread] intro, Server required, Stale address, tag mapping, resolve, navigation, discovery with the CLI→operation table, ask and errors — in that order, CLI-only', () => {
    const headings = [...renderedSections(renderSpecReaderSkill(LEAK_CTX)).keys()];
    expect(headings).toEqual(SPEC_READER_HEADINGS.map(([, h]) => h));
    const out = renderSpecReaderSkill(LEAK_CTX);
    // tag mapping: five rows
    expect(out.split('\n').filter((l) => /^\| `<[a-z_]+ .*\/>` \| `c4s [a-z_]+ /.test(l))).toHaveLength(5);
    // the discovery table names the fifteen read operations
    const ops = new Set(
      [...out.matchAll(/^\| `c4s [^|]+\| (.+) \|$/gm)].flatMap((m) => [...m[1]!.matchAll(/`([a-z_]+)`/g)].map((x) => x[1]!)),
    );
    expect(ops.size).toBe(15);
    expect(out).toContain('fifteen read-only **discovery operations**');
    expect(out).not.toMatch(/^#+ .*MCP setup/im);
  });

  it('[section:c4s-spec-reader/~preamble] substitutes <publicUrl> → ctx.publicUrl and <id> → ctx.id, never ctx.workspace, emits the page frontmatter, and describes c4s ask without --ct/--brief', () => {
    const out = renderSpecReaderSkill(LEAK_CTX);
    expect(out).not.toContain('<publicUrl>');
    expect(out).not.toContain('<id>');
    expect(out).not.toContain(LEAK_CTX.workspace);
    expect(out).toContain(`--server '${LEAK_CTX.publicUrl}' --project '${LEAK_CTX.id}'`);
    expect(out.startsWith(`---
name: c4s-spec-reader
description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Use when working in a repository whose pages/ contain these tags or whose .claude4spec/ directory exists. Resolves entity slugs to full data via the c4s CLI.
---
`)).toBe(true);
    const askLine = out.split('\n').find((l) => l.startsWith('c4s ask '))!;
    expect(askLine).toBe(`c4s ask "<question>" ${skillIdentity(LEAK_CTX)}`);
    expect(out).not.toMatch(/--ct|--brief/);
  });

  it('[section:coz7bila] the intro binds the skill to one project by injected identity (not cwd) and is CLI-only with no filesystem fallback — the old "Addressing is portable" and workspace mention are gone', () => {
    expectSectionVerbatim('coz7bila');
    const out = renderSpecReaderSkill(LEAK_CTX);
    expect(out).not.toContain('Addressing is portable; execution is not');
    expect(out).not.toMatch(/in workspace/);
  });

  it('[section:sws0pnrn] "Server required — for every step" is the page text verbatim', () => {
    expectSectionVerbatim('sws0pnrn');
  });

  it('[section:h4vfz91m] "Stale address" is the page text verbatim, with the baked-in publicUrl and id', () => {
    expectSectionVerbatim('h4vfz91m');
  });

  it('[section:t8xj5140] "Resolving a tag" appends the quoted identity to all five tag commands', () => {
    expectSectionVerbatim('t8xj5140');
  });

  it('[section:foj9tbk4] "Expanding a whole page" frames c4s resolve as a render convenience for a file you already have, not a way to read spec pages', () => {
    // ASSUMPTION:m22-dev-0001 — the json comment names the real output shape
    // (`{ format, text, resolved }`) instead of the page's `{ content, resolved }`.
    const heading = '## Expanding a whole page';
    const got = renderedSections(renderSpecReaderSkill(LEAK_CTX)).get(heading)!;
    const expected = substitute(SPEC_READER_PAGE_2_1_14['foj9tbk4']!, LEAK_CTX).replace(
      '# writes { content, resolved: [...] }',
      '# writes { format, text, resolved: [...] } — the original text plus what each tag resolved to',
    );
    expect(squash(got)).toBe(squash(expected));
    expect(got).toContain('This is a RENDER convenience');
    expect(got).toContain('It is not how you read the specification\'s own pages');
  });

  it('[section:dw3xlkgn] "Navigating pages and sections" is the page text verbatim — search → anchor → batched get-sections in TWO commands', () => {
    expectSectionVerbatim('dw3xlkgn');
  });

  it('[section:wy9a0mdr] "Discovery" starts at catalog as the entry point and maps every CLI command to its read operation; the old bullet list and the "These commands are read-only" paragraph are gone', () => {
    expectSectionVerbatim('wy9a0mdr');
    const out = renderSpecReaderSkill(LEAK_CTX);
    expect(out).not.toContain('These commands are **read-only**');
    expect(out).not.toContain('(smoke test)');
    expect(out).toContain('| `c4s catalog` | `overview` |');
    expect(out).toContain('| `c4s find-references` | `find_references` |');
  });

  it('[section:a28ukbcn] "Asking the spec agent" needs the same server, costs a full turn; no thread continuation and no alias note', () => {
    expectSectionVerbatim('a28ukbcn');
    const out = renderSpecReaderSkill(LEAK_CTX);
    expect(out).not.toContain('--thread');
    expect(out).not.toContain('alias for `c4s agent --ct ask`');
    expect(out).toContain('`AGENT_UNAVAILABLE` or `TIMEOUT`');
  });

  it('[section:zvd7wn4t] "Errors" sends a stale address to regeneration and a spec-side failure to the user', () => {
    expectSectionVerbatim('zvd7wn4t');
  });
});
