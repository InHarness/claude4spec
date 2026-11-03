/**
 * 2.1.65 (M13 `m13ui000` Okna, `z5jthgfh` Strona detalu) — the host has no
 * window of its own for confirming an entity delete. The delete confirm of an
 * entity (`<type>-delete`) belongs to its plugin: the plugin's detail route calls
 * the runtime facade `confirmDestructive`, and the shell's confirm layer renders
 * whatever kind the plugin names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(here, '..');
const APP = path.resolve(CLIENT, '../..');

function files(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(abs, keep));
    else if (keep(abs)) out.push(abs);
  }
  return out;
}

const isSource = (f: string) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f);

/** Every `confirmDestructive('<kind>'` literal in `sources`, with the file it is in. */
function confirmKinds(sources: string[]): Array<{ file: string; kind: string }> {
  const out: Array<{ file: string; kind: string }> = [];
  for (const file of sources) {
    for (const m of fs.readFileSync(file, 'utf-8').matchAll(/confirmDestructive\(\s*['"`]([^'"`]+)['"`]/g)) {
      out.push({ file: path.relative(APP, file), kind: m[1]! });
    }
  }
  return out;
}

describe('[section:m13ui000] the host has no window of its own for confirming an entity delete', () => {
  it('[section:m13ui000] the host confirm kinds no longer list `entity-delete`', () => {
    const events = fs.readFileSync(path.join(here, 'events.ts'), 'utf-8');
    const kinds = events.slice(events.indexOf('export type ConfirmKind ='), events.indexOf('export interface ConfirmRequest'));
    expect(kinds).toContain("'thread-delete'");
    expect(kinds).not.toMatch(/\|\s*'entity-delete'/);
  });

  it('[section:z5jthgfh] no host source opens an entity delete confirm — the only host `*-delete` kind is the chat thread', () => {
    const host = confirmKinds(files(CLIENT, isSource)).filter((c) => /-delete$/.test(c.kind));
    expect(host.map((c) => c.kind)).toEqual(['thread-delete']);
  });

  it('[section:m13ui000] each plugin opens its own `<type>-delete` window through the runtime facade', () => {
    const plugins = files(path.join(APP, 'plugins'), (f) => /\/src\//.test(f) && isSource(f));
    const kinds = new Set(confirmKinds(plugins).map((c) => c.kind));
    for (const kind of ['endpoint-delete', 'dto-delete', 'ac-delete', 'ui-view-delete', 'design-system-delete']) {
      expect({ kind, opened: kinds.has(kind) }).toEqual({ kind, opened: true });
    }
    // …and those files take the facade from `@c4s/plugin-runtime`, not from the host's own module.
    for (const file of plugins.filter((f) => /confirmDestructive\(/.test(fs.readFileSync(f, 'utf-8')))) {
      const src = fs.readFileSync(file, 'utf-8');
      expect({ file: path.relative(APP, file), host: /from ['"][./]*.*client\/ui\/events/.test(src) }).toEqual({
        file: path.relative(APP, file),
        host: false,
      });
    }
  });
});
