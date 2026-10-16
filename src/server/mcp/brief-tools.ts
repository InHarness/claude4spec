/**
 * M21 brief-tools MCP server.
 *
 * Four tools (get_brief, update_brief, list_brief_versions, get_brief_version)
 * — no `create_brief`/`list_briefs`/`brief_generate` (UI/user surface, not
 * agent loop). 2.1.18: the one agent list of briefs is `list_briefs` on
 * `transagent-tools` (top-level `chat` only) — never a position of this server.
 *
 * ## Two ways the brief gets addressed
 *
 * `thread` — the original. `briefPath` is captured from
 * `chat_thread.brief_path` at thread creation and closed over here; the tools
 * take no brief argument. Mounted by `routes/chat.ts` only for threads with
 * `context_type='brief'`. 2.1.14 — that absence is now M21's declared thread
 * isolation (`01ytpznn`, `OWNER_THREAD_ISOLATION.brief`): the parameter's shape
 * per channel comes from M43's `explicit-addressing` rule (`addressing.ts`),
 * not from a decision taken here.
 *
 * `explicit` — 0.2.13, for the external MCP surface. A connection has no
 * thread, so there is no ambient brief to close over, and the tools take a
 * REQUIRED `path` argument instead. The distinction is not cosmetic: falling
 * back to "the" brief on a channel that never had one is how an update lands in
 * a file the caller did not name. `PROFILES.brief.requiresExplicitBriefTarget`
 * is what selects this mode, and it exists so that the fallback cannot be
 * reintroduced by accident.
 *
 * 2.1.26 (M21 `01ytpznn`) — the two mounts are two sets of declarations, each
 * with its own `mcp-tool` record: `brief-tools-<tool>` (thread mount,
 * `internal`) and `brief-tools-<tool>-explicit` (threadless mount, external
 * `mcp`, seen by a `brief`-profile connection). Not the same tools under another
 * name: `path` is required in the explicit ones and the descriptions differ.
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { ConflictError, composeBriefBody, type BriefService } from '../services/brief.js';
import { toolError, toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';
import { applyTextEdits, type MatchPosition, type PositionResolver, type TextEdit } from '../services/text-edits.js';
import { bodyPositionResolver } from '../services/section-text.js';
import { addressingParam, artifactAddressingShape } from '../operations/addressing.js';

export interface BriefToolsContext {
  threadId: string;
  briefPath: string;
  briefService: BriefService;
}

/**
 * The external-surface variant: no thread, no ambient brief. Every call names
 * the brief it means.
 */
export interface ExplicitBriefToolsContext {
  briefService: BriefService;
  target: 'explicit';
}

/**
 * The path argument of the explicit mode, described once for both tools.
 *
 * 0.2.40 — the field is `path`. BREAKING: it was `brief`.
 *
 * The catalog row, the REST route and the CLI have always called this `path`;
 * only the MCP rendering called it `brief`. One field under two names is not a
 * cosmetic inconsistency here — the catalog is what an agent reads to learn the
 * call, so it was being taught to write `{ path }` against a tool that accepted
 * only `{ brief }` and refused it as a missing argument.
 *
 * It stays REQUIRED, and that is why the fix is a rename rather than an alias
 * accepted alongside the old name: `required` is enforced by the schema, and a
 * schema cannot express "one of these two". Demoting both to optional to keep
 * the old spelling working would move the guarantee into the handler and leave
 * the advertised contract saying something weaker than the truth — on the one
 * operation whose whole point is that an external connection must NAME its
 * brief rather than be given a default one.
 */
const EXPLICIT_BRIEF_ARG = {
  path: z
    .string()
    .describe(
      'Path of the brief relative to the briefs root (.claude4spec/briefs), e.g. `0-2-12-to-0-2-13.md`. Required: this connection has no thread, so there is no default brief. List the candidates with the brief artifact read operations.',
    ),
};

/**
 * The read window, shared shape with `get_page.range` — 1-based, inclusive.
 *
 * Unconditionally allowed, with no `sectionIndexed` gate: a brief never enters
 * `section_index`, so `get_page_outline` + `get_sections` is not a second way to
 * resume a large read the way it is for a page. `range` is the only one, which
 * is exactly why it had to exist — before it, a brief past the response budget
 * simply could not be read through.
 *
 * 2.1.13 — the description is the `brief-tools-get-brief` entity's, verbatim.
 */
