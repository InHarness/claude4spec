#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './c4s/args.js';
import { CliError } from './c4s/errors.js';
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
import { listSlugsCommand } from './c4s/commands/list-slugs.js';
import { findReferencesCommand } from './c4s/commands/find-references.js';
import { resolveCommand } from './c4s/commands/resolve.js';
import { agentCommand } from './c4s/commands/agent.js';
import { askCommand } from './c4s/commands/ask.js';
import { pluginsCommand } from './c4s/commands/plugins.js';
import { listBriefsCommand } from './c4s/commands/list-briefs.js';
import { readBriefCommand } from './c4s/commands/read-brief.js';
import { filePatchCommand } from './c4s/commands/file-patch.js';
import { markBriefImplementedCommand } from './c4s/commands/mark-brief-implemented.js';
import { installSkillsCommand } from './c4s/commands/install-skills.js';

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
  listSlugsCommand,
  findReferencesCommand,
  agentCommand,
  askCommand,
  pluginsCommand,
  listBriefsCommand,
  readBriefCommand,
  filePatchCommand,
  markBriefImplementedCommand,
  installSkillsCommand,
];
const COMMANDS_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

const HELP = `Usage: c4s <command> [options]

Tag commands (1:1 with XML tag names):
  inline_mention --type <t> --slug <s>
  single_element --type <t> --slug <s>
  element_list --type <t> --slugs <s1,s2,...>
  tagged_list --type <t> --tags <t1,t2,...> [--filter and|or]
  tagged_list_mixed --tags <t1,t2,...> [--filter and|or]

Detail view (no XML counterpart):
  detail --type <t> --slug <s>

Graph reader (no XML counterpart):
  find-references --type <t> --slug <s> [--include-tag-matches]

Utility:
  resolve <file.md> [--format inline|json]

Agent (requires a running \`npx @inharness-ai/claude4spec\` server):
  agent "<msg>" --ct <chat|brief|patch|ask>   generic turn; verbose (all messages + reasoning)
  agent "<msg>" --ct brief --brief <path>
  agent "<msg>" --thread <id>                 continue any thread (--ct not needed)
  ask "<msg>"                                 read-only peer-consult shorthand (--ct=ask, terse)
  ask "<msg>" --thread <id>                   continue an existing ask thread
    --server <url>                                    override server discovery (remote / one-off --port)
    --effort <low|medium|high>                        reasoning level for the turn (default medium)
    --model <fable-5|sonnet-4.6|opus-4.8|haiku-4.5>    model for the turn (default opus-4.8)

Discovery:
  catalog                          counts + version + description + roleNoun + mcpToolsLine per type (smoke test)
  describe --type <t> [--view <v>] JSON Schema per view for one type (on-demand)
  list-tags
  list-slugs --type <t>

Plugins (M33 — reads loader state, no running server):
  plugins list                     pool packages: tier, version, contributed types (exit 0)
  plugins status                   per-package load state + reason + hostApiVersion + overlay trust (exit 0)
  plugins doctor                   migration path per incompatible package (exit HOST_API_INCOMPATIBLE if any)

Brief/patch (M11 — filesystem-only, no server, no sqlite; works under INDEX_NOT_MATERIALIZED):
  list-briefs [--limit N] [--offset M] [--status implemented|pending]
  read-brief <brief-path>           <brief-path> relative to briefsDir
  file-patch --brief <brief-path> --desc <s> [--kind drift|missing|incorrect|clarification]
             [--body-file <f>]      body from --body-file or stdin; writes to patchesDir
  mark-brief-implemented <brief-path> --project <slug> --workspace <name>
                                     server-delegating (unlike the three above) — wraps
                                     PATCH /api/briefs/:path/frontmatter; requires a running server

Skills (M22 — filesystem-only, no server, no sqlite; on-demand, no bootstrap side-effect):
  install-skills [--project <slug>] [--dir <path>] [--skills <s1,s2>]
                  writes <dir|.claude/skills>/<name>/SKILL.md under process cwd (the
                  CODE repo), not the --project spec repo; --skills default: all three

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

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '..', 'package.json'),
      path.resolve(here, '..', '..', 'package.json'),
    ];
    for (const pkgPath of candidates) {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    /* ignore */
  }
  return 'unknown';
}

main().catch((err) => {
  if (err instanceof CliError) {
    writeError(err);
    process.exit(codeToExit(err.code));
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
      return 3;
    case 'INVALID_TYPE':
    case 'INVALID_VIEW':
    case 'INVALID_ARGS':
      return 4;
    case 'FILE_NOT_FOUND':
      return 5;
    case 'SCHEMA_OUT_OF_DATE':
      return 6;
    case 'AMBIGUOUS_WORKSPACE':
      return 7;
    case 'INDEX_NOT_MATERIALIZED':
      return 8;
    case 'HOST_API_INCOMPATIBLE':
      return 9;
    case 'PROJECT_SLUG_NOT_FOUND':
      return 10;
    case 'AMBIGUOUS_PROJECT':
      return 11;
    case 'BRIEF_NOT_FOUND':
      return 12;
    case 'PATCH_WRITE_FAILED':
      return 13;
    case 'SKILLS_WRITE_FAILED':
      return 14;
    // PROJECT_NOT_IN_WORKSPACE → 1 (ask-group, like other server-side ask errors)
    default:
      return 1;
  }
}
