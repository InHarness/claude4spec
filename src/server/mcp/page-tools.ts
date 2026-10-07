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

  const createPageTool = mcpTool(
    'create_page',
    [
      'Create a page that does not exist yet. Fails PAGE_EXISTS rather than overwriting — use update_page for an existing one.',
      'Returns { rootId, path, hash, version, content, anchors }. `content` is the file AS IT SETTLED: omit `content` and it is the generated template, and in either case the reaction chain has already injected `<!-- anchor: … -->` comments for your headings. Edit from it, not from what you sent.',
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

  const updatePageTool = mcpTool(
    'update_page',
    [
      'Write a page. Creates it if absent, so this is the create-or-replace primitive; `update_sections` is the section-scoped variant.',
      'TWO MODES, EXACTLY ONE PER CALL. Literal: `body` (the complete markdown, plus optional `frontmatter`). Differential: `textEdits`, a list of literal find/replaceWith substitutions. Sending both, or neither, is INVALID_ARGUMENT — a write with no description of its new content is a mistake, not an empty write.',
      '`expectedHash` is REQUIRED in BOTH modes.',
      'DIFFERENTIAL SCOPE IS THE WHOLE FILE — frontmatter and the preamble above the first heading included. It is the only punctual write that reaches text no anchor addresses, or any text at all on a root with no section index.',
      'The batch is a SET, not a sequence: every `find` is matched against the file as it stands BEFORE the call, so substitutions never cascade and order never matters. Matches may not overlap or contain one another (INVALID_ARGUMENT).',
      'NOT IDEMPOTENT in differential mode. Repeating a successful call with a refreshed expectedHash answers FIND_NOT_FOUND, because the text you looked for is gone — treat it like `delete`, not like `replace`. Literal `body` mode stays idempotent.',
      'Changing a heading\'s TEXT is no longer a reason to come here: `update_sections` carries a `rename` action that rewrites the heading line and keeps the anchor, whereas a `find` swallowing the anchor comment destroys it and needs `dropAnchors`.',
      'ANCHOR LOSS, IN BOTH MODES: if the write removes an `<!-- anchor: … -->` comment that something cites, it is refused with ANCHOR_LOSS (400) naming each anchor and who cites it. Name those anchors in `dropAnchors` to go ahead. In differential mode the touched scope is the matched fragments, so every entry must lie inside one; in literal `body` mode it is the whole page, so every entry must be an anchor this page has now (otherwise INVALID_ARGUMENT). To rewrite a page wholesale, assemble the body from get_page: preamble, then per item its anchor line, heading line and body — an anchor you leave out is a loss. The guard does not run on a root without a section index.',
      'Returns { hash, version, changedAnchors }, plus `replacements` in differential mode and `droppedAnchors` when the write removed any anchor. The page is NOT returned. The write-back phase injects `<!-- anchor: … -->` comments for headings you introduced, so the bytes on disk are NOT the bytes you sent: if you need them — e.g. to write the whole page again without stripping those anchors — re-read it with `get_page`. Treat a literal write as having changed the text you hold whenever your body adds headings or omits existing anchor comments — re-read before the next whole-page write or a `find` that spans a heading line. `changedAnchors` lists sections that changed relative to the page BEFORE this write, not relative to what you sent: an empty list does NOT mean the file equals your body.',
    ].join('\n'),
    {
      rootId: rootIdParam,
      path: pathParam,
      body: z
        .string()
        .optional()
        .describe(
          'LITERAL MODE: the complete markdown — the body, with the frontmatter sent beside it in `frontmatter`, or ' +
            'the whole file assembled from get_page (`frontmatter.raw`, preamble, then per item its anchor line, ' +
            'heading line and body) with `frontmatter` omitted. Mutually exclusive with textEdits.',
        ),
      frontmatter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('LITERAL MODE only — replaces the frontmatter wholesale; omit to write a page without any.'),
      textEdits: textEditsParam
        .optional()
        .describe('DIFFERENTIAL MODE: substitutions applied to the whole file. Mutually exclusive with body.'),
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
      'Edit one or more sections of ONE page, addressed by anchor. Read-modify-write of the whole page under the hood — a convenience over update_page, not a separate store.',
      'Actions: `replace` (swap the section\'s OWN body), `append` (add at the end of the section\'s OWN body, before its first subsection), `insert_after` (add after the section and its subsections), `delete` (remove the SUBTREE with its heading and anchor), `edit` (substitute literal fragments inside the subtree), `rename` (rewrite the heading line). EXACTLY ONE field per action: `content` for replace/append/insert_after, `textEdits` for `edit`, `heading` for `rename`, and nothing at all for `delete`. Any other combination — a field the action does not take, or its own field missing — is INVALID_ARGUMENT for the WHOLE batch.',
      '`rename` rewrites the heading LINE ALONE — level and anchor preserved, body untouched. It is IDEMPOTENT by heading text: repeating it with the same text succeeds and leaves the page identical, because it matches nothing literally and so has nothing to fail to find. It never drops an anchor, so it can never trip ANCHOR_LOSS — and neither can `replace` or `append`.',
      '`edit` matches LITERALLY, byte for byte, inside the addressed subtree only — from its anchor line, heading included. One `edit` entry may carry many substitutions; a second `edit` element on the same anchor is refused. Omitting `expectedMatches` means EXACTLY 1. Zero hits → FIND_NOT_FOUND (with a whitespace-normalization diagnosis); wrong count → MATCH_COUNT_MISMATCH (with each hit as anchor + line).',
      'SECTION SCOPE VS PAGE SCOPE: `update_page` with `textEdits` covers everything this covers, since a literal `find` can be made unique page-wide. The section scope buys two things — a shorter `find`, needing no disambiguating context, and a narrower space to hit by accident. Use the section when the target sits in one known section; use the page when it crosses sections or lies outside all of them.',
      '`edit` is NOT idempotent, and one `edit` costs the WHOLE BATCH its idempotence, because the batch is all-or-nothing. Replaying a successful one answers FIND_NOT_FOUND. Its `find` is always matched on the page as you read it, never on text the same batch writes.',
      '`delete`, `insert_after` and the `edit` match window act on the SUBTREE (a `##` with three `###` is all four). `replace` and `append` act on the OWN BODY — what get_sections returns, below the heading, above the first subsection — and refuse a `content` heading at or above the section\'s level. The heading changes only through `rename`; the subsections and their anchors are never touched by `replace`. ONE ANCHOR MAY CARRY SEVERAL ACTIONS — `rename` + `replace` rewrites a whole section in ONE batch. Which elements collide is spelled out under `edits`.',
      'ANCHOR LOSS: `delete` destroys the anchor comments of the subsections it spans, an `edit` whose `find` swallows an `<!-- anchor: … -->` comment destroys that anchor — and content that opens a code block nothing closes turns every section below it into code, swallowing their anchors too. An anchor-shaped line inside a code block is an example, never an anchor, and never counts. If a destroyed anchor is cited anywhere (`<section_ref/>` or a `page.md#anchor` link) the WHOLE batch is refused with ANCHOR_LOSS (400), listing each anchor, its heading text and who cites it. To go ahead anyway, name those anchors in `dropAnchors`; to keep them, use `replace` on the parent instead of deleting the subtree, or narrow the `find`. Dropping an UNCITED anchor is never refused — it is just reported.',
      'ANCHOR DUPLICATE: never send an `<!-- anchor: … -->` comment for a NEW heading. Anchor values are minted by the indexer alone, so a comment in your `content` is a copied line: if the value is already held anywhere in the project, or its line ends up over no heading of its own, the WHOLE batch is refused with ANCHOR_DUPLICATE (400) naming where the value currently lives. There is no override — drop the comment and the new heading is given a fresh anchor on the next indexing pass. Moving a section WITHIN one page is unaffected: `delete` plus `insert_after` in the same batch nets to zero, so the anchor survives the move. Between pages, remove it from the source first, then insert it in the target.',
      'All anchors must be on the SAME page (else INVALID_ARGUMENT).',
      'TRANSACTIONAL — unlike every other batch here, there is no partial success: either all edits land or none do. They apply bottom-up regardless of the order you list them, so earlier edits never shift later ones.',
      '`expectedHash` is the PAGE hash and guards the whole batch — which is the point of batching: editing sections one call at a time makes your own hash stale after the first one.',
      'Returns { path, hash, version, results: [{ anchor, action, affectedAnchors, droppedAnchors, addedAnchors }] }, ONE ROW PER ELEMENT in the order you gave them — two rows may share an anchor, so read them by position; no anchor appears in `droppedAnchors` of two rows; an `edit` row also carries `replacements`, and a `rename` row `previousHeading` — the heading text as it stood BEFORE the write, absent (the key missing, not empty) on every other row. It is not an echo: you addressed the section by anchor, so the old text is the one thing you could not have sent. `droppedAnchors` and `addedAnchors` are filled on SUCCESS too — together they are how you see what identities a write cost and what it brought in, so there is no dry-run mode to ask for. For `edit` `droppedAnchors` is measured over the fragments your patterns matched, not over the whole subtree.',
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
          'The edits to apply, all addressing sections of one page. ' +
            "replace — swap the section's OWN BODY — heading and subsections untouched; deeper headings in `content` become its first children, a heading at or above its level is INVALID_ARGUMENT. " +
            "append — add at the end of the section's OWN body, before its first subsection — a heading outside a code block at or above the addressed section's level in `content` is INVALID_ARGUMENT for the whole batch; deeper headings become its first children. " +
            'COLLISIONS — each element CLAIMS part of the page as it was BEFORE the write: `delete` the whole subtree with its anchor line, `replace` the own body, `edit` each matched fragment, `rename` the section\'s HEAD (anchor line + heading line); `append` and `insert_after` claim only a POINT (end of the own body / end of the subtree). The batch is INVALID_ARGUMENT when two claims share a character or a point lies strictly INSIDE a claimed range — whether the elements address one anchor or different ones; a point on a range\'s edge is fine. Also refused: two elements of the SAME action on one anchor (merge the `textEdits` lists, concatenate the `content`), and ANY element addressing an anchor inside a subtree being deleted, that anchor itself included. So `rename` + `replace` + `insert_after` on one anchor is fine, and so is `replace` on a parent next to edits in its subsections. Inserts sharing a position land innermost first — `append` before `insert_after` of the same section, a descendant\'s `insert_after` before its ancestor\'s; an insert on a range\'s edge goes after a range ending there and before one starting there. `results[]` carries one row PER ELEMENT, so two rows may share an anchor — read them by position.',
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
