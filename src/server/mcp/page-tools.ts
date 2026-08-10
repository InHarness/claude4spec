import { z } from 'zod';
import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';
import {
  createPage,
  deletePage,
  updatePage,
  updateSection,
  type PageWriteTarget,
  type SectionWriteDeps,
} from '../services/page-write.js';

/**
 * `page-tools` — the sanctioned page write path, item 28 of 0.2.13.
 *
 * ## Why this server had to exist before anything could be locked down
 *
 * The brief blocks the agent's built-in `Write`/`Edit` from writing a page and
 * names four operations as the replacement. Three of them (`create_page`,
 * `update_page`, `delete_page`) had a REST rendering and no other; the fourth
 * (`update_section`) had no write path at all. So the lockdown could not come
 * first: closing the built-in channel before opening this one would have left
 * the chat agent unable to edit the specification it exists to edit.
 *
 * ## Every tool here is an adapter, and nothing more
 *
 * The contract lives in `services/page-write.ts` — the same functions
 * `routes/pages.ts` calls. That is the catalog's "one function per operation"
 * invariant made structural rather than aspirational: there is no behaviour in
 * this file that REST does not get, and none in REST that this does not.
 *
 * What DOES differ is the actor: these writes are stamped `'agent'`, REST's are
 * stamped `'user'`. It is the one axis on which the channel legitimately says
 * something the operation does not, because it is a fact about who called.
 *
 * ## Gating comes for free
 *
 * Registered on the plugin host like `reference-tools`, so it reaches the
 * internal turn and the external MCP mount through the same `buildMcpServers()`
 * both already read — no edit to either channel. All four operations declare
 * `opClass: 'write'`, so the profile gate withholds them from `ask` and drops
 * this server entirely for a profile left with nothing (`brief` never sees it at
 * all: its plugin pool is narrowed to release-tools).
 */
export interface PageToolsDeps extends SectionWriteDeps {
  /** Root ids the caller may address, for the error that lists them. */
  rootIds: () => string[];
}

export function createPageToolsServer(deps: PageToolsDeps): CapturedMcpServer {
  /**
   * The shared envelope, not a local pair.
   *
   * `toolFailure` forwards `hint` and `ConflictError.currentHash` — the latter is
   * the entire remedy for a `PAGE_CONFLICT` (re-read, re-apply, pass it back), so
   * a generic `err.message` mapping turns a recoverable conflict into a dead end.
   * That is why this file had its own `fail` to begin with; it now lives in
   * `operations/envelope.ts`, where every tool server gets it.
   */
  const ok = (data: unknown, operation: string) => toolSuccess(data, { operation, channel: 'mcp' });
  const fail = toolFailure;

  const target = (rootId: string): PageWriteTarget => {
    const rt = deps.resolveRoot(rootId);
    if (!rt) {
      throw new DomainError(
        'ROOT_NOT_FOUND',
        `root '${rootId}' not found`,
        `active roots: [${deps.rootIds().join(', ')}]`,
      );
    }
    return rt;
  };

  const rootIdParam = z
    .string()
    .describe('Page root id. Part of a page\'s identity — `(rootId, path)` — not a filter.');
  const pathParam = z.string().describe('Page path relative to the root, e.g. "guides/auth.md".');
  const expectedHashParam = z
    .string()
    .optional()
    .describe(
      'sha256 of the full file as you last read it (the `hash` from get_page/a previous write). ' +
        'Mismatch → PAGE_CONFLICT carrying the current hash. Omit only when overwriting deliberately.',
    );

  const createPageTool = mcpTool(
    'create_page',
    'Create a page that does not exist yet. Fails PAGE_EXISTS rather than overwriting — use update_page for an existing one.',
    {
      rootId: rootIdParam,
      path: pathParam,
      content: z.string().optional().describe('Initial markdown body. Defaults to empty.'),
    },
    async (args) => {
      try {
        return ok(
          await createPage(
            target(String(args.rootId)),
            {
              path: String(args.path),
              ...(args.content !== undefined ? { content: String(args.content) } : {}),
            },
            'agent',
          ),
          'create_page',
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const updatePageTool = mcpTool(
    'update_page',
    'Write a page in full — body and optional frontmatter. Creates it if absent, so this is the create-or-replace primitive; `update_section` is the punctual variant.',
    {
      rootId: rootIdParam,
      path: pathParam,
      body: z.string().describe('The complete markdown body, frontmatter excluded.'),
      frontmatter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Replaces the frontmatter wholesale when given; omit to write a page without any.'),
      expectedHash: expectedHashParam,
    },
    async (args) => {
      try {
        return ok(
          await updatePage(
            target(String(args.rootId)),
            {
              path: String(args.path),
              body: String(args.body),
              ...(args.frontmatter !== undefined
                ? { frontmatter: args.frontmatter as Record<string, unknown> }
                : {}),
              ...(args.expectedHash !== undefined ? { expectedHash: String(args.expectedHash) } : {}),
            },
            'agent',
          ),
          'update_page',
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const deletePageTool = mcpTool(
    'delete_page',
    'Delete a page. The previous content stays recoverable through its version history.',
    { rootId: rootIdParam, path: pathParam },
    async (args) => {
      try {
        return ok(await deletePage(target(String(args.rootId)), { path: String(args.path) }, 'agent'), 'delete_page');
      } catch (err) {
        return fail(err);
      }
    },
  );

  const updateSectionTool = mcpTool(
    'update_section',
    'Replace one section\'s body, addressed by anchor. Read-modify-write of the whole page under the hood — a convenience over update_page, not a separate store.',
    {
      anchor: z.string().describe('The section anchor, from get_sections / list_sections.'),
      content: z
        .string()
        .describe(
          'The replacement body, heading line EXCLUDED — exactly the shape get_sections returns. ' +
            'The heading and the anchor comment are preserved; rewrite a heading with update_page.',
        ),
      expectedHash: expectedHashParam,
    },
    async (args) => {
      try {
        return ok(
          await updateSection(
            deps,
            {
              anchor: String(args.anchor),
              content: String(args.content),
              ...(args.expectedHash !== undefined ? { expectedHash: String(args.expectedHash) } : {}),
            },
            'agent',
          ),
          'update_section',
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'page-tools',
    tools: [createPageTool, updatePageTool, deletePageTool, updateSectionTool],
  });
}
