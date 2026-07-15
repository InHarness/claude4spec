/**
 * M21 brief-tools MCP server. Per-thread instance (analog `plan-tools` from
 * M10) — `briefPath` is captured from `chat_thread.brief_path` at thread
 * creation time. Mounted by `routes/chat.ts` ONLY for threads with
 * `context_type='brief'`.
 *
 * Two tools (get_brief, update_brief) — no `create_brief`/`list_briefs`/
 * `brief_generate` (UI/user surface, not agent loop).
 */

import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
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

const AGENT_ACTIONS = z.enum(['replace', 'append', 'insert_after_section']);
const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const HEADING_RE = /^(#{2,6})\s+(.+?)\s*$/;

export function buildBriefToolsServer(ctx: BriefToolsContext): McpServerInstance {
  const { briefService, briefPath } = ctx;

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

  const getBrief = mcpTool(
    'get_brief',
    [
      'Read the full current state of the brief attached to this thread.',
      'Returns { frontmatter, body, content, hash }. Use `hash` as `expectedHash`',
      'in the next `update_brief` call to detect concurrent edits.',
      'Brief lives on disk under `briefsDir`; you do NOT have filesystem access',
      '(no Read/Write/Edit) — this tool is the only way to read brief content.',
    ].join(' '),
    {},
    async () => {
      try {
        const brief = await briefService.getBrief(briefPath);
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
      action: AGENT_ACTIONS,
      content: z.string(),
      anchor: z.string().optional(),
      heading: z.string().optional(),
      expectedHash: z.string().optional(),
      changeSummary: z.string().optional(),
    },
    async (args) => {
      try {
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
