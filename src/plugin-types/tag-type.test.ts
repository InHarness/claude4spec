/**
 * 2.1.25 (M34 `hpw2opbb`, M18 `mn59j0le`) — the Host UI Kit's one tag type, as a
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
  "import type { Tag, TagBarProps, EntityListRowProps, TagPickerProps } from '@c4s/plugin-runtime/ui';",
].join('\n');

describe('[section:hpw2opbb] the kit\'s one Tag type', () => {
  it('[ac:ac-pozycja-o-ksztalcie-tag-list-item-jes] a tag-list-item is assignable to Tag from @c4s/plugin-runtime/ui without a cast', () => {
    // A plugin hands `useTags()` items straight to every kit slot that takes a
    // tag: the one `Tag`, `TagFilterBar.tags`, `EntityListRow.tagLookup` (a map
    // the plugin builds from the same list) — and to `TagPicker.allTags`, whose
    // inline item shape (2.1.26, `d97023iq`) the same items also satisfy.
    const source = [
      IMPORTS,
      'declare const items: TagListItem[];',
      'export const one: Tag = items[0]!;',
      'export const all: Tag[] = items;',
      "export const bar: TagBarProps['tags'] = items;",
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

  it('[section:hpw2opbb] 2.1.26: TagPicker.allTags is not a consumer of Tag — its item shape is inline, without description', () => {
    // The inline `{ slug; name; color? }` item takes a tag without a description.
    const ok = [
      IMPORTS,
      'export const props: TagPickerProps = {',
      "  allTags: [{ slug: 'billing', name: 'Billing', color: null }],",
      '  selected: [],',
      '  onToggle() {},',
      '};',
      "export const minimal: Tag = { slug: 'billing', name: 'Billing', description: 'Payment flows' };",
    ].join('\n');
    expect(compileAuthorFile(ok)).toEqual([]);

    // `description` belongs to `Tag`, not to the picker item: a fresh literal
    // carrying it is an excess property, so `allTags` is NOT typed as `Tag[]`.
    const withDescription = [
      IMPORTS,
      'export const props: TagPickerProps = {',
      "  allTags: [{ slug: 'billing', name: 'Billing', description: 'Payment flows' }],",
      '  selected: [],',
      '  onToggle() {},',
      '};',
    ].join('\n');
    const diagnostics = compileAuthorFile(withDescription);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.join('\n')).toMatch(/description/);
  });
});
