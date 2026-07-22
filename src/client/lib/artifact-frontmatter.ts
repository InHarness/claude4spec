/**
 * Splice a new body onto an artifact file's EXISTING frontmatter block.
 *
 * `PUT /api/artifacts/:kind/:path/content` replaces the WHOLE file, but the
 * tiptap editors (`PlanEditor`, `BriefEditor`, `PatchEditor`) only ever hold the
 * body — so the frontmatter has to be put back on before sending. Without it
 * the server parses a file with no frontmatter at all and rejects the save as
 * mutating every immutable key ("cannot mutate immutable frontmatter keys:
 * type, created_at, created_by").
 *
 * Deliberately string surgery rather than `gray-matter.stringify`: gray-matter
 * is a Node library that reaches for `Buffer`, which does not exist in the
 * browser bundle. Calling it client-side throws `Buffer is not defined` from
 * inside the save handler, which is exactly how brief autosave and plan Save
 * both came to fail silently. Copying the original bytes verbatim is also
 * strictly better than re-serializing: it cannot reorder keys, restyle quotes
 * or reformat dates, so a body-only edit produces a body-only diff.
 */
export function withFrontmatterOf(rawContent: string, newBody: string): string {
  // The middle group is optional so an EMPTY block (`---\n---\n`) still
  // matches — otherwise it falls through and the delimiters are dropped, and
  // the server then rejects the save for mutating every immutable key. The
  // leading `\uFEFF?` keeps a UTF-8 BOM from defeating the `^---` anchor;
  // gray-matter strips one server-side, so a BOM'd file parses fine there and
  // would otherwise only break here.
  const match = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*\r?\n?/.exec(rawContent);
  // No frontmatter to preserve (hand-written file, or a kind that has none) —
  // the body IS the whole file.
  return match ? `${match[0]}${newBody}` : newBody;
}
