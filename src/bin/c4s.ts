#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from './c4s/package-version.js';
import { parseArgs } from './c4s/args.js';
import { CliError, cliErrorFromDiscovery } from './c4s/errors.js';
import { writeError } from './c4s/output.js';
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
import { listBriefsCommand } from './c4s/commands/list-briefs.js';
import { readBriefCommand } from './c4s/commands/read-brief.js';
import { filePatchCommand } from './c4s/commands/file-patch.js';
import { markBriefImplementedCommand } from './c4s/commands/mark-brief-implemented.js';
import { installSkillsCommand } from './c4s/commands/install-skills.js';
import { createPluginCommand } from './c4s/commands/create-plugin.js';

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
  agentCommand,
  askCommand,
  pluginsCommand,
  trustPluginsCommand,
  listBriefsCommand,
  readBriefCommand,
  filePatchCommand,
  markBriefImplementedCommand,
  installSkillsCommand,
  createPluginCommand,
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
    --model <fable-5|sonnet-5|opus-5|haiku-4.5>       model for the turn (default opus-5)

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
  search-entities --type <t> --query <q> [--fields <f1,f2>] [--mode hits|count]
                                    --type is required; hits are { slug, title, score } and the
                                    output always declares searchedFields
  resolve-identity --query <q> [--types <t1,t2>] [--limit <n>]
                                    the only cross-type command: "what is this called?"
  check-consistency [--severity error|warning] [--rule <r>] [--limit <n>]
                                    broken references, drift between disk and index

Pages and sections (a page is (rootId, path); an anchor is globally unique):
  list-pages --root-id <id> [--prefix <p>] [--sort path|modified]
  get-page-outline --root-id <id> --path <p>
                                    the page's headings as a TREE in document order — a table of
                                    contents; each node carries its anchor, level and body size
  get-sections --anchors <a,b,c> [--include-subtree]
                                    bodies of several sections in ONE call; an unknown anchor
                                    errors inside its own item and the exit code stays 0
  get-page --root-id <id> --path <p> [--range <from:to>]
                                    the page as authored, XML tags untouched; --range is
                                    accepted only on a root without a section index
  search-pages (--query <q> | --regex <r>) [--root-id <id>] [--mode count|map|hits]
               [--path-include <re>] [--path-exclude <re>] [--anchors <a1,a2>] [--context <n>]
                                    hits on an indexed root carry an anchor

Pagination (every list command above):
  --limit <n> / --offset <m>        output carries total + hasMore under a stable sort.
                                    Not accepted by catalog, describe, get-entities, get-sections
                                    (the last two are fetch-by-key: the caller names the rows,
                                    so the valve is the input-length cap plus the response budget),
                                    nor by resolve-identity / check-consistency, whose output is
                                    bounded by its own nature (a top-N ranking; a counted report).

