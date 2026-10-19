/**
 * 2.1.25 (the `Tag` type of the `ui-kit-component` record `tag-filter-bar`, M18 `mn59j0le`) — the Host UI Kit's one tag type, as a
 * plugin author's compiler sees it.
 *
 * Each compile is an author's browser-leg file: the browser ambient leg as the
 * only reference, the package's published subpaths mapped to the declaration
 * sources `build:types` emits them from (`src/plugin-types/{plugin-runtime,ui}.ts`)
 * — the same set-up as `ambient-legs.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const typesDir = path.join(process.cwd(), 'src', 'plugin-types');
const BROWSER_AMBIENT = path.join(typesDir, 'ambient.d.ts');
const PUBLISHED_PATHS: Record<string, string[]> = {
  '@inharness-ai/claude4spec/plugin-runtime': [path.join(typesDir, 'plugin-runtime.ts')],
  '@inharness-ai/claude4spec/plugin-runtime/ui': [path.join(typesDir, 'ui.ts')],
};

/** Compile `source` as a plugin author's browser-leg file; return its diagnostics. */
function compileAuthorFile(source: string): string[] {
  const fixture = path.join(os.tmpdir(), `c4s-tag-type-author-${process.pid}`, 'author.tsx');
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    paths: PUBLISHED_PATHS,
  };
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (f) => (f === fixture ? true : fileExists(f));
  host.readFile = (f) => (f === fixture ? source : readFile(f));
  host.getSourceFile = (f, lang, onError, create) =>
    f === fixture ? ts.createSourceFile(f, source, lang, true) : getSourceFile(f, lang, onError, create);
  const program = ts.createProgram([fixture, BROWSER_AMBIENT], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fixture))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const IMPORTS = [
  "import { useTags, type TagListItem } from '@c4s/plugin-runtime';",
  "import type { Tag, TagFilterBarProps, EntityListRowProps, TagPickerProps } from '@c4s/plugin-runtime/ui';",
].join('\n');

