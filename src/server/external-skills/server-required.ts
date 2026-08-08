/**
 * 0.2.13 item 29 — the "Server required — for every step" invariant, written
 * once and rendered into all three shipped skills.
 *
 * ## Why it exists
 *
 * Until 0.2.12 every one of these skills drew the same line for its reader:
 * some `c4s` commands need a running server, and some — `list-briefs`,
 * `read-brief`, `file-patch`, `resolve`, the `list-*` readers — do not, because
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
 * The generated copy under `.claude4spec/skills/` is refreshed from here on
 * server start. The copy under a code repo's `.claude/skills/` is hand-editable
 * and deliberately NEVER overwritten, so this text landing here does not reach
 * an existing installation — see the release-contract test, which holds this
 * repo's own copies to the same invariant.
 */
export const SERVER_REQUIRED_BLOCK = `## Server required — for every step

Every \`c4s\` command in this skill talks to a running \`npx @inharness-ai/claude4spec\` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.

**\`SERVER_NOT_RUNNING\` (exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.

Two neighbouring codes mean something else, and starting a server will not fix either: \`SERVER_NOT_RECOGNIZED\` (something is listening, but it is not claude4spec) and \`PROJECT_NOT_IN_WORKSPACE\` (the server is fine; this project is not registered in the workspace you named). Report those as they are.`;
