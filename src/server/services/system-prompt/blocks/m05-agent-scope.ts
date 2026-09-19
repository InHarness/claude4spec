import path from 'node:path';
import type { Root } from '../../../../shared/types.js';
import { hasServer } from '../glue.js';
import type { McpInventoryEntry, PromptBlock } from '../types.js';

/* M05 — Chat & Agent: where the agent may reach, and whether it has built-in
 * filesystem tools at all. */

/**
 * 0.1.90: soft filesystem-scope directive (config.agent.allowedPaths/disallowedPaths).
 * The HARD boundary is enforced natively by the agent-adapters sandbox; this block is the
 * directional guide and the only layer for adapters without a sandbox. ALLOWED lists `cwd`,
 * every root dir (only when outside `cwd`), then the configured `allowedPaths`; DISALLOWED
 * lists the configured `disallowedPaths` (precedence). Empty allowed/disallowed lists are
 * omitted from their line.
 * 0.1.130: `artifactDenyDirs` (always non-empty) adds an unconditional ALWAYS-DISALLOWED
 * line for the C4S artifact dirs — hard-locked at the sandbox level, editable only via the
 * MCP tools (plan-tools/brief-tools/entity-tools/release-tools). This makes the block always
 * present; the caller now gates only on `agentPathScope` being set (still non-brief only).
 */
/**
 * 0.2.50 — the block no longer names a fixed list of MCP servers.
 *
 * It used to close with "use plan-tools / brief-tools / entity-tools /
 * release-tools instead, and page-tools for the pages", which is true of a chat
 * thread and false of a brief one: the `brief` profile mounts `release-tools`
 * alone out of the plugin pool and no plan-tools, so four of the five named
 * servers are absent from its `tools/list`. (The brief composition does not
 * carry this block today — see `compositions/brief.ts` — but a block must not
 * be true only of the compositions that happen to use it.) Pointing at
 * `<tooling>`, which is itself derived from the mount, cannot be wrong in any
 * frame; the page paragraph is emitted only
 * where the page tools are actually mounted, for the same reason.
 */
function buildAgentPathScope(
  scope: {
    allowedPaths: string[];
    disallowedPaths: string[];
    artifactDenyDirs: string[];
    pageRootDirs: string[];
  },
  cwd: string,
  roots: Root[],
  inventory: readonly McpInventoryEntry[],
): string {
  // Root dirs may be relative (e.g. '.' or 'pages') — resolve against cwd before the
  // inside check, mirroring the M05 resolver, so a nested root dir is correctly omitted.
  const rootExtras = [
    ...new Set(
      roots.map((r) => path.resolve(cwd, r.dir)).filter((rootAbs) => !isInside(cwd, rootAbs)),
    ),
  ];
  const allowed = [cwd, ...rootExtras, ...scope.allowedPaths];
  const lines = [
    `<agent_path_scope>`,
    `You are scoped to this project's filesystem. The hard boundary is enforced natively by the agent sandbox; this block is the directional guide.`,
    `  ALLOWED (you may read/write here): ${allowed.join(', ')}`,
  ];
  if (scope.disallowedPaths.length) {
    lines.push(`  DISALLOWED (never read/write here, takes precedence): ${scope.disallowedPaths.join(', ')}`);
  }
  // 0.1.130: unconditional hard-lock on the C4S artifact dirs. Absolute paths; edit ONLY
  // via the dedicated MCP tools — the built-in FS tools are blocked at the sandbox level.
  lines.push(
    `  ALWAYS DISALLOWED — C4S artifact dirs (edit ONLY via MCP tools, never with built-in Read/Write/Edit/Bash): ${scope.artifactDenyDirs.join(', ')}`,
  );
  /**
   * 0.2.13 item 28. Stated as its own line rather than folded into the one above, because
   * the rule is genuinely different: an artifact dir is closed to reads AND writes, a page
   * root is READABLE and closed to writes only. Collapsing the two would tell the agent to
   * stop grepping pages, which is the opposite of what `<discovery_and_impact>` asks of it
   * further down.
   */
  if (scope.pageRootDirs.length && hasServer(inventory, 'page-tools')) {
    lines.push(
      `  READ-ONLY to built-in tools — page roots (${scope.pageRootDirs.join(', ')}): read and grep them freely, but NEVER write one with Write/Edit/Bash. ` +
        `A page is written with create_page / update_page / delete_page, and a batch of sections with update_sections. ` +
        `That is not a style preference: those operations label the write for the file watcher and honour expectedHash, so the page is re-indexed and conflict-checked before you are told it succeeded. A built-in write skips both.`,
    );
  }
  lines.push(
    `Stay within ALLOWED minus DISALLOWED. Do not touch files outside this scope (e.g. other projects, source code next to the spec). If a task seems to require an out-of-scope path, say so instead of attempting it. Never hand-edit the C4S artifact dirs — write them through the MCP servers listed in <tooling>, which is the set actually mounted for this turn.`,
    `</agent_path_scope>`,
  );
  return lines.join('\n');
}

