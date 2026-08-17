import { z } from 'zod';
import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';
import {
  createPage,
  deletePage,
  updatePage,
  updateSections,
  type PageWriteTarget,
  type SectionWriteDeps,
  type UpdateSectionsInput,
} from '../services/page-write.js';

/**
 * `page-tools` — the sanctioned page write path, item 28 of 0.2.13.
 *
 * ## Why this server had to exist before anything could be locked down
 *
 * The brief blocks the agent's built-in `Write`/`Edit` from writing a page and
 * names four operations as the replacement. Three of them (`create_page`,
 * `update_page`, `delete_page`) had a REST rendering and no other; the fourth
 * (`update_sections`, then singular) had no write path at all. So the lockdown could not come
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
  /**
   * 0.2.15 — REQUIRED, not optional. A page has several writers (an agent turn,
   * the editor, a hand edit picked up by the watcher) and a punctual write
   * touches lines the caller never saw in full, so last-write-wins here loses
   * work silently.
   */
  const expectedHashParam = z
    .string()
    .describe(
      'REQUIRED. sha256 of the full file as you last read it (the `hash` from get_page or a previous write). ' +
        'Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT carrying the current hash.',
    );

  const createPageTool = mcpTool(
    'create_page',
    'Create a page that does not exist yet. Fails PAGE_EXISTS rather than overwriting — use update_page for an existing one.',
    {
      rootId: rootIdParam,
      path: pathParam,
      title: z
        .string()
        .optional()
        .describe('Sets the frontmatter `title` of the generated template. Ignored when `content` is given.'),
      content: z
        .string()
        .optional()
        .describe(
          'Full markdown, frontmatter included. Omit it and you get a default template — a frontmatter ' +
            'block with `title`, not an empty file. Overwrite the page afterwards if you truly want it empty.',
        ),
    },
    async (args) => {
      try {
        return ok(
          await createPage(
            target(String(args.rootId)),
            {
              path: String(args.path),
              ...(args.title !== undefined ? { title: String(args.title) } : {}),
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
    'Write a page in full — body and optional frontmatter. Creates it if absent, so this is the create-or-replace primitive; `update_sections` is the punctual variant.',
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

  const updateSectionsTool = mcpTool(
    'update_sections',
    [
      'Edit one or more sections of ONE page, addressed by anchor. Read-modify-write of the whole page under the hood — a convenience over update_page, not a separate store.',
      'Actions: `replace` (swap the body), `append` (add at the end of the body), `insert_after` (add after the section and its subsections), `delete` (remove heading, anchor and body). `content` is required for all but `delete`.',
      'A section is its SUBTREE, not the prose under its heading: `replace` on a `##` carrying three `###` replaces all four sections, and `delete` removes all four. To change only the parent preamble, reproduce the subsections in `content` or edit them separately.',
      'ANCHOR LOSS: because of that, replace/delete destroy the anchor comments of the subsections they span. If a destroyed anchor is cited anywhere (`<section_ref/>` or a `page.md#anchor` link) the WHOLE batch is refused with ANCHOR_LOSS (400), listing each anchor, its heading text and who cites it. To go ahead anyway, name those anchors in `dropAnchors`; to keep them, put their `<!-- anchor: … -->` comments in `content`. Dropping an UNCITED anchor is never refused — it is just reported.',
      'All anchors must be on the SAME page (else INVALID_ARGUMENT), and no anchor may appear twice (INVALID_ARGUMENT).',
      'TRANSACTIONAL — unlike every other batch here, there is no partial success: either all edits land or none do. They apply bottom-up regardless of the order you list them, so earlier edits never shift later ones.',
      '`expectedHash` is the PAGE hash and guards the whole batch — which is the point of batching: editing sections one call at a time makes your own hash stale after the first one.',
      'Returns { path, hash, version, results: [{ anchor, action, affectedAnchors, droppedAnchors }] }, results in the order you gave the edits. `droppedAnchors` is filled on SUCCESS too — it is how you see what identities a write cost, so there is no dry-run mode to ask for.',
    ].join('\n'),
    {
      expectedHash: expectedHashParam,
      edits: z
        .array(
          z.object({
            anchor: z.string().describe('The section anchor, from get_sections / list_sections.'),
            action: z.enum(['replace', 'append', 'insert_after', 'delete']),
            content: z
              .string()
              .optional()
              .describe(
                'The text this edit contributes, heading line EXCLUDED — exactly the shape get_sections returns. ' +
                  'Required for replace / append / insert_after; omitted for delete.',
              ),
          }),
        )
        .min(1)
        .describe('The edits to apply, all addressing sections of one page.'),
      dropAnchors: z
        .array(z.string())
        .optional()
        .describe(
          'Anchors this batch is allowed to destroy. Required only for dropped anchors that are CITED elsewhere — ' +
            'without them the batch is refused with ANCHOR_LOSS. Every entry must be an anchor inside a section the ' +
            'edits address (otherwise INVALID_ARGUMENT); listing more than the batch actually drops is fine, so a ' +
            'repeated call can send the same list unchanged.',
        ),
    },
    async (args) => {
      try {
        return ok(
          await updateSections(
            deps,
            {
              expectedHash: String(args.expectedHash ?? ''),
              edits: (args.edits ?? []) as UpdateSectionsInput['edits'],
              ...(Array.isArray(args.dropAnchors) ? { dropAnchors: args.dropAnchors } : {}),
            },
            'agent',
          ),
          'update_sections',
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'page-tools',
    tools: [createPageTool, updatePageTool, deletePageTool, updateSectionsTool],
  });
}