Plugins (M33 — server-delegating: reports the SERVER host's loader, not a second one):
  plugins list                     pool packages: tier, version, contributed types (exit 0)
  plugins status                   per-package load state + reason + hostApiVersion + overlay trust (exit 0)
  plugins doctor                   migration path per incompatible package (exit HOST_API_INCOMPATIBLE if any)
  trust-plugins --cwd <dir> [--port <n>] [--mode dev|prod] <true|false>
                                    server-free: sets trustProjectPlugins for a project directly in
                                    workspaces.json, creating the project record if absent — for
                                    non-interactive Docker plugin smoke-testing (see DOCKER.md)

Brief/patch (M11 — server-delegating, like every read above):
  list-briefs [--limit N] [--offset M] [--status implemented|pending]
  read-brief <brief-path> [--range <from>:<to>]
                                    <brief-path> relative to briefsDir; --range is a 1-based inclusive line window
  file-patch --brief <brief-path> --desc <s> [--kind drift|missing|incorrect|clarification]
             [--body-file <f>]      body from --body-file or stdin; the SERVER writes the
                                    file under patchesDir and mints its slug
  mark-brief-implemented <brief-path> --project <slug> --workspace <name>
                                     wraps PATCH /api/artifacts/brief/:path/frontmatter
                                     ('implemented' is the only mutable frontmatter key)

Skills (M22 — filesystem-only, no server; on-demand, no bootstrap side-effect):
  install-skills [--project <slug>] [--dir <path>] [--skills <s1,s2>]
                  writes <dir|.claude/skills>/<name>/SKILL.md under process cwd (the
                  CODE repo), not the --project spec repo; --skills default: all three

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
  create-plugin. Those three address the machine rather than a specification —
  a code repo's skills directory, the workspace registry, a new directory — so
  there is no specification for them to ask a server about.
  No server → SERVER_NOT_RUNNING, exit 8. \`c4s\` never starts one for you.

Global flags:
  --project <path|name>  override project (path tried first, else matched by registered name)
  --workspace <name>      pick the workspace when the project is registered in more than one
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

function codeToExit(code: string): number {
  switch (code) {
    case 'PROJECT_NOT_FOUND':
      return 2;
    case 'ENTITY_NOT_FOUND':
    // 0.2.6 — an anchor that names nothing is the same outcome for a script as a
    // slug that names nothing.
    //
    // 0.2.59 — and this row is now UNREACHABLE for sections. `SECTION_NOT_FOUND`
    // had two emitters; the call-level one went with `list-sections --by anchor`,
    // and the survivor is per-item inside a `get-sections` batch, where the exit
    // code stays 0 because the other sections in that call are real answers. The
    // case is kept because the code still exists in the catalog, not because a
    // section command can still reach it.
    case 'SECTION_NOT_FOUND':
      return 3;
    case 'INVALID_TYPE':
    case 'INVALID_ARGS':
    /**
     * 0.2.13 — a `--root-id` that names nothing is the same CLASS of mistake as
     * a bad `--type`: the caller asked for something the contract does not
     * offer. It reached this table only after the read commands became
     * server-delegating (the core used to answer `INVALID_ARGUMENT`, already in
     * this group); unmapped, it fell to the `default: 1` bucket that also holds
     * UNKNOWN_COMMAND, so a wrapper branching on exit 4 for "you typed the flags
     * wrong" read a typo'd root id as an infrastructure failure.
     */
    case 'ROOT_NOT_FOUND':
    // M39 — the core's refusal shares the "you asked for something the contract
    // does not allow" exit, since a caller scripting c4s branches on the class
    // of failure and these are the same class.
    case 'INVALID_ARGUMENT':
    /**
     * 0.2.13 — `VALIDATION` joins the same class, because the migration to
     * `server-delegating` started routing CLI argument refusals through it.
     *
     * `c4s file-patch --brief ../foo.md` throws `BriefFsError('INVALID_ARGS')`
     * in the core writer; `routes/errors.ts` deliberately renames that to
     * `VALIDATION` on the way out ("`INVALID_ARGS` is the core's name for what
     * REST calls `VALIDATION`"), and the CLI propagates the server's code
     * verbatim rather than translating it back. Without this case the same
     * refusal that exited 4 before the migration exits 1 — the generic bucket
     * that also holds `PROJECT_NOT_IN_WORKSPACE` and agent failures, so a
     * wrapper branching on `[ $? -eq 4 ]` reads a typo as an infrastructure
     * problem. Renaming it back at the transport was the alternative, and that
     * is exactly the fourth error vocabulary this release exists to remove.
     */
    case 'VALIDATION':
      return 4;
    case 'FILE_NOT_FOUND':
    // M39 — a page named by (rootId, path) that does not exist is the same
    // outcome for a script as a file that does not exist.
    case 'PAGE_NOT_FOUND':
      return 5;
    case 'SCHEMA_OUT_OF_DATE':
      return 6;
    case 'AMBIGUOUS_WORKSPACE':
      return 7;
    /**
     * 0.2.13 item 24 — exit 8 changed hands.
     *
     * It used to be `INDEX_NOT_MATERIALIZED`: this process opened the db slot,
     * so "the index has not been built" was a condition it could observe and the
     * caller could act on. It no longer opens one, so it cannot observe that at
     * all — and the condition an external caller now hits in its place is that
     * nothing is listening. Reusing the number rather than adding one is
     * deliberate: a script's `if [ $? -eq 8 ]` branch means "the specification is
     * not readable yet, deal with the environment", and that is still exactly
     * what it means. `INDEX_NOT_MATERIALIZED` survives only on internal paths.
     */
    case 'SERVER_NOT_RUNNING':
      return 8;
    case 'HOST_API_INCOMPATIBLE':
      return 9;
    case 'PROJECT_SLUG_NOT_FOUND':
      return 10;
    case 'AMBIGUOUS_PROJECT':
      return 11;
    // 0.2.6 — the core's two ambiguity codes. A caller that has to disambiguate
    // must be able to see it from the exit status, the way it already can for
    // the two workspace-level ambiguities above.
    case 'AMBIGUOUS_ENTITY':
      return 20;
    case 'AMBIGUOUS_PAGE':
      return 21;
    case 'BRIEF_NOT_FOUND':
      return 12;
    case 'PATCH_WRITE_FAILED':
      return 13;
    case 'SKILLS_WRITE_FAILED':
      return 14;
    // M38 `create-plugin` — INSTALL_FAILED is non-zero too, even though it is
    // the one code that leaves the scaffolded files on disk.
    case 'INVALID_TARGET':
      return 15;
    case 'TARGET_EXISTS':
      return 16;
    case 'TEMPLATE_FETCH_FAILED':
      return 17;
    case 'INSTALL_FAILED':
      return 18;
    case 'SCAFFOLD_WRITE_FAILED':
      return 19;
    // PROJECT_NOT_IN_WORKSPACE → 1 (ask-group, like other server-side ask errors)
    default:
      return 1;
  }
}
