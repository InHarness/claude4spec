#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from './c4s/package-version.js';
import { assertFlagValues, assertKnownFlags, parseArgs } from './c4s/args.js';
import { CliError, cliErrorFromDiscovery, codeToExit } from './c4s/errors.js';
import { writeError } from './c4s/output.js';
import { DEFAULT_MODEL } from '../core/agent/models.js';
import type { CliCommandContribution } from './c4s/registry.js';
import { inlineMentionCommand } from './c4s/commands/inline-mention.js';
import { singleElementCommand } from './c4s/commands/single-element.js';
import { elementListCommand } from './c4s/commands/element-list.js';
import { taggedListCommand } from './c4s/commands/tagged-list.js';
import { taggedListMixedCommand } from './c4s/commands/tagged-list-mixed.js';
import { detailCommand } from './c4s/commands/detail.js';
import { catalogCommand } from './c4s/commands/catalog.js';
import { describeCommand } from './c4s/commands/describe.js';
import { listTagsCommand } from './c4s/commands/list-tags.js';
import { findReferencesCommand } from './c4s/commands/find-references.js';
import { getEntitiesCommand } from './c4s/commands/get-entities.js';
import { getFieldContentCommand } from './c4s/commands/get-field-content.js';
import { listEntitiesCommand } from './c4s/commands/list-entities.js';
import { listPagesCommand } from './c4s/commands/list-pages.js';
import { getPageOutlineCommand } from './c4s/commands/get-page-outline.js';
import { getSectionsCommand } from './c4s/commands/get-sections.js';
import { getPageCommand } from './c4s/commands/get-page.js';
import { searchPagesCommand } from './c4s/commands/search-pages.js';
import { searchEntitiesCommand } from './c4s/commands/search-entities.js';
import { checkConsistencyCommand } from './c4s/commands/check-consistency.js';
import { resolveIdentityCommand } from './c4s/commands/resolve-identity.js';
import { resolveCommand } from './c4s/commands/resolve.js';
import { agentCommand } from './c4s/commands/agent.js';
import { askCommand } from './c4s/commands/ask.js';
import { pluginsCommand } from './c4s/commands/plugins.js';
import { trustPluginsCommand } from './c4s/commands/trust-plugins.js';
import { createBriefCommand } from './c4s/commands/create-brief.js';
import { listBriefsCommand } from './c4s/commands/list-briefs.js';
import { getBriefCommand } from './c4s/commands/get-brief.js';
import { createPatchCommand } from './c4s/commands/create-patch.js';
import { markBriefImplementedCommand } from './c4s/commands/mark-brief-implemented.js';
import { createPlanCommand } from './c4s/commands/create-plan.js';
import { listSkillsCommand } from './c4s/commands/list-skills.js';
import { loadSkillFileCommand } from './c4s/commands/load-skill-file.js';
import { installSkillsCommand } from './c4s/commands/install-skills.js';
import { createPluginCommand } from './c4s/commands/create-plugin.js';
import { listWorkspacesCommand } from './c4s/commands/list-workspaces.js';
import { releaseListCommand } from './c4s/commands/release-list.js';
import { releaseShowCommand } from './c4s/commands/release-show.js';
import { releaseDiffCommand } from './c4s/commands/release-diff.js';

/**
 * L14 — CLI Commands: every command a module contributes to this bin, keyed
 * by name. The bin itself holds no domain logic — each contribution's
 * `handler` delegates to its owning module's core (see registry.ts).
 */
const COMMANDS: CliCommandContribution[] = [
  inlineMentionCommand,
  singleElementCommand,
  elementListCommand,
  taggedListCommand,
  taggedListMixedCommand,
  detailCommand,
  resolveCommand,
  catalogCommand,
  describeCommand,
  listTagsCommand,
  findReferencesCommand,
  // 0.2.6 — the CLI stops narrowing the core's operation set. Every one of the
  // fourteen M39 operations is reachable from here: these ten by their own name,
  // the other four through the tag commands and `catalog`/`describe` above,
  // which are aliases with a fixed `--view`.
  getEntitiesCommand,
  getFieldContentCommand,
  listEntitiesCommand,
  listPagesCommand,
  getPageOutlineCommand,
  getSectionsCommand,
  getPageCommand,
  searchPagesCommand,
  searchEntitiesCommand,
  checkConsistencyCommand,
  resolveIdentityCommand,
  // 2.1.11 — the release module's readers, the first commands a module beyond
  // the M39 core contributes; each renders its catalog row 1:1.
  releaseListCommand,
  releaseShowCommand,
  releaseDiffCommand,
  agentCommand,
  askCommand,
  pluginsCommand,
  trustPluginsCommand,
  createBriefCommand,
  listBriefsCommand,
  getBriefCommand,
  createPatchCommand,
  markBriefImplementedCommand,
  createPlanCommand,
  listSkillsCommand,
  loadSkillFileCommand,
  installSkillsCommand,
  createPluginCommand,
  listWorkspacesCommand,
];
const COMMANDS_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

