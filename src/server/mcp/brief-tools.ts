/**
 * M21 brief-tools MCP server.
 *
 * Four tools (get_brief, update_brief, list_brief_versions, get_brief_version)
 * — no `create_brief`/`list_briefs`/`brief_generate` (UI/user surface, not
 * agent loop).
 *
 * ## Two ways the brief gets addressed
 *
 * `thread` — the original. `briefPath` is captured from
 * `chat_thread.brief_path` at thread creation and closed over here; the tools
 * take no brief argument. Mounted by `routes/chat.ts` only for threads with
 * `context_type='brief'`.
 *
 * `explicit` — 0.2.13, for the external MCP surface. A connection has no
 * thread, so there is no ambient brief to close over, and the tools take a
 * REQUIRED `path` argument instead. The distinction is not cosmetic: falling
 * back to "the" brief on a channel that never had one is how an update lands in
 * a file the caller did not name. `PROFILES.brief.requiresExplicitBriefTarget`
 * is what selects this mode, and it exists so that the fallback cannot be
 * reintroduced by accident.
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { ConflictError, type BriefService } from '../services/brief.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';
import { ANCHOR_LINE_RE } from '../../shared/anchor-pattern.js';
import { applyTextEdits, type MatchPosition, type PositionResolver, type TextEdit } from '../services/text-edits.js';
import { bodyPositionResolver } from '../services/section-text.js';

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
      'Path of the brief relative to `briefsDir`, e.g. `0-2-12-to-0-2-13.md`. Required: this connection has no thread, so there is no default brief. List the candidates with the brief artifact read operations.',
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
 */
const BRIEF_RANGE_ARG = {
  range: z
    .object({ start: z.number().int().positive(), end: z.number().int().positive() })
    .optional()
    .describe(
      '1-based inclusive line window onto the brief. Always allowed. A `start` past the end of the file is INVALID_ARGUMENT stating the file size.',
    ),
};

