/**
 * 2.1.65 — a slug change rewrites tags by the M51 non-content ranges: an
 * unpaired `<Callout>` standing alone on its line defines no range (M51
 * `ykze87pl`), so a tag below it is content and is rewritten, while a tag
 * inside a PAIRED region stays an example and is left byte-for-byte.
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PagesService } from './pages.js';
import { ReferencesService } from './references.js';

describe('slug change below an unpaired JSX opening (2.1.65)', () => {
  let cwd: string;
  let pages: PagesService;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-rename-unpaired-jsx-'));
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('[ac:m19-slug-rename-after-unpaired-jsx] a slug change rewrites the tag standing below an unpaired <Callout> alone on its line', async () => {
    const before = [
      '# Strona',
      '',
      '<Note>',
      'Przykład: <inline_mention type="widget" slug="old-slug"/>',
      '</Note>',
      '',
      '<Callout>',
      '',
      'Pod spodem <inline_mention type="widget" slug="old-slug"/> w prozie.',
      '',
    ].join('\n');
    await pages.write('page.md', { body: before });
    const stored = (await pages.read('page.md')).body;

    const references = new ReferencesService(new Map([['pages', pages.store]]), new Map());
    const { changed } = await references.propagateSlugChange('widget', 'old-slug', 'new-slug');

    expect(changed).toEqual(['page.md']);
    const after = (await pages.read('page.md')).body;
    // The tag under the unpaired opening is rewritten…
    expect(after).toContain('Pod spodem <inline_mention type="widget" slug="new-slug"/> w prozie.');
    // …the one inside the paired region is an example and stays as it was…
    expect(after).toContain('Przykład: <inline_mention type="widget" slug="old-slug"/>');
    // …and nothing else on the page moved.
    expect(after).toBe(stored.replace('Pod spodem <inline_mention type="widget" slug="old-slug"/>', 'Pod spodem <inline_mention type="widget" slug="new-slug"/>'));
  });
});
