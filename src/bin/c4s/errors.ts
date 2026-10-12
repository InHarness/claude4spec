import { isDiscoveryError } from '../../server/discovery/index.js';

export type CliErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'ENTITY_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'INVALID_TYPE'
  | 'INVALID_ARGS'
  | 'AMBIGUOUS_SLUGS'
  | 'SCHEMA_OUT_OF_DATE'
  | 'FILE_NOT_FOUND'
  | 'UNKNOWN_COMMAND'
  // M11 `c4s ask` — server discovery + propagacja statusow endpointu M05.
  | 'SERVER_NOT_RUNNING'
  | 'SERVER_NOT_RECOGNIZED'
  | 'NOT_FOUND'
  | 'STREAM_IN_PROGRESS'
  | 'AGENT_UNAVAILABLE'
  | 'AGENT_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  // M31 workspace model — registry-based resolution + per-project URL prefix.
  | 'AMBIGUOUS_WORKSPACE'
  | 'INDEX_NOT_MATERIALIZED'
  // 0.2.77 M39 — MAPPED FROM THE DISCOVERY CORE like the block further down.
  // Kept next to its sibling because the pair is only useful together: one says
  // "nothing is built", the other "what is built is out of date". Deliberately
  // NOT given an exit code of its own — `codeToExit` leaves it at the generic 1,
  // as the `AMBIGUOUS_*` codes are, because the recovery is in the message
  // (rebuild the projection, retry), not in a shell-level branch.
  | 'INDEX_STALE'
  | 'PROJECT_NOT_IN_WORKSPACE'
  // 2.1.0 — `--project <id>` matches no registered project id (was
  // PROJECT_SLUG_NOT_FOUND, when --project took a path or a slug). The message
  // lists the available ids — never directories.
  | 'PROJECT_ID_NOT_FOUND'
  | 'AMBIGUOUS_PROJECT'
  // 2.1.0 — a registry-writing command (`c4s trust-plugins`) met a registry that
  // still carries pre-2.1.0 hash ids. Only the server migrates; start it once.
  | 'REGISTRY_MIGRATION_PENDING'
  // M33 phase 3 — `c4s plugins doctor` exits with this when a pool package was
  // built against an incompatible MAJOR Host API (the only non-zero plugins exit).
  | 'HOST_API_INCOMPATIBLE'
  // 0.1.103 M11 — filesystem-only brief/patch command family.
  | 'BRIEF_NOT_FOUND'
  | 'PATCH_WRITE_FAILED'
  // 0.1.106 M11 — `c4s mark-brief-implemented` (server-delegating). ONE code for
  // the whole M36 artifact family: the guard is structurally blind to which
  // kind's fields it is rejecting, so a per-kind code was a distinction it could
  // not actually draw. Which key was refused travels in the MESSAGE.
  | 'IMMUTABLE_FIELD'
  // 0.1.104 M22 — `c4s install-skills`.
  | 'SKILLS_WRITE_FAILED'
  // 0.1.104 — `c4s agent --ct brief` create-mode error propagation.
  | 'VALIDATION'
  | 'BRIEF_SAME_RELEASE'
  | 'RELEASE_NOT_FOUND'
  // 2.1.11 — `c4s release-list` / `release-show` / `release-diff`. The release
  // operations' own refusals, passed through 1:1 from the server; no exit code
  // of their own.
  | 'INVALID_INCLUDE_FILTER'
  | 'INVALID_ENTITY_TYPES_FILTER'
  | 'INVALID_SLUGS_FILTER'
  | 'INVALID_PATHS_FILTER'
  | 'INVALID_ROOTS_FILTER'
  | 'CONFLICTING_FILTERS'
  | 'INVALID_PAGINATION'
  | 'INVALID_DIFF_RANGE'
  // 0.2.1 M38 — `c4s create-plugin` (mode `scaffold`). INVALID_TARGET and
  // TARGET_EXISTS are raised before anything is fetched or written;
  // TEMPLATE_FETCH_FAILED rolls back what this run created; INSTALL_FAILED
  // deliberately does NOT (the files stay, so a retry needs no refetch).
  | 'INVALID_TARGET'
  | 'TARGET_EXISTS'
  | 'TEMPLATE_FETCH_FAILED'
  // Not in the brief, which has no code for a write failure during expansion:
  // without it a read-only target or ENOSPC escapes untyped and the bin reports
  // it as UNKNOWN_COMMAND/exit 1. Rolls back like the two above it.
  | 'SCAFFOLD_WRITE_FAILED'
  | 'INSTALL_FAILED'
  // 0.2.3 M39 — MAPPED FROM THE DISCOVERY CORE, not raised by the CLI itself.
  // The other core codes (ENTITY_NOT_FOUND, SECTION_NOT_FOUND, INVALID_TYPE,
  // AMBIGUOUS_*, INDEX_NOT_MATERIALIZED) were already in this
  // union under their own names; these two are new here because no CLI command
  // used to be able to address a page or to refuse an argument the way the core
  // does. `INVALID_ARGUMENT` is deliberately NOT folded into the CLI's own
  // `INVALID_ARGS`: one means "you typed the flags wrong", the other carries a
  // correction from the core, and collapsing them would lose the hint.
  | 'PAGE_NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'AMBIGUOUS_ENTITY'
  | 'AMBIGUOUS_PAGE'
  // 0.2.13 — `--root-id` naming a root the project does not have. Raised by the
  // REST rendering ahead of the core (the per-root routers resolve the id from
  // the path segment), so it never travelled the `INVALID_ARGUMENT` path the
  // core would have used. Exits 4 with the other "you asked for something the
  // contract does not offer" codes.
  // 2.1.14 (M11 L14 `m11dcmds`) — neither an M11 code nor one mapped from the
  // core: it comes from the M02 page router and is passed on untranslated, for
  // an unknown root and a system root (`plans`) alike, the roots in `hint`.
  | 'ROOT_NOT_FOUND'
  // 0.2.65 M31 — `c4s list-workspaces` (mode `registry-read`) could not read
  // `~/.claude4spec/workspaces.json` at all: invalid JSON, a shape that is not a
  // registry, a schema version from a newer binary, or EACCES. A MISSING file is
  // deliberately not this code — an absent registry is an empty one, exit 0.
  | 'REGISTRY_READ_FAILED'
  // 0.2.95 M39 — MAPPED FROM THE DISCOVERY CORE: a search run that spent the
  // core's time budget before finishing. A fourth CATEGORY beside identity, type
  // and argument, and that is why it is not folded into any of them: nothing
  // about the command was wrong, so `INVALID_ARGS`/`INVALID_ARGUMENT` would send
  // a scripted caller to fix a pattern that was correct. The repair is the
  // SCOPE, and the core's `message` names the flags that narrow it.
  | 'SEARCH_BUDGET_EXCEEDED'
  // 0.2.98 M10 — `c4s create-plan`: slugify(title) names a plan that already
  // exists. A refusal, not a suffixed variant; nothing is written. Arrives
  // verbatim from the server's `create_plan`.
  | 'PLAN_ALREADY_EXISTS'
  // 0.2.99 M37 — `c4s load-skill-file`: the skills registry's taxonomy, verbatim
  // from the server (identical in all four channels). No slug in the registry;
  // no such file in the package; a binary package file (the manifest's
  // `isText: false` announced it).
  | 'SKILL_NOT_FOUND'
  | 'SKILL_FILE_NOT_FOUND'
  | 'NOT_TEXT';