/**
 * 0.2.53 — the built-in filesystem/shell posture, stated to the model in BOTH
 * states, for `chat` / `patch` / `ask`. There is no omitted case: a block that
 * appears only when something is switched off teaches the model to read its
 * absence as permission, and the `enabled="true"` body has its own thing to say.
 *
 * The `brief` frame does not carry it — that frame states its posture inside its
 * own `<interaction_context type="brief">` block instead.
 *
 * `enabled` is the NEGATION of `agent.disableDirectFilesystemAccess`: the config
 * field names what is taken away, the prompt names what the model has.
 *
 * The disabled body names the three capabilities that genuinely stop working, so
 * a model asked for one of them says which setting is in the way instead of
 * reaching for a tool that is not in its catalog and improvising after it fails.
 */
function buildAgentFilesystemAccess(access: { enabled: boolean }): string {
  if (!access.enabled) {
    return [
      `<agent_filesystem_access enabled="false">`,
      `This project runs you WITHOUT built-in filesystem or shell tools. Read, Grep, Glob, Edit, Write, NotebookEdit, Bash and Skill are not in your catalog — they are absent, not merely discouraged, so there is nothing to fall back to and no point proposing one.`,
      `The specification is fully reachable anyway, through the MCP servers listed in <tooling>: read with get_page / get_sections / list_pages / search_pages, write with update_sections / update_page. That is the point of the posture, not a workaround for it — a core write carries expectedHash, captures a version and injects anchors, and a built-in write skipped all three.`,
      `Three things genuinely do not work while this is on. If you are asked for one, say which setting is in the way rather than attempting it:`,
      `  - git recovery ("Fix it with Agent") — it drives git through Bash, and no MCP operation replaces it;`,
      `  - the c4s CLI — it is a shell program; only its \`ask\` survives, and only where this turn mounted the server that exposes it — check <tooling>;`,
      `  - scaffolding a new writing style — it writes a skill package under .claude/skills/, which no C4S operation owns.`,
      `The user can turn all three back on by unchecking \"Block direct file access\" in Settings → Agent. Say that plainly; do not try to work around it.`,
      `One thing that DOES still work, and it is about you rather than the user: the read-only explorer subagents are mounted here as usual. They never held the file built-ins to begin with — they read the specification through the same MCP operations you do — so this posture takes nothing away from them, and delegating a wide sweep is still the way to keep the bulk of what you read out of your own context.`,
      `</agent_filesystem_access>`,
    ].join('\n');
  }
  return [
    `<agent_filesystem_access enabled="true">`,
    `This project leaves the built-in filesystem and shell tools available to you, so work outside the specification (implementation code, git, the c4s CLI, scaffolding a writing style) is possible here.`,
    `That does NOT make them an alternative route into the specification. Pages, entities, plans and briefs are still read and written ONLY through the MCP servers in <tooling>: a built-in write bypasses expectedHash, version capture and anchor injection, so it corrupts the consistency contract while reporting success. Reach for Read/Edit/Write only for files that are not C4S artifacts.`,
    `</agent_filesystem_access>`,
  ].join('\n');
}

/** True when `child` is the same as or nested under `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export const M05_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    // A path scope is a contract about where you may reach, fixed for the
    // thread, not a fact about this turn.
    name: 'agent_path_scope',
    render: (c) =>
      c.agentPathScope ? buildAgentPathScope(c.agentPathScope, c.cwd, c.roots, c.mcpInventory) : null,
  },
  {
    // It answers the question the path scope raises: that block says WHERE the
    // built-in tools may reach, this one says WHETHER there are any.
    // Unconditional — `render` never returns null, in either state of the flag.
    name: 'agent_filesystem_access',
    render: (c) => buildAgentFilesystemAccess(c.agentFilesystemAccess ?? { enabled: false }),
  },
];
