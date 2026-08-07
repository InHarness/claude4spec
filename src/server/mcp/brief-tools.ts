/**
 * M21 brief-tools MCP server.
 *
 * Two tools (get_brief, update_brief) — no `create_brief`/`list_briefs`/
 * `brief_generate` (UI/user surface, not agent loop).
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
 * REQUIRED `brief` argument instead. The distinction is not cosmetic: falling
 * back to "the" brief on a channel that never had one is how an update lands in
 * a file the caller did not name. `PROFILES.brief.requiresExplicitBriefTarget`
 * is what selects this mode, and it exists so that the fallback cannot be
 * reintroduced by accident.
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import type { BriefService } from '../services/brief.js';
import { ConflictError } from '../services/brief.js';
import { DomainError } from '../services/tags.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';

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

/** The `brief` argument of the explicit mode, described once for both tools. */
const EXPLICIT_BRIEF_ARG = {
  brief: z
    .string()
    .describe(
      'Path of the brief relative to `briefsDir`, e.g. `0-2-12-to-0-2-13.md`. Required: this connection has no thread, so there is no default brief. List the candidates with the brief artifact read operations.',
    ),
};

const AGENT_ACTIONS = z.enum(['replace', 'append', 'insert_after_section']);
const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const HEADING_RE = /^(#{2,6})\s+(.+?)\s*$/;

export function buildBriefToolsServer(
  ctx: BriefToolsContext | ExplicitBriefToolsContext,
): CapturedMcpServer {
  const { briefService } = ctx;
  const explicit = 'target' in ctx;
  /**
   * The thread's brief in `thread` mode; in `explicit` mode there is none, and
   * `resolveBrief` reads the call's own argument instead.
   */
  const ambientBriefPath = explicit ? null : ctx.briefPath;

  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    let code = 'INTERNAL';
    let message = err instanceof Error ? err.message : String(err);
    if (err instanceof DomainError) code = err.code;
    else if (err instanceof ConflictError) code = err.code;
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }) }],
      isError: true,
    };
  };

  /**
   * The one place the two addressing modes differ at runtime.
   *
   * In `explicit` mode the zod schema already marks `brief` required, so a
   * client that omits it is rejected before the handler runs. This guard is for
   * what the schema cannot express — a present-but-empty string — and it fails
   * the same way, naming the field, rather than resolving to `briefsDir` itself.
   */
  const resolveBrief = (args: Record<string, unknown>): string => {
    if (!explicit) return ambientBriefPath!;
    const raw = typeof args.brief === 'string' ? args.brief.trim() : '';
    if (raw === '') {
      throw new DomainError(
        'VALIDATION',
        'brief is required: this connection has no thread, so there is no default brief to fall back on',
      );
    }
    return raw;
  };

  const getBrief = mcpTool(
    'get_brief',
    [
      explicit
        ? 'Read the full current state of the brief named by `brief`.'
        : 'Read the full current state of the brief attached to this thread.',
      'Returns { frontmatter, body, content, hash }. Use `hash` as `expectedHash`',
      'in the next `update_brief` call to detect concurrent edits.',
      'Brief lives on disk under `briefsDir`; you do NOT have filesystem access',
      '(no Read/Write/Edit) — this tool is the only way to read brief content.',
    ].join(' '),
    explicit ? { ...EXPLICIT_BRIEF_ARG } : {},
    async (args) => {
      try {
        const brief = await briefService.getBrief(resolveBrief(args));
        return ok(brief);
      } catch (err) {
        return fail(err);
      }
    },
  );

  const updateBrief = mcpTool(
    'update_brief',
    [
      'Edit the brief markdown body. Three actions:',
      '- replace: full rewrite (provide complete markdown in `content`).',
      '- append: append fragment at end of body.',
      '- insert_after_section: insert fragment after a section identified by `anchor`',
      '  (preferred — 8-char nanoid in `<!-- anchor: ... -->`) or `heading` (text match).',
      'You CANNOT modify frontmatter (type, source, from_release, to_release, roots,',
      'generated_at, generator_version, implemented). `roots` is the brief scope (the',
      "releasable roots this brief covers; absent = whole-release) — pass it to release_diff",
      'as `roots` to keep the diff scoped to this brief. `implemented` is owned by the',
      'implementer-agent in the target repo and toggled via filesystem edit, not via this MCP.',
      'Any frontmatter mutation attempt → IMMUTABLE_FIELD.',
      'Optional `expectedHash` (sha256 from get_brief) enables optimistic concurrency —',
      'mismatch → BRIEF_CONFLICT (re-read brief before retrying).',
      'Each mutation captures a row in file_version with changed_by="agent".',
    ].join(' '),
    {
      ...(explicit ? EXPLICIT_BRIEF_ARG : {}),
      action: AGENT_ACTIONS,
      content: z.string(),
      anchor: z.string().optional(),
      heading: z.string().optional(),
      expectedHash: z.string().optional(),
      changeSummary: z.string().optional(),
    },
    async (args) => {
      try {
        const briefPath = resolveBrief(args);
        const action = args.action as 'replace' | 'append' | 'insert_after_section';
        const current = await briefService.getBrief(briefPath);
        const newBody = composeBody(
          current.body,
          action,
          String(args.content ?? ''),
          typeof args.anchor === 'string' ? args.anchor : undefined,
          typeof args.heading === 'string' ? args.heading : undefined,
        );
        // Reconstruct full content with original frontmatter (immutable for agent).
        const matter = await import('gray-matter');
        const newContent = matter.default.stringify(newBody, current.frontmatter as Record<string, unknown>);
        const result = await briefService.updateContent({
          path: briefPath,
          content: newContent,
          expectedHash: typeof args.expectedHash === 'string' ? args.expectedHash : current.hash,
          changedBy: 'agent',
          changeSummary: typeof args.changeSummary === 'string' ? args.changeSummary : undefined,
        });
        return ok({ newHash: result.newHash });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'brief-tools',
    tools: [getBrief, updateBrief],
  });
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
      const am = prev.match(ANCHOR_RE);
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