describe('the kit\'s one Tag type', () => {
  it('[ac:ac-pozycja-o-ksztalcie-tag-list-item-jes] a tag-list-item is assignable to Tag from @c4s/plugin-runtime/ui without a cast', () => {
    // A plugin hands `useTags()` items straight to every kit slot that takes a
    // tag: the one `Tag`, `TagFilterBar.tags`, `EntityListRow.tagLookup` (a map
    // the plugin builds from the same list) — and to `TagPicker.allTags`, whose
    // inline item shape (2.1.26, record `tag-picker`) the same items also satisfy.
    const source = [
      IMPORTS,
      'declare const items: TagListItem[];',
      'export const one: Tag = items[0]!;',
      'export const all: Tag[] = items;',
      "export const bar: TagFilterBarProps['tags'] = items;",
      "export const lookup: EntityListRowProps['tagLookup'] = new Map(items.map((t) => [t.slug, t]));",
      "export const picker: TagPickerProps['allTags'] = items;",
      'export function useCatalog(): Tag[] { return useTags().data ?? []; }',
    ].join('\n');
    // No adapter and no cast: the fixture never converts an item.
    expect(source).not.toMatch(/\bas\b|<Tag>|\.map\(\(t\) => \(\{/);
    expect(compileAuthorFile(source)).toEqual([]);

    // The check is real: a shape that is not a tag (no `name`) is refused.
    expect(
      compileAuthorFile(`${IMPORTS}\ndeclare const items: { slug: string }[];\nexport const all: Tag[] = items;`).length,
    ).toBeGreaterThan(0);
  });

  it('[section:mn59j0le] useTags().data items go to TagPicker.allTags, to the /ui Tag and into an EntityListRow tagLookup as they are', () => {
    // 2.1.28: the item is assignable to `Tag` (record `tag-filter-bar`), the
    // plugin builds `tagLookup` from the same list, and the item is also
    // assignable to the `allTags` prop of the `experimental` TagPicker, typed
    // `Tag[]` since 2.1.41.
    const source = [
      IMPORTS,
      'export function useKitInputs() {',
      '  const items = useTags().data ?? [];',
      "  const allTags: TagPickerProps['allTags'] = items;",
      '  const tags: Tag[] = items;',
      "  const tagLookup: EntityListRowProps['tagLookup'] = new Map(items.map((t) => [t.slug, t]));",
      '  return { allTags, tags, tagLookup };',
      '}',
    ].join('\n');
    expect(source).not.toMatch(/\bas\b/);
    expect(compileAuthorFile(source)).toEqual([]);

    // Not vacuous: an item without `name` does not satisfy the picker.
    expect(
      compileAuthorFile(`${IMPORTS}\ndeclare const items: { slug: string }[];\nexport const allTags: TagPickerProps['allTags'] = items;`).length,
    ).toBeGreaterThan(0);
  });

  it('2.1.41: TagPicker.allTags is typed Tag[] — a literal with description is accepted', () => {
    // 2.1.26–2.1.40 typed the item inline as `{ slug; name; color? }`, so a fresh
    // literal carrying `description` was an excess property. Since 2.1.41 the
    // prop is the public `Tag[]`, and `description` is part of the item.
    const withDescription = [
      IMPORTS,
      'export const props: TagPickerProps = {',
      "  allTags: [{ slug: 'billing', name: 'Billing', color: null, description: 'Payment flows' }],",
      '  selected: [],',
      '  onToggle() {},',
      '};',
      "export const asTags: Tag[] = props.allTags;",
      "export const back: TagPickerProps['allTags'] = asTags;",
    ].join('\n');
    expect(compileAuthorFile(withDescription)).toEqual([]);

    // Still a real check: a key `Tag` does not declare is an excess property.
    const unknownKey = [
      IMPORTS,
      'export const props: TagPickerProps = {',
      "  allTags: [{ slug: 'billing', name: 'Billing', counts: 3 }],",
      '  selected: [],',
      '  onToggle() {},',
      '};',
    ].join('\n');
    expect(compileAuthorFile(unknownKey).length).toBeGreaterThan(0);
  });
});

describe('2.1.40 — Tag from the root of @c4s/plugin-runtime (M18) and the row slot\'s tagLookup (M13)', () => {
  const ROOT_IMPORTS = [
    "import { useTags, type Tag, type TagListItem, type EntityRowProps } from '@c4s/plugin-runtime';",
    "import type { Tag as UiTag, EntityListRowProps } from '@c4s/plugin-runtime/ui';",
  ].join('\n');

  it('the package root exports Tag; a TagListItem is assignable to it without a cast; /ui names the same type', () => {
    const source = [
      ROOT_IMPORTS,
      'declare const items: TagListItem[];',
      'export const one: Tag = items[0]!;',
      'export const all: Tag[] = items;',
      'export function useCatalog(): Tag[] { return useTags().data ?? []; }',
      // The same type under both names, in both directions.
      'export const viaUi: UiTag = one;',
      'export const back: Tag = viaUi;',
    ].join('\n');
    // No cast in the body (the import alias `Tag as UiTag` is not one).
    expect(source.slice(ROOT_IMPORTS.length)).not.toMatch(/\bas\b/);
    expect(compileAuthorFile(source)).toEqual([]);
  });

  it('Tag carries no counts', () => {
    const diagnostics = compileAuthorFile(
      `${ROOT_IMPORTS}\nexport const t: Tag = { slug: 'a', name: 'A', counts: {} };`,
    );
    expect(diagnostics.join('\n')).toMatch(/counts/);
  });

  it('EntityRowProps requires a read-only tagLookup the slot passes on to EntityListRow', () => {
    const ok = [
      ROOT_IMPORTS,
      "export function rowLookup(p: EntityRowProps<{ tags: string[] }>): EntityListRowProps['tagLookup'] {",
      '  return p.tagLookup;',
      '}',
      "export const props: EntityRowProps<{ tags: string[] }> = { slug: 's', entity: { tags: [] }, tagLookup: new Map<string, Tag>() };",
    ].join('\n');
    expect(compileAuthorFile(ok)).toEqual([]);

    // Required: a row props value without it does not compile.
    const missing = compileAuthorFile(
      `${ROOT_IMPORTS}\nexport const props: EntityRowProps<number> = { slug: 's', entity: 1 };`,
    );
    expect(missing.join('\n')).toMatch(/tagLookup/);

    // Read-only: the slot cannot mutate the host's shared map.
    const mutate = compileAuthorFile(
      `${ROOT_IMPORTS}\nexport function f(p: EntityRowProps<number>) { p.tagLookup.set('x', { slug: 'x', name: 'X' }); }`,
    );
    expect(mutate.join('\n')).toMatch(/set/);
  });
});