export class CliError extends Error {
  /**
   * 2.1.0 convention: a code whose repair is known and stepwise carries the
   * steps as structured descriptors here (rendered into the stderr envelope),
   * not only as prose in `hint`.
   */
  constructor(
    public code: CliErrorCode,
    message: string,
    public hint?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/**
 * 0.2.3 M39 — a discovery-core error, as a CLI error.
 *
 * Every command converts its own failures today, so this is a NET rather than
 * the usual path: it catches a core error that no command anticipated. Without
 * it such an error lands in the bin's generic branch and is reported as
 * `UNKNOWN_COMMAND` with its `hint` discarded — the code replaced by a wrong one
 * and the repair path, which is the half the caller needed, gone. Returns null
 * for anything that is not a core error so the caller keeps its own fallback.
 */
export function cliErrorFromDiscovery(err: unknown): CliError | null {
  if (!isDiscoveryError(err)) return null;
  // The code is the core's, not a translation of it: both unions spell these the
  // same way precisely so a caller scripting `c4s` sees one vocabulary.
  return new CliError(err.code as CliErrorCode, err.message, err.hint);
}

/**
 * The process exit status for a CLI error code. Every code exits non-zero —
 * the generic bucket is 1. Lives here (not in the bin) so a test can read the
 * mapping without running the bin's top-level `main()`.
 */
export function codeToExit(code: string): number {
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
     * `c4s create-patch --brief ../foo.md` throws `BriefFsError('INVALID_ARGS')`
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
    // 2.1.0 — "something else answers at that address" is the same shell-level
    // branch as "nothing answers": the environment, not the command, is wrong.
    case 'SERVER_NOT_RECOGNIZED':
    case 'SERVER_NOT_RUNNING':
      return 8;
    case 'HOST_API_INCOMPATIBLE':
      return 9;
    // 2.1.0 — `--project <id>` matches no registered id: the same exit status
    // as every other "no such project" (PROJECT_NOT_IN_WORKSPACE falls to the
    // generic 1 as well). The exit-10 slot of the retired PROJECT_SLUG_NOT_FOUND
    // is not reused.
    case 'PROJECT_ID_NOT_FOUND':
      return 1;
    // 2.1.0 — an ambiguous project id is resolved the same way as an ambiguous
    // workspace (pass --workspace), so it shares its exit status.
    case 'AMBIGUOUS_PROJECT':
      return 7;
    // 2.1.0 — a registry-writing command met a pre-2.1.0 registry (hash ids).
    // The repair is to start the server once; nothing is wrong with the command.
    case 'REGISTRY_MIGRATION_PENDING':
      return 27;
    // 0.2.6 — the core's two ambiguity codes. A caller that has to disambiguate
    // must be able to see it from the exit status, the way it already can for
    // the two workspace-level ambiguities above.
    case 'AMBIGUOUS_ENTITY':
      return 20;
    case 'AMBIGUOUS_PAGE':
      return 21;
    // 0.2.65 M31 — the registry itself is unreadable. Its own status, not folded
    // into the exit-4 "you typed it wrong" group: the caller typed nothing wrong,
    // and the repair is to the machine's `~/.claude4spec/`, not to the command.
    case 'REGISTRY_READ_FAILED':
      return 22;
    /**
     * 0.2.95 M39 — the search ran out of time, and it gets its own status for
     * the same reason it got its own code: a wrapper branching on exit 4 ("you
     * typed it wrong") would retry with a different pattern, which is the one
     * change that cannot help. The command was right; the scope was too wide.
     */
    case 'SEARCH_BUDGET_EXCEEDED':
      return 23;
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
    // 0.2.98 M10 `create-plan` — the slug is taken. Its own status rather than
    // exit 4: the arguments were well-formed; the repair is a different title
    // (or editing the existing plan), not fixing a flag.
    case 'PLAN_ALREADY_EXISTS':
      return 24;
    // 0.2.99 M37 `load-skill-file` — the address named nothing (unknown slug, or
    // a file the package does not have): one status, since the repair is the same
    // — re-read `c4s list-skills` / the manifest. NOT_TEXT is its own: the address
    // was right, the channel just serves text only.
    case 'SKILL_NOT_FOUND':
    case 'SKILL_FILE_NOT_FOUND':
      return 25;
    case 'NOT_TEXT':
      return 26;
    // PROJECT_NOT_IN_WORKSPACE → 1 (ask-group, like other server-side ask errors)
    default:
      return 1;
  }
}
