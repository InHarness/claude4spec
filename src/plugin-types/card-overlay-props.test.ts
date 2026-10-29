/**
 * 2.1.63 (M13 chipprops / z7l89jhf, M33 m33load01) — the card and overlay slot
 * props as a plugin author's compiler sees them: `EntityCardProps` carries an
 * optional `onCaptionChange`, and the `renderOverlay` props shape has the name
 * `EntityOverlayProps`. The old names `ChipProps` / `CardProps` / `RowProps`
 * are not exported. Same set-up as `tag-type.test.ts`: the browser ambient leg
 * plus the published subpaths mapped onto their declaration sources.
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

function compileAuthorFile(source: string): string[] {
  const fixture = path.join(os.tmpdir(), `c4s-card-overlay-author-${process.pid}`, 'author.tsx');
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

const IMPORTS =
  "import type { EntityCardProps, EntityOverlayProps, FrontendModule } from '@c4s/plugin-runtime';";

describe('2.1.63 — EntityCardProps.onCaptionChange and EntityOverlayProps in @c4s/plugin-runtime', () => {
  it('[section:chipprops] a card may call the optional onCaptionChange with a string or null; a card without it still compiles', () => {
    const ok = [
      IMPORTS,
      'export function rename(p: EntityCardProps<{ title: string }>) {',
      "  p.onCaptionChange?.('New caption');",
      '  p.onCaptionChange?.(null);',
      '}',
      "export const noCallback: EntityCardProps<number> = { slug: 's', entity: 1, refLookup: new Map() };",
    ].join('\n');
    expect(compileAuthorFile(ok)).toEqual([]);

    // Optional: calling it without the guard is an error under strict.
    const unguarded = compileAuthorFile(`${IMPORTS}\nexport function f(p: EntityCardProps) { p.onCaptionChange('x'); }`);
    expect(unguarded.length).toBeGreaterThan(0);
  });

  it('[section:z7l89jhf] renderOverlay is typed with the named EntityOverlayProps { slug, caption?, onClose }', () => {
    const ok = [
      IMPORTS,
      'export function Overlay({ slug, caption, onClose }: EntityOverlayProps) { void slug; void caption; onClose(); return null; }',
      "export const slot: NonNullable<FrontendModule['renderOverlay']> = Overlay;",
      "export const noCaption: EntityOverlayProps = { slug: 's', onClose() {} };",
    ].join('\n');
    expect(compileAuthorFile(ok)).toEqual([]);

    // `onClose` is required.
    const missing = compileAuthorFile(`${IMPORTS}\nexport const p: EntityOverlayProps = { slug: 's' };`);
    expect(missing.join('\n')).toMatch(/onClose/);
  });

  it('[section:m13l11sc] the old prop names are not exported — no alias survives', () => {
    for (const old of ['ChipProps', 'CardProps', 'RowProps']) {
      const diagnostics = compileAuthorFile(`import type { ${old} } from '@c4s/plugin-runtime';\nexport type X = ${old};`);
      expect(diagnostics.join('\n')).toMatch(new RegExp(old));
    }
  });
});
