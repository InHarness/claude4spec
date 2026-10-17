import { z } from 'zod';
import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';
import {
  createPage,
  deletePage,
  movePage,
  updatePage,
  updateSections,
  type PageWriteTarget,
  type SectionWriteDeps,
  type PageDiffDeps,
  type TextEdit,
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

export function createPageToolsServer(
  deps: PageToolsDeps,
  projectId: string | null = null,
): CapturedMcpServer {
  /**
   * The shared envelope, not a local pair.
   *
   * `toolFailure` forwards `hint` and `ConflictError.currentHash` — the latter is
   * the entire remedy for a `PAGE_CONFLICT` (re-read, re-apply, pass it back), so
   * a generic `err.message` mapping turns a recoverable conflict into a dead end.
   * That is why this file had its own `fail` to begin with; it now lives in
   * `operations/envelope.ts`, where every tool server gets it.
   */
  const ok = (data: unknown, operation: string) =>
    toolSuccess(data, { operation, channel: 'mcp', project: projectId });
  const fail = toolFailure;

  /**
   * 2.1.9 — `resolveRoot` answers the roots WITH A FACADE (kinds whose `sidebar`
   * is not `hidden`), the same set the REST page routes resolve: the domain of
   * `rootId` does not depend on the channel (M02 `o01s9mwl`).
   * 2.1.23 — a `rootId` outside that set is `ROOT_NOT_FOUND` in every channel
   * (the facade roots in `hint`); `NOT_FOUND` is only an unknown page in a
   * known root.
   */
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

  /**
   * The differential branch's extra deps, assembled from what this server was
   * already given. `sections` and `findSectionReferents` come straight from
   * `SectionWriteDeps`, so the guard `update_sections` runs and the guard
   * `update_page` runs are literally the same lookup.
   */
  const diffDeps: PageDiffDeps = {
    sections: deps.sections,
    ...(deps.findSectionReferents ? { findSectionReferents: deps.findSectionReferents } : {}),
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
      'sha256 of the full file as you last read it — the `hash` from get_page, from the get_page_outline envelope, ' +
        'or from your previous write. REQUIRED in both modes. Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT ' +
        'carrying the current hash, so you can refresh and retry instead of overwriting blind.',
    );

  /**
   * 0.2.37 — the differential payload, described identically for both tools
   * because it IS the same shape. Two descriptions of one contract is how the
   * four channels used to drift.
   */
  const textEditsParam = z
    .array(
      z.object({
        find: z
          .string()
          .describe(
            'Searched LITERALLY, byte for byte — no regex, no whitespace normalization. ' +
              'Copy it out of what you just read. Zero hits → FIND_NOT_FOUND, whose envelope tells you ' +
              'whether the pattern would have matched with whitespace collapsed (it usually would: ' +
              'mis-transcribed indentation is the common cause).',
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
   * 2.1.26 — the answer carries `content`, the file AS IT SETTLED (the generated
   * template when no `content` was sent, the anchor comments the reaction chain
   * injected in either case), so the caller edits from the bytes on disk rather
   * than from what it sent. The REST rendering keeps `CreatePageResponse`
   * without it. ASSUMPTION:dev-2604
   */
  const createPageTool = mcpTool(
    'create_page',
    [
      "Create a page that does not exist yet. Fails PAGE_EXISTS rather than overwriting — use update_page for an existing one.",
      "Returns { rootId, path, hash, version, content, anchors }. `content` is the file AS IT SETTLED: omit `content` and it is the generated template, and in either case the reaction chain has already injected `<!-- anchor: … -->` comments for your headings. Edit from it, not from what you sent.",
    ].join('\n'),
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

  /**
   * 2.1.26 — the description is the record's (`page-tools-update-page`), verbatim,
   * the anchor guard of both modes and the shape of the answer included. A
   * literal write is create-or-replace — a page missing from a known root is
   * created, never refused with NOT_FOUND (the `update-page` record). The four hints are
   * the record's and the only ones on this server: the other four page tools
   * declare none (2.1.26 withdrew theirs).
   */
  const updatePageTool = mcpTool(
    'update_page',
    [
      "Write a specification page, addressed by `(rootId, path)`. A literal write creates a missing page (create-or-replace). Describe the new content in ONE of two ways, never both: literally via `body` (the complete markdown, optionally with a `frontmatter` object beside it), or differentially via `textEdits` (literal find/replace substitutions applied to the current file). Both, or neither, is an error.",
      "",
      "For a punctual change inside one section prefer `update_sections` (its `rename` keeps the anchor). Use `textEdits` here when the target crosses sections, lies outside any section (frontmatter, preamble) or the page has no section index; use `body` for a wholesale rewrite.",
      "",
      "DIFFERENTIAL MODE. `find` matches BYTE FOR BYTE — no whitespace normalisation, no regular expressions. `expectedMatches` OMITTED MEANS EXACTLY ONE match; pass a number, or `\"all\"` for every occurrence. All patterns are counted against the content BEFORE the write: a SET of substitutions, not a sequence — two matches may not overlap.",
      "",
      "`expectedHash` is REQUIRED in both modes. It guards one file: N pages are N calls.",
      "",
      "ANCHOR LOSS, IN BOTH MODES: a write removing a cited `<!-- anchor: … -->` comment is refused with ANCHOR_LOSS (400) naming each anchor and who cites it; name those anchors in `dropAnchors` to go ahead. Differential mode: every entry must lie inside a matched fragment. Literal mode: every entry must be an anchor this page has now (otherwise INVALID_ARGUMENT). The guard runs on every page root. Literal mode is idempotent by content; differential mode is NOT — a repeat answers FIND_NOT_FOUND.",
      "",
      "Returns { hash, version, changedAnchors }, plus `replacements` in differential mode and `droppedAnchors` when the write removed any anchor. The page is NOT returned. Anchors are injected for new headings, so the bytes on disk are not the bytes you sent — re-read with `get_page` if you need them; `hash` is taken after that injection. `changedAnchors` is relative to the page BEFORE this write.",
    ].join('\n'),
    {
      rootId: rootIdParam,
      path: pathParam,
      // 2.1.14 — `body` (+ `frontmatter`) is the entity's own name for the literal mode; the old `content` is gone.
      body: z
        .string()
        .optional()
        .describe(
          'LITERAL mode: the complete markdown — either the body alone, with the frontmatter sent beside it in ' +
            '`frontmatter`, or the whole file assembled from get_page (`frontmatter.raw`, preamble, then per item its ' +
            'anchor line, heading line and body) with `frontmatter` omitted. Everything not present here is gone after ' +
            'the write; a page that does not exist yet is created. Mutually exclusive with `textEdits` — giving both, ' +
            'or neither, is INVALID_ARGUMENT.',
        ),
      frontmatter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "LITERAL mode only: replaces the page's frontmatter wholesale. Omit it to write a page without frontmatter, " +
            'or when `body` already carries the whole file, frontmatter block included.',
        ),
      textEdits: textEditsParam
        .optional()
        .describe(
          'DIFFERENTIAL mode: `[{ find, replaceWith, expectedMatches? }]`, matched against the FULL file content ' +
            'INCLUDING frontmatter. `find` is literal, byte for byte. `expectedMatches` omitted means EXACTLY ONE match; ' +
            'a number means exactly that many; `"all"` means every occurrence. Zero matches → FIND_NOT_FOUND, whose ' +
            'envelope tells you how many times the pattern would have matched after whitespace normalisation. A count ' +
            'other than declared → MATCH_COUNT_MISMATCH, carrying the real count and each hit as section anchor + line ' +
            'number. Mutually exclusive with `body`.',
        ),
      dropAnchors: z
        .array(z.string())
        .optional()
        .describe(
          'BOTH modes. Anchors this call is allowed to destroy — needed when the write removes an `<!-- anchor: … -->` ' +
            'comment whose anchor is cited elsewhere; without them the write is refused with ANCHOR_LOSS listing who ' +
            'cites what. In DIFFERENTIAL mode every entry must sit inside a MATCHED fragment, not merely somewhere on ' +
            'the page. In LITERAL (`body`) mode the touched scope is the whole page, so every entry must be an anchor ' +
            'this page has now; an anchor you leave out of the new content and do not name here is refused if anything ' +
            'cites it. The guard runs on every page root — each one has a section index.',
        ),
      expectedHash: expectedHashParam,
    },
    async (args) => {
      try {
        const rootId = String(args.rootId);
        return ok(
          await updatePage(
            target(rootId),
            {
              path: String(args.path),
              ...(args.body !== undefined ? { body: String(args.body) } : {}),
              ...(args.frontmatter !== undefined
                ? { frontmatter: args.frontmatter as Record<string, unknown> }
                : {}),
              ...(args.textEdits !== undefined ? { textEdits: args.textEdits as TextEdit[] } : {}),
              ...(Array.isArray(args.dropAnchors) ? { dropAnchors: args.dropAnchors as string[] } : {}),
              ...(args.expectedHash !== undefined ? { expectedHash: String(args.expectedHash) } : {}),
            },
            'agent',
            diffDeps,
          ),
          'update_page',
        );
      } catch (err) {
        return fail(err);
      }
    },
    // The entity's hints: a write (not read-only) that can destroy content, not idempotent
    // as an operation (the differential mode is not), touching only this project's root.
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
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

  /**
   * 0.2.78 — `move_page`, the operation a rename used to be faked with.
   *
   * The fake was create-at-the-new-path plus delete-at-the-old, and every part
   * of the system that keys on a path paid for it: `file_version` recorded a
   * birth and a death instead of one move, the section index dropped the page's
   * anchors and minted fresh ones for the same headings, and the link map saw a
   * pair of events indistinguishable from somebody else's rename. Naming the act
   * is what lets all three follow it.
   */
  const movePageTool = mcpTool(
    'move_page',
    [
      'Move a page to a different path WITHIN THE SAME ROOT. Renaming a file and moving it to another directory are the same call — only `to` differs.',
      '`to` is a whole path relative to the root, not a bare filename: moving "guides/auth.md" to "auth.md" means to: "auth.md", and to: "auth.md" is NOT how you rename it in place inside `guides/`.',
      'The content is never read, re-serialized or returned, so `hash` comes back UNCHANGED — it is echoed because you need it to arm your next write at the new path, not because anything happened to it.',
      'Citations follow: every `@old/path.md` in the root is rewritten to the new path afterwards, each rewritten page as its own write. That propagation is NOT atomic across those pages, and it is not part of the move — the move has already committed when it runs.',
      'NOT IDEMPOTENT. Replaying a successful call answers NOT_FOUND, because the source is gone — this is the `delete` class, not the `replace` class.',
      'Refusals: PAGE_EXISTS (the destination is occupied — it is never overwritten), PAGE_CONFLICT (your `expectedHash` does not match the source), NOT_FOUND (no page at `from`), INVALID_ARGUMENT (a `to` that leaves this root, or equals `from`). None of them touches either file.',
      'ONE FILE per call. A directory move is N of these with no atomicity between them.',
    ].join('\n'),
    {
      rootId: rootIdParam,
      from: z.string().describe('The page\'s current path relative to the root, e.g. "guides/auth.md".'),
      to: z
        .string()
        .describe(
          'The destination path, relative to the SAME root and complete — directories included. A path outside this root is INVALID_ARGUMENT; a move between roots is not a move.',
        ),
      expectedHash: expectedHashParam,
    },
    async (args) => {
      try {
        const rootId = String(args.rootId);
        return ok(
          await movePage(
            target(rootId),
            rootId,
            { from: String(args.from), to: String(args.to), expectedHash: String(args.expectedHash ?? '') },
            'agent',
            deps.propagateRename,
            deps.rootIds,
          ),
          'move_page',
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const updateSectionsTool = mcpTool(
    'update_sections',
    [
      "Edit sections of ONE page by anchor. All anchors must be on the SAME page (else INVALID_ARGUMENT).",
      "Each action takes EXACTLY ONE field: `replace` (the OWN body), `append` (end of the OWN body, before the first subsection) and `insert_after` (after the subtree) take `content`; `edit` (literal substitutions inside the subtree, heading included) takes `textEdits`; `rename` (the heading line alone, level and anchor kept) takes `heading`; `delete` (the SUBTREE with its heading and anchor) takes nothing. Any other combination is INVALID_ARGUMENT for the WHOLE batch. `replace`/`append` refuse a `content` heading at or above the section's level. One anchor may carry several actions.",
      "`edit` matches BYTE FOR BYTE, on the page as read; one entry may carry many substitutions, a second `edit` on the same anchor is refused. Omitted `expectedMatches` means EXACTLY 1. 0 hits → FIND_NOT_FOUND, wrong count → MATCH_COUNT_MISMATCH. `edit` is NOT idempotent and costs the whole batch its idempotence; `rename` is idempotent by heading text.",
      "ANCHOR LOSS: `delete`, a `find` swallowing an anchor comment, or `content` opening an unclosed code block destroys anchors (an anchor-shaped line inside code never counts). A destroyed CITED anchor refuses the WHOLE batch with ANCHOR_LOSS (400) unless named in `dropAnchors`; an uncited one is only reported. `replace`, `append` and `rename` never drop one.",
      "ANCHOR DUPLICATE: never send an anchor comment for a NEW heading; a value held elsewhere, or over no heading of its own, refuses the WHOLE batch with ANCHOR_DUPLICATE (400), no override.",
      "TRANSACTIONAL, applied bottom-up regardless of order. `expectedHash` is the PAGE hash and guards the whole batch.",
      "Returns { path, hash, version, results }: a row per element, in input order: { anchor, action, affectedAnchors, droppedAnchors, addedAnchors }, `replacements` on `edit`, `previousHeading` (text before the write) on `rename`. Dropped/added anchors are reported on success too.",
    ].join('\n'),
    {
      expectedHash: expectedHashParam,
      edits: z
        .array(
          z.object({
            anchor: z.string().describe('The section anchor, from get_sections / get_page_outline.'),
            action: z.enum(['replace', 'append', 'insert_after', 'delete', 'edit', 'rename']),
            content: z
              .string()
              .optional()
              .describe(
                'The text this edit contributes, heading line EXCLUDED — the shape of a get_sections `body`. ' +
                  '`replace` swaps exactly what get_sections returns (the OWN body, up to the first child heading), ' +
                  'so content read, corrected and sent back leaves the subsections untouched. ' +
                  'Required for replace / append / insert_after; forbidden for delete, edit and rename.',
              ),
            textEdits: textEditsParam
              .optional()
              .describe(
                'Action `edit` only, and required there — the literal substitutions to run inside this subtree.',
              ),
            heading: z
              .string()
              .optional()
              .describe(
                'Action `rename` only, and required there. `heading` is the new heading as PLAIN TEXT — one line, ' +
                  'no leading `#` (the operation keeps the level it finds), no anchor comment, not empty once ' +
                  'trimmed; any of those four is INVALID_ARGUMENT for the whole batch.',
              ),
          }),
        )
        .min(1)
        .describe(
          "The edits to apply, all addressing sections of one page. replace — swap the section's OWN BODY; deeper headings in `content` become its first children, a heading at or above its level is INVALID_ARGUMENT. append — the same, at the end of the own body. COLLISIONS — each element CLAIMS the page as it was BEFORE the write: `delete` the subtree with its anchor line, `replace` the own body, `edit` each matched fragment, `rename` the anchor and heading lines; `append` and `insert_after` claim only a POINT. INVALID_ARGUMENT when two claims share a character or a point lies strictly INSIDE a claim (an edge is fine), for two elements of the SAME action on one anchor, and for ANY element addressing an anchor inside a deleted subtree. Inserts sharing a position land innermost first — `append` before `insert_after` of the same section, a descendant's before its ancestor's. `results[]` carries one row PER ELEMENT; read them by position.",
        ),
      dropAnchors: z
        .array(z.string())
        .optional()
        .describe(
          'Anchors this batch is allowed to destroy. Required only for dropped anchors that are CITED elsewhere — ' +
            'without them the batch is refused with ANCHOR_LOSS. Every entry must lie inside the scope the batch ' +
            'actually TOUCHES: the addressed subtree for `delete` and `insert_after`, the matched fragments for ' +
            '`edit`, the sections a never-closed code block in `content` swallows, and NOTHING at all for `replace` ' +
            'and `append`, which write only the section\'s own body, or for `rename`, which writes only its heading ' +
            'line — so none of those three can drop an anchor, and naming one there (a subsection under a ' +
            '`replace` included) is INVALID_ARGUMENT; listing MORE than the batch actually drops inside that scope ' +
            'is fine, so a repeated call can send the same list unchanged.',
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
    tools: [createPageTool, updatePageTool, deletePageTool, movePageTool, updateSectionsTool],
  });
}