const HELP = `Usage: c4s <command> [options]

Tag commands (1:1 with XML tag names):
  inline_mention --type <t> --slug <s>
  single_element --type <t> --slug <s>
  element_list --type <t> --slugs <s1,s2,...>
  tagged_list --type <t> --tags <t1,t2,...> [--tag-filter and|or]
  tagged_list_mixed --tags <t1,t2,...> [--tag-filter and|or]

Detail view (no XML counterpart):
  detail --type <t> --slug <s>

Graph reader (no XML counterpart):
  find-references --type <t> --slug <s> [--include-tag-matches] [--pages <dir>]
                                    exhaustive sweep — every hit, no paging (takes no
                                    --limit/--offset). Prints a JSON ARRAY; since 0.2.6
                                    each hit also carries rootId (and anchor, when the
                                    position falls inside an indexed section), so hits from
                                    two roots are no longer indistinguishable.
                                    --pages <dir> narrows the sweep to that one directory.

Utility:
  resolve <file.md> [--format inline|json]

Agent:
  agent "<msg>" --ct <chat|brief|patch|ask>   generic turn; verbose (all messages + reasoning)
  agent "<msg>" --ct brief --brief <path>     attach a turn to an existing brief
  agent "<msg>" --plan <planPath>             new executor thread on an existing plan, then turn on it
                                              (<planPath> relative to the plans dir, a leading
                                              .claude4spec/plans/ is stripped; --ct not needed,
                                              no --thread/--brief; unknown plan is NOT_FOUND)
  agent "<msg>" --ct brief [--from <r>] [--to <r>] [--roots <a,b>] [--suffix <s>]
                                              create the brief first, then turn on it
                                              (no window flag goes with --brief)
                                              provenance is the shape of the window:
                                                --from and --to: a closed window
                                                --to only:       from the beginning
                                                --from only:     to the current state
                                                neither:         latest release to the
                                                                 current state (the usual call)
                                                --roots needs --to
  agent "<msg>" --thread <id>                 continue any thread (--ct not needed)
  ask "<msg>"                                 read-only peer-consult shorthand (--ct=ask, terse)
  ask "<msg>" --thread <id>                   continue an existing ask thread
    --server <url>                                    override server discovery (remote / one-off --port)
                                                      accepted by every server-delegating command, not just these
    --effort <low|medium|high>                        reasoning level for the turn (default medium)
    --model <id>                                      model for the turn (default ${DEFAULT_MODEL});
                                                      selectable list: the peer's GET /api/chat/config

Discovery (through the server's operations — see "Server required" below):
  catalog                          counts + version + description + roleNoun + mcpToolsLine per type (smoke test)
  describe --type <t>              what a type IS: JSON Schemas, the value constraints a write
                                    must satisfy, selectableFields (the names --select takes),
                                    contentFields (fields no generic read carries, with the
                                    operation that issues them) and searchableFields. Call it
                                    before a read as well as before a write. 'views' left the
                                    payload in 0.2.22 with the view axis itself
  list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>]
                                    Since 0.2.6 this is the paginated { items, total, hasMore }
                                    (was { tags: [...] }), and per-type counts are OPT-IN via
                                    --with-counts — they are a product of tags by types.
                                    --co-occurring-with names the tags sharing entities with one
  list-entities --type <t> [--tags <t1,t2>] [--tag-filter and|or]
                [--sort createdAt|title|slug] [--dir asc|desc] [--mode items|count]
                                    rows are { slug, title }; only the default createdAt order
                                    has a write-stable offset window. Absorbed list-slugs,
                                    which is gone without an alias
  get-entities --type <t> --slugs <s1,s2> [--select <f1,f2>]
                                    several entities in one call. --select names top-level
                                    fields (slug/title/tags always come back); omit it for
                                    everything except content-bearing fields, --select= for the
                                    identity skeleton alone
  get-field-content --type <t> --slug <s> --field <f>
                                    the content of one content-bearing field — the only way to
                                    read one, since no generic read carries it
  search-entities --type <t> (--query <q> | --regex <r>) [--fields <f1,f2>]
                  [--mode count|map|hits]
                                    --type is required, and exactly one of --query/--regex; a hit is
                                    an ENTITY, { slug, title, matchCount }, and --mode hits adds
                                    hunks[] + omittedChars. There is no --context and no --select:
                                    a fragment is evidence, not a projection. Unlike search-pages a
                                    pattern may cross a line. The output always declares
                                    searchedFields
  resolve-identity --query <q> [--types <t1,t2>] [--limit <n>]
                                    the only cross-type command: "what is this called?"
  check-consistency [--severity error|warning] [--rule <r>] [--limit <n>]
                                    the 16 rules: broken references (one list, by reason),
                                    unanchored headings, code blocks, drift between disk and index

Pages and sections (a page is (rootId, path); an anchor is globally unique):
  list-pages --root-id <id> [--prefix <p>] [--sort path|modified]
  get-page-outline --root-id <id> --path <p>
                                    the page's headings as a TREE in document order — a table of
                                    contents; each node carries its anchor, level and body size
  get-sections --anchors <a,b,c> [--include-subtree]
                                    bodies of several sections in ONE call, one item PER SECTION:
                                    the anchors in input order and, with --include-subtree, each
                                    one's subtree behind it in document order; an unknown anchor
                                    errors inside its own item and the exit code stays 0
  get-page --root-id <id> --path <p>
                                    the page as sections keyed by anchor, with frontmatter and
                                    preamble as fields, XML tags untouched; --format text
                                    assembles markdown; no line window — a cut read resumes
                                    through get-page-outline + get-sections
  search-pages (--query <q> | --regex <r>) [--root-id <id>] [--mode count|map|hits]
               [--path-include <re>] [--path-exclude <re>] [--anchors <a1,a2>] [--context <n>]
                                    hits carry an anchor

Pagination (every list command above):
  --limit <n> / --offset <m>        output carries total + hasMore under a stable sort.
                                    Not accepted by catalog, describe, get-entities, get-sections
                                    (the last two are fetch-by-key: the caller names the rows,
                                    so the valve is the input-length cap plus the response budget),
                                    nor by resolve-identity / check-consistency, whose output is
                                    bounded by its own nature (a top-N ranking; a counted report).

Releases (M17 — server-delegating; each command renders its operation 1:1 and prints the
same payload the MCP tool returns, through GET /api/releases…?view=operation):
  release-list [--limit N] [--offset N]
                                    { releases, total }, newest first
  release-show --release <name> [--include pages,entities] [--entity-types <t1,t2>]
               [--limit N] [--offset N]
                                    what the release holds: entity slugs and page paths
  release-diff --from <name|initial|null> --to <name|current>
               [--include …] [--entity-types …] [--slugs …] [--roots …] [--paths <p> …]
               [--summary-only] [--section-offset N] [--section-limit N] [--limit N] [--offset N]
                                    what changed between two releases, or a release and the
                                    current state; --slugs (with exactly one --entity-types)
                                    narrows to single entities, --paths repeats
                                    Flags are the operation's parameters in kebab-case
                                    (fromReleaseName → --from, toReleaseName → --to,
                                    releaseName → --release). Lists are comma-separated and sent
                                    as written — the server judges them. The window is the
                                    operation's: without --limit at most 5 entries in entities[]
                                    and in pages[]. A cut answer carries truncated +
                                    truncationHint, the hint already in flag form. An unknown or
                                    missing flag is INVALID_ARGUMENT before anything is sent.

Plugins (M33 — server-delegating: reports the SERVER host's loader, not a second one):
  plugins list                     pool packages: tier, version, contributed types (exit 0)
  plugins status                   per-package load state + reason + hostApiVersion + overlay trust (exit 0)
  plugins doctor                   migration path per incompatible package (exit HOST_API_INCOMPATIBLE if any)
  trust-plugins --cwd <dir> [--port <n>] [--mode dev|prod] <true|false>
                                    server-free: sets trustProjectPlugins for a project directly in
                                    workspaces.json, creating the project record if absent — for
                                    non-interactive Docker plugin smoke-testing (see DOCKER.md)

Brief/patch (M11 — server-delegating, like every read above):
  create-brief --body-file <f> [--from <release>] [--suffix <slug>]
                                    mints a brief whose body you already wrote; no agent turn
                                    runs. The window always ends at the current state, so --to
                                    and --roots are refused. Prints briefPath + hash
  list-briefs [--limit N] [--offset M] [--status implemented|pending]
  get-brief <brief-path> [--range <start>-<end>]
                                    <brief-path> relative to the briefs root (.claude4spec/briefs); --range is a 1-based
                                    inclusive line window, sent as written — the server judges it. A cut answer carries
                                    truncated + truncationHint, the hint a runnable get-brief call with --range
  create-patch --brief <brief-path> --desc <s> [--kind drift|missing|incorrect|clarification]
             [--body-file <f>]      body from --body-file or stdin; the SERVER writes the
                                    file under the patches root and mints its slug
  mark-brief-implemented <brief-path> [--project <id>]
                                     wraps PATCH /api/artifacts/brief/:path/frontmatter
                                     ('implemented' is the only mutable frontmatter key)

Plans (M10 — server-delegating; the one plan command, the rest are agent/UI operations):
  create-plan --title <t> --body-file <f>
                                    founds a plan (slug = slugify(title), immutable) with its
                                    first version and a top-level carrier thread; no agent turn
                                    runs. A taken slug is PLAN_ALREADY_EXISTS (exit 24), never
                                    suffixed. Prints { planPath, hash, threads: [<carrier threadId>] }
                                    — continue with agent --thread <threads[0]> or --plan <planPath>

Skills registry (M37 — server-delegating; the project's skills, served from memory, never a disk path):
  list-skills [--context-type chat|brief|patch|ask]
                                    { listing: [{ slug, description }], writingStyle } — the
                                    whole registry, or the set that conversation type is offered.
                                    writingStyle is the ACTIVE style, reported beside the listing
                                    (never a row of it); a bad value is INVALID_ARGUMENT, exit 4
  load-skill-file <slug> [--file <relPath>]
                                    no --file: opens the skill (SKILL.md body + manifest of the
                                    package files); --file: one package file. --format text prints
                                    the content alone. Unknown slug/file → exit 25, binary → exit 26

Skills (M22 — filesystem-only, no server; on-demand, no bootstrap side-effect):
  install-skills [--project <id>] [--server <url> --project <id>] [--dir <path>] [--skills <s1,s2>]
                  writes <dir|.claude/skills>/<name>/SKILL.md under process cwd (the
                  CODE repo), not the --project spec repo; --skills default: all three

Workspace registry (M31 — mode \`registry-read\`: no server, no project, no db-slot):
  list-workspaces  reads ~/.claude4spec/workspaces.json and prints one row per workspace
                   (name, mode, defaultPort, projectCount, lastOpened), most recently
                   opened first; never-opened workspaces last. Takes no arguments, and
                   --project/--workspace do not narrow it. No registry file → [] and
                   exit 0; an unreadable one → REGISTRY_READ_FAILED, exit 22.

Plugin scaffolding (M38 — mode \`scaffold\`: no project, no workspace, no server):
  create-plugin <target-dir> [--template <git-url>] [--branch <name>] [--force] [--no-install]
                  creates <target-dir> under the current working directory and fills it from
                  the scaffold repo (default: github.com/InHarness/c4s-plugin-scaffold), git
                  history NOT carried over, then runs npm install unless --no-install

Server required — for every step:
  Since 0.2.13 the \`c4s\` process holds no database handle and reads no
  specification files. It resolves an ADDRESS locally (.claude4spec/config.json,
  ~/.claude4spec/workspaces.json, defaultPort) and every command above delegates
  to \`npx @inharness-ai/claude4spec\`. Exceptions: install-skills, trust-plugins,
  create-plugin, list-workspaces. Those four address the machine rather than a
  specification — a code repo's skills directory, the workspace registry (written
  by one, read by the other), a new directory — so there is no specification for
  them to ask a server about. Note the boundary is "navigation vs registry
  administration", not "read vs write": reading the registry skips the server too.
  No server → SERVER_NOT_RUNNING, exit 8. \`c4s\` never starts one for you.

Global flags:
  --project <id>          the project's registry id (default: walk up from cwd to the nearest project)
  --workspace <name>      pick the workspace when the id / directory is registered in more than one
  --server <url>          server address override (remote server or non-default port); requires --project <id>
  --format json|text      output format (default: json; resolve default: inline)
  --compact               minified JSON (for pipelines)
  --sort-keys             deterministic key order in JSON
  --version               print c4s version
  --help                  show this help
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`c4s ${readPackageVersion()}\n`);
    return;
  }

  const args = parseArgs(argv);
  if (!args.command) {
    throw new CliError('UNKNOWN_COMMAND', 'no command given', 'run `c4s --help`');
  }

  const command = COMMANDS_BY_NAME.get(args.command);
  if (!command) {
    throw new CliError('UNKNOWN_COMMAND', `unknown command '${args.command}'`, 'run `c4s --help`');
  }
  // 2.1.23 — unreadable argv is refused here, for every command, before it runs.
  // 2.1.53 — and so is a flag the command does not have.
  assertKnownFlags(args, command);
  assertFlagValues(args);
  return command.handler(args);
}


main().catch((err) => {
  if (err instanceof CliError) {
    writeError(err);
    process.exit(codeToExit(err.code));
  }
  // A core error reaches the user as itself, with its own code and its repair
  // path — see `cliErrorFromDiscovery`.
  const mapped = cliErrorFromDiscovery(err);
  if (mapped) {
    writeError(mapped);
    process.exit(codeToExit(mapped.code));
  }
  const message = err instanceof Error ? err.message : String(err);
  writeError(new CliError('UNKNOWN_COMMAND', message));
  process.exit(1);
});

