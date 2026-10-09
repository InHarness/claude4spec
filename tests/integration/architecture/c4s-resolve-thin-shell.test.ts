/**
 * `c4s resolve` (2.1.9, M11 `m11dreso`) — the ABSENCE half of the criterion,
 * read off the source: nothing under `src/bin/c4s` (nor the `src/bin/c4s.ts`
 * entry) carries an expansion algorithm — no tag recognition, no
 * tag-to-projection map, no replacing of tags with text, no `resolved[]`
 * sidecar of its own. Comments are stripped first: the command is allowed to
 * SAY where the expansion lives.
 *
 * It lives here, not beside the command, because it walks directories, and
 * `discovery-core.test.ts` keeps `src/bin/c4s` free of any directory walk. The
 * DELEGATION half (observed on the wire) stays in
 * `src/bin/c4s/commands/resolve.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');

/** Every non-test source of the `c4s` bin, with comments removed. */
function binSources(): Array<{ file: string; code: string }> {
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        out.push({ file: path.relative(REPO_ROOT, abs), code: strip(fs.readFileSync(abs, 'utf8')) });
      }
    }
  };
  walk(path.join(REPO_ROOT, 'src/bin/c4s'));
  out.push({ file: 'src/bin/c4s.ts', code: strip(fs.readFileSync(path.join(REPO_ROOT, 'src/bin/c4s.ts'), 'utf8')) });
  return out;
}

describe('c4s resolve — a thin shell over the M19 expansion core', () => {
  it('[ac:ac-kod-binu-c4s-nie-zawiera-algorytmu-ro] the bin carries no expansion algorithm (grep-proof)', () => {
    // Tag recognition (the markup parser, the editor's markdown-it rules), the
    // core itself run locally, the old transport-side composition and its
    // renderer, and a sidecar re-shaped on this side.
    const forbidden =
      /parseXmlTags|shared\/xml-tags|xml_inline|xml_block|markdown-it|expandEmbeds\s*\(|expand-embeds|resolve-page\.js|inline-renderer|resolvePageContent|resolved\s*\.\s*map|<inline_mention|<single_element|<element_list|<tagged_list|<section_ref/;
    const sources = binSources();
    expect(sources.length).toBeGreaterThan(10);
    for (const { file, code } of sources) {
      expect(forbidden.exec(code)?.[0], `${file} carries part of the expansion algorithm`).toBeUndefined();
    }

    // The command itself: it posts the file and prints the answer — it replaces
    // nothing in the text it read.
    const resolve = sources.find((s) => s.file === path.join('src', 'bin', 'c4s', 'commands', 'resolve.ts'))!;
    expect(resolve.code).toContain("delegatePost(args, '/_meta/resolve-page'");
    expect(resolve.code).not.toMatch(/\.replace\(|\.slice\(|\.splice\(/);
    expect(resolve.code).not.toMatch(/select\s*:/);

    // …and what it posts to is the M19 core.
    const route = fs.readFileSync(path.join(REPO_ROOT, 'src/server/routes/meta.ts'), 'utf8');
    expect(route).toContain("import { expandEmbeds } from '../../core/references/index.js'");
    expect(route).toMatch(/expandEmbeds\(body\.content, expansion, \{ format \}\)/);
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/server/serialization/resolve-page.ts'))).toBe(false);
  });
});