const AGENT_ACTIONS = z.enum(['replace', 'append', 'insert_after_section']);
const HEADING_RE = /^(#{2,6})\s+(.+?)\s*$/;

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
   * The shared envelope — see `operations/envelope.ts`. The local pair this
   * replaces dropped `hint` and `ConflictError.currentHash`, which on a brief
   * write is the same remedy it is on a page write.
   */
  const ok = (data: unknown, operation: string) =>
    toolSuccess(data, { operation, channel: 'mcp', project: projectId });
  const fail = toolFailure;

  /**
   * The one place the two addressing modes differ at runtime.
   *
   * In `explicit` mode the zod schema already marks `path` required, so a
   * client that omits it is rejected before the handler runs. This guard is for
   * what the schema cannot express — a present-but-empty string — and it fails
   * the same way, naming the field, rather than resolving to `briefsDir` itself.
   */
  const resolveBrief = (args: Record<string, unknown>): string => {
    if (!explicit) return ambientBriefPath!;
    const raw = typeof args.path === 'string' ? args.path.trim() : '';
    if (raw === '') {
      throw new DomainError(
        'VALIDATION',
        'path is required: this connection has no thread, so there is no default brief to fall back on',
      );
    }
    return raw;
  };

  const getBrief = mcpTool(
    'get_brief',
    [
      explicit
        ? 'Read the current state of the brief named by `path`.'
        : 'Read the current state of the brief attached to this thread.',
      'Returns { frontmatter, body, content, hash }. Use `hash` as `expectedHash`',
      'in the next `update_brief` call to detect concurrent edits — it is always the',
      'digest of the WHOLE file, including when `range` narrowed what came back.',
      'Pass `range: { start, end }` to read a 1-based inclusive line window; it is',
      'always allowed (a brief has no section index, so a window is the only way to',
      'resume). A brief over the response budget read WITHOUT `range` comes back',
      '`truncated: true` with a `truncationHint` naming the range to use.',
      'Brief lives on disk under `briefsDir`; you do NOT have filesystem access',
      '(no Read/Write/Edit) — this tool is the only way to read brief content.',
      ...(explicit
        ? []
        : [
            "This is the ONLY way to the brief's content: the system prompt carries the brief's path and frontmatter, never its body and never its hash.",
          ]),
    ].join(' '),
    explicit ? { ...EXPLICIT_BRIEF_ARG, ...BRIEF_RANGE_ARG } : { ...BRIEF_RANGE_ARG },
    async (args) => {
      try {
        const range = args.range as { start: number; end: number } | undefined;
        const brief = await briefService.getBrief(resolveBrief(args), { range });
        return ok(brief, 'get_brief');
      } catch (err) {
        return fail(err);
      }
    },
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

  const updateBrief = mcpTool(
    'update_brief',
    [
      'Edit the brief markdown body through EXACTLY ONE of two input shapes:',
      '(A) `action` + `content`:',
      '- replace: full rewrite (provide complete markdown in `content`).',
      '- append: append fragment at end of body.',
      '- insert_after_section: insert fragment after a section identified by `anchor`',
      '  (preferred — 8-char nanoid in `<!-- anchor: ... -->`) or `heading` (text match).',
      '(B) `textEdits`: literal find/replaceWith substitutions counted over the WHOLE body',
      '(frontmatter excluded). All finds are evaluated against the body BEFORE the write;',
      'overlapping matches are INVALID_ARGUMENT. The response carries `replacements`.',
      'Both shapes, or neither, → INVALID_ARGUMENT.',
      'You CANNOT modify frontmatter (type, from_release, to_release, roots,',
      'generated_at, implemented). `roots` is the brief scope (the',
      "releasable roots this brief covers; absent = whole-release) — pass it to release_diff",
      'as `roots` to keep the diff scoped to this brief. `implemented` is owned by the',
      'implementer-agent in the target repo and toggled via filesystem edit, not via this MCP.',
      'Any frontmatter mutation attempt → IMMUTABLE_FIELD.',
      'REQUIRED `expectedHash` (sha256 from get_brief) — read the brief, then pass the hash',
      'you read back here. Mismatch → BRIEF_CONFLICT (re-read brief before retrying);',
      'omitting it → VALIDATION. There is no unguarded write.',
      'Returns { newHash, replacements? } — never the content you sent.',
      'Each mutation captures a row in file_version with changed_by="agent".',
    ].join(' '),
    {
      ...(explicit ? EXPLICIT_BRIEF_ARG : {}),
      action: AGENT_ACTIONS.optional().describe('Shape (A). Mutually exclusive with textEdits.'),
      content: z.string().optional().describe('Shape (A): the fragment or full body for `action`.'),
      anchor: z.string().optional(),
      heading: z.string().optional(),
      textEdits: textEditsParam
        .optional()
        .describe('Shape (B): literal substitutions over the whole body. Mutually exclusive with action/content.'),
      expectedHash: z
        .string()
        .describe('sha256 of the brief as you last read it (the `hash` from get_brief). Required.'),
      changeSummary: z.string().optional(),
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
        const hasTextEdits = args.textEdits !== undefined;
        const hasAction = args.action !== undefined || args.content !== undefined;
        /*
         * `anchor`/`heading` address `insert_after_section`'s insertion point and
         * nothing else. Sent with `textEdits` they used to be dropped in silence,
         * which reads to the caller as "my substitutions were scoped to that
         * section" — they never are; a `find` is matched over the whole body.
         * `update_page` refuses the analogous combination for the same reason.
         */
        if (hasTextEdits && (args.anchor !== undefined || args.heading !== undefined)) {
          throw new DomainError(
            'INVALID_ARGUMENT',
            '`anchor`/`heading` do not scope `textEdits`: every `find` is matched over the whole body',
            'drop them, or make the `find` itself unambiguous',
          );
        }
        if (hasTextEdits === hasAction) {
          throw new DomainError(
            'INVALID_ARGUMENT',
            hasTextEdits
              ? 'pass either `textEdits` or `action` + `content`, not both'
              : 'nothing to write: pass `textEdits`, or `action` + `content`',
            'textEdits for a punctual change; action/content for a rewrite, append or section insert',
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
        if (hasTextEdits) {
          const applied = applyTextEdits(current.body, args.textEdits as TextEdit[], briefPositionResolver(current.content, current.body));
          newBody = applied.text;
          replacements = applied.replacements;
        } else {
          if (args.action === undefined || typeof args.content !== 'string') {
            throw new DomainError('INVALID_ARGUMENT', '`action` and `content` go together');
          }
          newBody = composeBody(
            current.body,
            args.action as 'replace' | 'append' | 'insert_after_section',
            args.content,
            typeof args.anchor === 'string' ? args.anchor : undefined,
            typeof args.heading === 'string' ? args.heading : undefined,
          );
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
        /** echo-free: the timeline, plus the one count the caller could not predict. */
        return ok(
          { newHash: result.newHash, ...(replacements !== undefined ? { replacements } : {}) },
          'update_brief',
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const listBriefVersions = mcpTool(
    'list_brief_versions',
    [
      explicit
        ? 'List the versions of the brief named by `path` (metadata only, no content), oldest first — offset 0 is version 1.'
        : "List the versions of this thread's brief (metadata only, no content), oldest first — offset 0 is version 1.",
      'Use before get_brief_version.',
    ].join(' '),
    {
      ...(explicit ? EXPLICIT_BRIEF_ARG : {}),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        const briefPath = resolveBrief(args);
        // Existence first, so an unknown path is NOT_FOUND with alternatives, not an empty list.
        await briefService.getBrief(briefPath, { range: { start: 1, end: 1 } });
        const all = [...briefService.listVersions(briefPath)].reverse();
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        const limit = typeof args.limit === 'number' ? args.limit : all.length;
        return ok({ versions: all.slice(offset, offset + limit), total: all.length }, 'list_brief_versions');
      } catch (err) {
        return fail(err);
      }
    },
  );

  const getBriefVersion = mcpTool(
    'get_brief_version',
    'Get one version snapshot of the brief with its full content. Use to inspect a historical state or to diff locally.',
    {
      ...(explicit ? EXPLICIT_BRIEF_ARG : {}),
      version: z.number().int().positive(),
    },
    async (args) => {
      try {
        const briefPath = resolveBrief(args);
        // Existence first, for the same reason as `list_brief_versions`: a
        // near-miss filename must be answered with the real paths, not with
        // "version 1 not found" — which sends the caller looking for a version.
        await briefService.getBrief(briefPath, { range: { start: 1, end: 1 } });
        const v = briefService.getVersion(briefPath, Number(args.version));
        if (!v) throw new DomainError('VERSION_NOT_FOUND', `version ${args.version} of brief '${briefPath}' not found`);
        return ok(v, 'get_brief_version');
      } catch (err) {
        return fail(err);
      }
    },
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

function composeBody(
  prior: string,
  action: 'replace' | 'append' | 'insert_after_section',
  fragment: string,
  anchor?: string,
  heading?: string,
): string {
  switch (action) {
    case 'replace':
      return fragment;
    case 'append': {
      if (prior.trim().length === 0) return fragment;
      const sep = prior.endsWith('\n') ? '\n' : '\n\n';
      return `${prior}${sep}${fragment}`;
    }
    case 'insert_after_section':
      if (!anchor && !heading) {
        throw new DomainError('MISSING_TARGET', 'insert_after_section requires anchor or heading');
      }
      return insertAfterSection(prior, fragment, anchor, heading);
  }
}

function insertAfterSection(prior: string, fragment: string, anchor?: string, heading?: string): string {
  const lines = prior.split('\n');
  let targetLine = -1;
  let targetLevel = -1;
  const matches: Array<{ line: number; level: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const level = m[1]!.length;
    const text = m[2]!.trim();
    if (anchor) {
      const prev = i > 0 ? lines[i - 1]! : '';
      const am = prev.match(ANCHOR_LINE_RE);
      if (am && am[1] === anchor) {
        targetLine = i;
        targetLevel = level;
        break;
      }
    } else if (heading && text === heading.trim()) {
      matches.push({ line: i, level });
    }
  }

  if (targetLine === -1 && heading && !anchor) {
    if (matches.length === 0) {
      // Fallback: spec mówi "unknown anchor → fallback append-at-end + warning"
      // dla brief, przyjmujemy ten sam fallback dla heading mismatch (deterministyczny).
      return prior.endsWith('\n') ? `${prior}\n${fragment}` : `${prior}\n\n${fragment}`;
    }
    if (matches.length > 1) {
      throw new DomainError('AMBIGUOUS_HEADING', `heading "${heading}" matches ${matches.length} sections`);
    }
    targetLine = matches[0]!.line;
    targetLevel = matches[0]!.level;
  }

  if (targetLine === -1) {
    // Anchor podany, ale nie znaleziono — fallback append-at-end (M21 spec).
    return prior.endsWith('\n') ? `${prior}\n${fragment}` : `${prior}\n\n${fragment}`;
  }

  let endLine = lines.length;
  for (let i = targetLine + 1; i < lines.length; i++) {
    const m = lines[i]!.match(HEADING_RE);
    if (m && m[1]!.length <= targetLevel) {
      endLine = i;
      break;
    }
  }
  const before = lines.slice(0, endLine).join('\n');
  const after = lines.slice(endLine).join('\n');
  const sep = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const afterSep = after.length > 0 ? '\n\n' : '';
  return `${before}${sep}${fragment}${afterSep}${after}`.replace(/\n{3,}/g, '\n\n');
}
