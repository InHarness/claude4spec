/**
 * 2.1.28 — the editor bridge's two faces (M20 nvc5wy2p / m20l11sc, M05 rehyxchp,
 * M13 chipprops / z7l89jhf / xr8fs8dc):
 *  - chips in the editor, in chat and in plugins navigate through the
 *    `editorBridge` singleton of `@c4s/plugin-runtime`;
 *  - the `useEditorBridge()` hook is host-internal — used only inside the host
 *    (its definition and `DocEditor`), by no chip and no in-repo plugin;
 *  - `EntityDetailProps` carries no navigation callbacks: a detail panel
 *    navigates through the same singleton.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pluginRuntime from './plugin-runtime.js';
import { editorBridge } from './editor-bridge.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Code lines only — a comment may name the hook, a call or an import may not. */
function codeMentions(file: string, pattern: RegExp): boolean {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('*') && !l.startsWith('//') && !l.startsWith('/*'))
    .some((l) => pattern.test(l));
}

const clientFiles = sources(join(REPO, 'src/client'));
const pluginFiles = readdirSync(join(REPO, 'plugins'))
  .filter((p) => p.startsWith('c4s-plugin-'))
  .flatMap((p) => {
    try {
      return sources(join(REPO, 'plugins', p, 'src'));
    } catch {
      return [];
    }
  });
const rel = (f: string) => relative(REPO, f).split('\\').join('/');

describe('editor bridge — singleton for chips, hook host-internal', () => {
  it('[section:m20l11sc] the useEditorBridge hook is used only inside the host — its definition and DocEditor — and by no plugin in this repo', () => {
    const users = [...clientFiles, ...pluginFiles].filter((f) => codeMentions(f, /\buseEditorBridge\b/)).map(rel).sort();
    expect(users).toEqual(['src/client/host-ui-kit/detail/DocEditor.tsx', 'src/client/tiptap/EditorContext.tsx']);
    expect(pluginRuntime).not.toHaveProperty('useEditorBridge');
  });

  it('[section:nvc5wy2p] the host chips of the editor and chat pipelines (entity chips, element lists, section chips, the chat dispatcher) call the editorBridge singleton', () => {
    const chips = [
      'src/client/chat/XmlChipDispatcher.tsx',
      'src/client/xml-markup/tags/references/shared.tsx',
      'src/client/xml-markup/tags/references/SingleElement.tsx',
      'src/client/xml-markup/tags/references/ElementList.tsx',
      'src/client/xml-markup/tags/references/TaggedList.tsx',
      'src/client/xml-markup/tags/references/TaggedListMixed.tsx',
      'src/client/components/SectionRefChipWithData.tsx',
    ];
    for (const f of chips) {
      const file = join(REPO, f);
      expect(codeMentions(file, /import \{ editorBridge \} from '[./]+runtime\/editor-bridge\.js';/), f).toBe(true);
      expect(codeMentions(file, /\beditorBridge\b(?!\w)/), f).toBe(true);
    }
  });

  it('[section:chipprops] plugin chips in this repo navigate through editorBridge imported from @c4s/plugin-runtime, never through a hook', () => {
    const pluginChips = pluginFiles.filter((f) => codeMentions(f, /\beditorBridge\.open(Entity|Section)\(/));
    expect(pluginChips.length).toBeGreaterThan(0);
    for (const f of pluginChips) {
      expect(codeMentions(f, /import \{[^}]*\beditorBridge\b[^}]*\} from '@c4s\/plugin-runtime';/), rel(f)).toBe(true);
    }
  });

  it('[section:z7l89jhf] EntityDetailProps (published) has exactly slug, onDeleted, onRenamed, onBack — no onOpenEntity / onOpenPage — and the navigation it lacks is editorBridge.openEntity / openSection on @c4s/plugin-runtime', () => {
    const published = readFileSync(join(REPO, 'src/plugin-types/plugin-runtime.ts'), 'utf8');
    const body = /export interface EntityDetailProps \{([\s\S]*?)\n\}/.exec(published)?.[1] ?? '';
    const fields = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields).toEqual(['slug', 'onDeleted', 'onRenamed', 'onBack']);
    expect(published).toMatch(/export declare const editorBridge: EditorBridge;/);
    expect(pluginRuntime.editorBridge).toBe(editorBridge);
    expect(typeof editorBridge.openEntity).toBe('function');
    expect(typeof editorBridge.openSection).toBe('function');
  });

  it('[section:xr8fs8dc] the host-side EntityDetailProps carries the same four required fields and no navigation callback', () => {
    const src = readFileSync(join(REPO, 'src/client/entities/registry.tsx'), 'utf8');
    const body = /export interface EntityDetailProps \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    const fields = [...body.matchAll(/^\s*(\w+)(\??):/gm)].map((m) => `${m[1]}${m[2]}`);
    expect(fields).toEqual(['slug', 'onDeleted', 'onRenamed', 'onBack']);
    expect(body).not.toMatch(/onOpenEntity|onOpenPage/);
  });
});