/*
 * 2.1.26 — the bounds are NOT in the schema: the record's logic refuses a
 * non-integer window, a start below 1 or an end before the start with
 * `INVALID_ARGUMENT` (`applyArtifactRange`), and a schema bound would answer
 * those with the transport's input-validation error instead of the code.
 */
const BRIEF_RANGE_ARG = {
  range: z
    .object({ start: z.number(), end: z.number() })
    .optional()
    .describe(
      'Line window { start, end }, 1-based and inclusive. Use it to read a long brief in parts or to fetch the rest after a truncated response. A start past the end of the file is refused with the file size.',
    ),
};

/**
 * 2.1.14 — the thread-mount descriptions are the `brief-tools-*` entities',
 * verbatim. Each says there is no `path`: M21 declares thread isolation
 * (`01ytpznn`), so the internal schema carries no address at all.
 */
const THREAD_GET_BRIEF_DESCRIPTION =
  "Read the brief this thread is anchored in — content, frontmatter and hash. This is the ONLY way to the brief's content: the system prompt carries the brief's path and frontmatter, never its body and never its hash. There is no `path` parameter: the tool is scoped to the brief of this thread and cannot reach another one. For a long brief, or when a response comes back truncated, read it in windows with `range`. The returned `hash` is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write. Call it before editing, and again after a system reminder says the file changed underneath you.";

/**
 * `update_brief`'s description minus its first sentence, which is the only part
 * that differs between the mounts (where the brief's address comes from).
 */
const UPDATE_BRIEF_DESCRIPTION_BODY =
  'TWO INPUT SHAPES, EXACTLY ONE PER CALL (both, or neither, is invalid):\n- by action — `action` + `content`: `replace` swaps the addressed range, `append` adds at the end, `insert_after_section` places new content after a section you address by `anchor` or by `heading`. You pass the full text of the range in `content`.\n- differential — `textEdits`: literal substitutions over the whole brief, without resending the untouched text. Use it for a few sentences anywhere; use `action` + `content` to write or genuinely rewrite a range.\n\n`find` matches BYTE FOR BYTE — no regex, no whitespace normalisation. `expectedMatches` OMITTED MEANS EXACTLY ONE match; pass a number, or `"all"` for every occurrence. All patterns are counted on the brief as it was BEFORE the write, so substitutions do not cascade.\n\n`expectedHash` is MANDATORY. Pass the hash you got from `get_brief`; omitting it is a validation error, not silent permission to overwrite. The brief is edited in parallel by this thread, by a human in the UI and by an implementer agent in the terminal, so last-write-wins would lose someone\'s work without a trace.\n\nAn `anchor` that no longer resolves does not fail the call — the content is appended at the end and the answer says so. A heading inside a code block is never a target, and a `heading` matching several headings lands after the first of them, with a warning in the answer.\n\nFrontmatter is not editable here; only `implemented` is mutable at all, and it has its own route.';

/** `brief-tools-update-brief`'s description, verbatim (thread mount). */
const THREAD_UPDATE_BRIEF_DESCRIPTION =
  'Edit the brief of this thread — there is no `path` parameter and no way to reach another brief. ' + UPDATE_BRIEF_DESCRIPTION_BODY;

/** The same write on the threadless mount, where the caller names the brief. */
const EXPLICIT_UPDATE_BRIEF_DESCRIPTION =
  'Edit the brief named by `path` — required: this connection has no thread, so there is no default brief. ' + UPDATE_BRIEF_DESCRIPTION_BODY;

/** `brief-tools-list-brief-versions`' description, verbatim (thread mount). */
const THREAD_LIST_BRIEF_VERSIONS_DESCRIPTION =
  'List the version history of the brief — metadata only, never content. Use it to see what changed and when before pulling a specific snapshot with `get_brief_version`. There is no `path` parameter: the tool addresses the brief of this thread only.';

const EXPLICIT_LIST_BRIEF_VERSIONS_DESCRIPTION =
  'List the version history of the brief named by `path` — metadata only, never content, oldest first (offset 0 is version 1). Use it to see what changed and when before pulling a specific snapshot with `get_brief_version`. An unknown path is BRIEF_NOT_FOUND, never an empty list.';

