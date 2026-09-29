import type { ExternalSkillContext } from './types.js';

/**
 * 0.2.13 item 29 — the "Server required — for every step" invariant, written
 * once and rendered into all three shipped skills.
 *
 * ## Why it exists
 *
 * Until 0.2.12 every one of these skills drew the same line for its reader:
 * some `c4s` commands need a running server, and some — `list-briefs`,
 * `get-brief`, `create-patch`, `resolve`, the `list-*` readers — do not, because
 * they read the specification off disk themselves. Each skill phrased it
 * differently ("filesystem-scoped", "do not need a server", "unlike the
 * read-only commands above"), and each phrasing was load-bearing: it told the
 * agent which failures were worth stopping for.
 *
 * Item 22 deleted that line. The `c4s` bin no longer opens the database or
 * reads a specification file, so there is no server-free subset left to name.
 * A skill that still names one is not merely out of date — it instructs the
 * agent to route around a `SERVER_NOT_RUNNING` it now cannot route around, and
 * the way an agent routes around a CLI it believes should have worked is by
 * reading the spec repo's files by hand, which every one of these skills
 * forbids in its opening paragraph.
 *
 * ## Why one constant rather than three passages
 *
 * The three skills previously said this in three wordings and drifted apart in
 * exactly the way the release's operation catalog exists to stop. One
 * declaration, three renderings — same shape, one scale down.
 *
 * Skills are generated on demand (Settings → ZIP, or `c4s install-skills`);
 * nothing refreshes them on server start. The copy under a code repo's
 * `.claude/skills/` is hand-editable and deliberately NEVER overwritten, so this
 * text landing here does not reach an existing installation — see the
 * release-contract test, which holds this repo's own copies to the same
 * invariant.
 */
export const SERVER_REQUIRED_BLOCK = `## Server required — for every step

Every \`c4s\` command in this skill talks to a running \`npx @inharness-ai/claude4spec\` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.

**\`SERVER_NOT_RUNNING\` (exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.

Two neighbouring codes mean something else, and starting a server will not fix either: \`SERVER_NOT_RECOGNIZED\` (something is listening, but it is not claude4spec) and \`PROJECT_NOT_IN_WORKSPACE\` (the server is fine, but it does not serve this skill's project — see "Stale address" below). Report those as they are.`;

/**
 * 2.1.0 (M22) — the address every generated skill bakes into EVERY `c4s`
 * command: `--server <publicUrl> --project <id>`. Quoted so a command copied
 * verbatim stays one argv word per value. `--workspace` is not passed — the
 * server implies its workspace.
 */
export function skillIdentity(ctx: ExternalSkillContext): string {
  return `--server '${ctx.publicUrl}' --project '${ctx.id}'`;
}

/**
 * 2.1.0 (M22) — identical hint in all three skills: PROJECT_NOT_IN_WORKSPACE
 * means the baked-in address is stale (the server at `publicUrl` does not serve
 * project `id`); the only repair is regenerating the skill.
 */
export function staleAddressBlock(ctx: ExternalSkillContext): string {
  return `## Stale address — \`PROJECT_NOT_IN_WORKSPACE\`

\`PROJECT_NOT_IN_WORKSPACE\` means the server at \`${ctx.publicUrl}\` does not serve the project \`${ctx.id}\` — the address baked into this skill is stale. **Stop and ask the user to regenerate this skill** (Settings → External Integrations, or \`c4s install-skills\`). Do not guess another \`--project\` or \`--server\` value.`;
}