/** `brief-tools-get-brief-version`'s description, verbatim (thread mount). */
const THREAD_GET_BRIEF_VERSION_DESCRIPTION =
  'Read one historical snapshot of the brief, addressed by version number from `list_brief_versions`. Use it to see what the brief said before an edit — it does not restore anything and does not touch the live file. There is no `path` parameter: the tool addresses the brief of this thread only.';

const EXPLICIT_GET_BRIEF_VERSION_DESCRIPTION =
  'Read one historical snapshot of the brief named by `path`, addressed by version number from `list_brief_versions`. Use it to see what the brief said before an edit — it does not restore anything and does not touch the live file.';

/** The same read on the threadless mount, where the caller names the brief. */
const EXPLICIT_GET_BRIEF_DESCRIPTION =
  'Read the brief named by `path` — content, frontmatter and hash. An unknown path is BRIEF_NOT_FOUND, with the real brief paths in the hint. For a long brief, or when a response comes back truncated, read it in windows with `range`; a window starting past the end of the file is INVALID_ARGUMENT stating the file size. The returned `hash` is the digest of the WHOLE file (also when `range` narrowed what came back) and is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write.';

const AGENT_ACTIONS = z.enum(['replace', 'append', 'insert_after_section']);

export function buildBriefToolsServer(
  ctx: BriefToolsContext | ExplicitBriefToolsContext,
  projectId: string | null = null,
): CapturedMcpServer {
  const { briefService } = ctx;
  const explicit = 'target' in ctx;
  /**
   * The thread's brief in `thread` mode; in `explicit` mode there is none, and
   * `resolveBrief` reads the call's own argument instead.
   */
  const ambientBriefPath = explicit ? null : ctx.briefPath;
  /**
   * 2.1.14 — the brief's addressing parameter, shaped by M43's
   * `explicit-addressing` rule and NOT decided here. The threadless mount is an
   * external channel (`mcp`): `path` is required. The thread mount is
   * `internal`, where M21 declares thread isolation
   * (`OWNER_THREAD_ISOLATION.brief`): `path` is ABSENT, not optional.
   */
  const pathParam = addressingParam(
    'path',
    artifactAddressingShape('brief', explicit ? 'mcp' : 'internal'),
    EXPLICIT_BRIEF_ARG.path,
  );

  /**
   * The shared envelope — see `operations/envelope.ts`. The local pair this
   * replaces dropped `hint` and `ConflictError.currentHash`, which on a brief
   * write is the same remedy it is on a page write.
   */
  const ok = (data: unknown, operation: string) =>
    toolSuccess(data, { operation, channel: 'mcp', project: projectId });
  /**
   * 2.1.26 — `update_brief`'s record: a stale hash is `BRIEF_CONFLICT` "with the
   * current hash AND content". The shared envelope forwards `currentHash` only,
   * so the conflict's `currentContent` — what the caller diffs against before it
   * retries, the field the REST rendering already returns — is added here.
   */
  const fail = (err: unknown) =>
    err instanceof ConflictError && err.currentContent !== undefined
      ? toolError(err.code, err.message, undefined, { currentHash: err.currentHash, currentContent: err.currentContent })
      : toolFailure(err);

  /**
   * The one place the two addressing modes differ at runtime.
   *
   * In `explicit` mode the zod schema already marks `path` required, so a
   * client that omits it is rejected before the handler runs. This guard is for
   * what the schema cannot express — a present-but-empty string — and it fails
   * the same way, naming the field, rather than resolving to the briefs root's directory itself.
   */
  const resolveBrief = (args: Record<string, unknown>): string => {
    if (!explicit) return ambientBriefPath!;
    const raw = typeof args.path === 'string' ? args.path.trim() : '';
    if (raw === '') {
      /*
       * 2.1.13 — `BRIEF_NOT_FOUND`, not `VALIDATION`: an empty path names no
       * brief, and `BRIEF_NOT_FOUND` is the one code every brief row of the
       * catalog declares for an address that resolves to nothing (`get_brief`,
       * `list_brief_versions` and `get_brief_version` declare no `VALIDATION`).
       */
      throw new DomainError(
        'BRIEF_NOT_FOUND',
        'path is required: this connection has no thread, so there is no default brief to fall back on',
        'name the brief by its path relative to the briefs root (.claude4spec/briefs); `c4s list-briefs` lists them',
      );
    }
    return raw;
  };

  /**
   * 2.1.13 — `brief-tools-get-brief`: `range` + the budget contract (a brief over
   * the budget read without `range` is `truncated: true` with a `truncationHint`
   * pointing at `range` — `BriefService.getBrief`), `readOnlyHint`, and the
   * row's two codes: an unknown path is `BRIEF_NOT_FOUND`, a window starting past
   * the end (or a malformed one) `INVALID_ARGUMENT`.
   */
  const getBrief = mcpTool(
    'get_brief',
    explicit ? EXPLICIT_GET_BRIEF_DESCRIPTION : THREAD_GET_BRIEF_DESCRIPTION,
    { ...pathParam, ...BRIEF_RANGE_ARG },
    async (args) => {
      try {
        const range = args.range as { start: number; end: number } | undefined;
        const brief = await briefService.getBrief(resolveBrief(args), { range });
        return ok(brief, 'get_brief');
      } catch (err) {
        return fail(err);
      }
    },
    { readOnlyHint: true },
  );

  /**
   * 0.2.86 (M43 `diff-field-names`) — the differential payload, described in the
   * SAME words as `update_plan`'s and the page tools'. One edit grammar across
   * every content write; the engine is `services/text-edits.ts`.
   */
  const textEditsParam = z
    .array(
      z.object({
        find: z
          .string()
          .describe(
            'Searched LITERALLY, byte for byte — no regex, no whitespace normalization. ' +
              'Copy it out of what you just read. Zero hits → FIND_NOT_FOUND, whose envelope tells you ' +
              'whether the pattern would have matched with whitespace collapsed.',
          ),
        replaceWith: z.string().describe('Inserted in place of every hit. "" deletes the matched text.'),
        expectedMatches: z
          .union([z.number().int().min(1), z.literal('all')])
          .optional()
          .describe(
            'How many hits you expect. OMITTING IT MEANS EXACTLY 1 — not "any number". ' +
              'Pass "all" to substitute every occurrence without committing to a count. ' +
              'Anything else → MATCH_COUNT_MISMATCH, which answers with the real count and each hit as anchor + line.',
          ),
      }),
    )
    .min(1);

  /**
   * 2.1.14 — `brief-tools-update-brief`: the entity's parameters (`action`,
   * `content`, `textEdits`, `anchor`, `heading`, `expectedHash`,
   * `changeSummary`) with its descriptions, and `path` only where the rule puts
   * it (the threadless mount). Exactly one input shape per call — `action` +
   * `content`, or `textEdits` — refused as `VALIDATION` before the file is read.
   */
  const updateBrief = mcpTool(
    'update_brief',
    explicit ? EXPLICIT_UPDATE_BRIEF_DESCRIPTION : THREAD_UPDATE_BRIEF_DESCRIPTION,
    {
      ...pathParam,
      action: AGENT_ACTIONS.optional().describe(
        'ACTION SHAPE: what to do with `content` — swap the addressed range, add at the end, or insert after an addressed section. Required together with `content`; forbidden with `textEdits`.',
      ),
      content: z
        .string()
        .optional()
        .describe(
          'ACTION SHAPE: full text this edit contributes — write the range out. Required together with `action`; forbidden with `textEdits`.',
        ),
      textEdits: textEditsParam
        .optional()
        .describe(
          'DIFFERENTIAL SHAPE: `[{ find, replaceWith, expectedMatches? }]` applied to the whole brief. `find` is literal, byte for byte; `expectedMatches` omitted means exactly one hit, a number means exactly that many, `"all"` means every occurrence. Mutually exclusive with `action` and `content`.',
        ),
      anchor: z
        .string()
        .optional()
        .describe('Section anchor to address for `insert_after_section`. Unknown anchor degrades to append-at-end with a warning.'),
      heading: z
        .string()
        .optional()
        .describe('Heading text to address for `insert_after_section`, as an alternative to `anchor`.'),
      expectedHash: z
        .string()
        .describe('sha256 of the brief as you last read it. Missing → VALIDATION; mismatch → BRIEF_CONFLICT carrying the current hash.'),
      changeSummary: z
        .string()
        .optional()
        .describe('One-line description of what this edit changes, recorded with the version.'),
    },
    async (args) => {
      try {
        const briefPath = resolveBrief(args);
        /**
         * The guard is the operation's, not the caller's discipline.
         *
         * This used to read `args.expectedHash ?? current.hash` — a fallback that
         * substituted the hash read moments earlier, so the comparison in
         * `BriefService.updateContent` could never fail and `BRIEF_CONFLICT` was
         * unreachable through this tool. A guard you cannot fail is not a guard;
         * two threads editing one brief overwrote each other in silence.
         *
         * Briefs are deliberately stricter than pages here: `update_page` treats a
         * missing hash as a deliberate overwrite (the editor never sends one),
         * while a brief write has no such legacy caller and must name what it
         * expected to be overwriting.
         */
        const expectedHash = typeof args.expectedHash === 'string' ? args.expectedHash.trim() : '';
        if (expectedHash === '') {
          throw new DomainError(
            'VALIDATION',
            'expectedHash is required: read the brief first and pass back the hash you read',
            'call get_brief and send its `hash` as `expectedHash`',
          );
        }
        /*
         * 2.1.14 — the input shape is settled on entry, before the file is read:
         * EXACTLY ONE of `action` + `content` (literal) or `textEdits`
         * (differential). Both, neither, or half of the action shape is
         * `VALIDATION` — the row's code for a malformed call (M21 `01ytpznn`).
         */
        const hasTextEdits = args.textEdits !== undefined;
        const hasAction = args.action !== undefined || args.content !== undefined;
        if (hasTextEdits === hasAction) {
          throw new DomainError(
            'VALIDATION',
            hasTextEdits
              ? 'pass either `textEdits` or `action` + `content`, not both'
              : 'nothing to write: pass `textEdits`, or `action` + `content`',
            'textEdits for a punctual change; action/content for a rewrite, append or section insert',
          );
        }
        /*
         * `anchor`/`heading` address `insert_after_section`'s insertion point and
         * nothing else. Sent with `textEdits` they used to be dropped in silence,
         * which reads to the caller as "my substitutions were scoped to that
         * section" — they never are; a `find` is matched over the whole body.
         * `update_page` refuses the analogous combination for the same reason.
         */
        if (hasTextEdits && (args.anchor !== undefined || args.heading !== undefined)) {
          throw new DomainError(
            'VALIDATION',
            '`anchor`/`heading` do not scope `textEdits`: every `find` is matched over the whole body',
            'drop them, or make the `find` itself unambiguous',
          );
        }
        if (hasAction && (args.action === undefined || typeof args.content !== 'string')) {
          throw new DomainError(
            'VALIDATION',
            '`action` and `content` go together',
            'pass both — or use `textEdits` for literal substitutions',
          );
        }
        const current = await briefService.getBrief(briefPath, { full: true });
        /*
         * The guard runs BEFORE the edits, as it does in `update_page`
         * (`page-write.ts`) and `update_plan` (`plan.ts`) — `updateContent`
         * re-checks it under the write lock and that is what actually protects
         * the file, but reaching it only after `applyTextEdits` means a stale
         * caller is answered by the DIFF: `FIND_NOT_FOUND` against a body it
         * never read, telling it to copy the fragment more carefully. The thing
         * it needs to hear is `BRIEF_CONFLICT` — someone else wrote, re-read.
         */
        if (expectedHash !== current.hash) {
          throw new ConflictError(
            'BRIEF_CONFLICT',
            'brief changed since last read',
            current.hash,
            current.content,
          );
        }
        let newBody: string;
        let replacements: number | undefined;
        let warning: string | undefined;
        if (hasTextEdits) {
          const applied = applyTextEdits(current.body, args.textEdits as TextEdit[], briefPositionResolver(current.content, current.body));
          newBody = applied.text;
          replacements = applied.replacements;
        } else {
          const composed = composeBriefBody(
            current.body,
            args.action as 'replace' | 'append' | 'insert_after_section',
            args.content as string,
            typeof args.anchor === 'string' ? args.anchor : undefined,
            typeof args.heading === 'string' ? args.heading : undefined,
          );
          newBody = composed.body;
          warning = composed.warning;
        }
        // Reconstruct full content with original frontmatter (immutable for agent).
        const matter = await import('gray-matter');
        const newContent = matter.default.stringify(newBody, current.frontmatter as Record<string, unknown>);
        const result = await briefService.updateContent({
          path: briefPath,
          content: newContent,
          expectedHash,
          changedBy: 'agent',
          changeSummary: typeof args.changeSummary === 'string' ? args.changeSummary : undefined,
        });
        /**
         * echo-free: the timeline, plus what the caller could not predict — the
         * count, and (2.0.0) where an `insert_after_section` did NOT land as asked.
         */
        return ok(
          {
            newHash: result.newHash,
            ...(replacements !== undefined ? { replacements } : {}),
            ...(warning !== undefined ? { warning } : {}),
          },
          'update_brief',
        );
      } catch (err) {
        return fail(err);
      }
    },
    // The entity's hints: a write (`readOnlyHint: 0`), not idempotent
    // (`idempotentHint: 0` — `append`, `insert_after_section`, `textEdits`).
    { readOnlyHint: false, idempotentHint: false },
  );

  const listBriefVersions = mcpTool(
    'list_brief_versions',
    explicit ? EXPLICIT_LIST_BRIEF_VERSIONS_DESCRIPTION : THREAD_LIST_BRIEF_VERSIONS_DESCRIPTION,
    {
      ...pathParam,
      // The row's history window (`limit` / `offset`, `katalog-operacji-m21`
      // row 6) — the catalog's paging, rendered in every channel.
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        const briefPath = resolveBrief(args);
        // Existence first (inside the service), so an unknown path is
        // BRIEF_NOT_FOUND with alternatives, not an empty list.
        const all = [...(await briefService.listVersionsAddressed(briefPath))].reverse();
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        const limit = typeof args.limit === 'number' ? args.limit : all.length;
        return ok({ versions: all.slice(offset, offset + limit), total: all.length }, 'list_brief_versions');
      } catch (err) {
        return fail(err);
      }
    },
    { readOnlyHint: true },
  );

  const getBriefVersion = mcpTool(
    'get_brief_version',
    explicit ? EXPLICIT_GET_BRIEF_VERSION_DESCRIPTION : THREAD_GET_BRIEF_VERSION_DESCRIPTION,
    {
      ...pathParam,
      // 2.1.26 — `integer`, with no lower bound in the schema: a number off the
      // history (0 included) is the record's `INVALID_ARGUMENT` stating 1..N.
      version: z.number().int().describe('Version number, from list_brief_versions.'),
    },
    async (args) => {
      try {
        const briefPath = resolveBrief(args);
        // Existence first (inside the service), for the same reason as
        // `list_brief_versions`: a near-miss filename must be answered with the
        // real paths (BRIEF_NOT_FOUND), not with "that version is missing" —
        // which sends the caller looking for a version. A version off the
        // history is INVALID_ARGUMENT stating 1..N (ASSUMPTION:dev-0003).
        const v = await briefService.getVersionAddressed(briefPath, Number(args.version));
        return ok(v, 'get_brief_version');
      } catch (err) {
        return fail(err);
      }
    },
    { readOnlyHint: true },
  );

  return createMcpServer({
    name: 'brief-tools',
    tools: [getBrief, updateBrief, listBriefVersions, getBriefVersion],
  });
}

/**
 * Mismatch positions as anchor + line (M43 `match-count-declared`), never a
 * byte offset. The section walk itself is `bodyPositionResolver` — shared with
 * the page and plan writers, because a second copy of the innermost-section
 * rule is a second thing to get wrong, and this file carried one.
 *
 * What is brief-specific is only the frame: the engine matches over the body
 * alone, but the reported line is a WHOLE-FILE line — the frame `get_brief`'s
 * `range` counts in, so a caller can re-read the hit with it (same rule as
 * `pagePositionResolver`).
 */
function briefPositionResolver(fullText: string, body: string): PositionResolver {
  const bodyFirstLine = Math.max(0, fullText.split('\n').length - body.split('\n').length);
  const inBody = bodyPositionResolver(body);
  return (offset, sourceText): MatchPosition => {
    const pos = inBody(offset, sourceText);
    return { anchor: pos.anchor, line: pos.line + bodyFirstLine };
  };
}
