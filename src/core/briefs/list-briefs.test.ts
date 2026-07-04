import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { listBriefsFs } from './list-briefs.js';

function writeBrief(
  dir: string,
  filename: string,
  frontmatter: Record<string, unknown>,
  body = '# Brief\n',
): void {
  fs.writeFileSync(path.join(dir, filename), matter.stringify(body, frontmatter), 'utf8');
}

describe('listBriefsFs', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-briefs-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an empty briefsDir returns items: [], total: 0', () => {
    expect(listBriefsFs(dir)).toEqual({ items: [], total: 0 });
  });

  it('a missing briefsDir returns items: [], total: 0 (not an error)', () => {
    expect(listBriefsFs(path.join(dir, 'does-not-exist'))).toEqual({ items: [], total: 0 });
  });

  it('filters non-brief markdown files out (frontmatter.type !== "brief")', () => {
    writeBrief(dir, 'a.md', { type: 'brief', to_release: '0.1.2', implemented: false });
    fs.writeFileSync(path.join(dir, 'notes.md'), matter.stringify('hi', { type: 'patch' }), 'utf8');
    const result = listBriefsFs(dir);
    expect(result.total).toBe(1);
    expect(result.items[0]?.path).toBe('a.md');
  });

  it('filters by --status pending/implemented', () => {
    writeBrief(dir, 'done.md', { type: 'brief', to_release: '0.1.1', implemented: true });
    writeBrief(dir, 'todo.md', { type: 'brief', to_release: '0.1.2', implemented: false });

    expect(listBriefsFs(dir, { status: 'implemented' }).items.map((i) => i.path)).toEqual(['done.md']);
    expect(listBriefsFs(dir, { status: 'pending' }).items.map((i) => i.path)).toEqual(['todo.md']);
    expect(listBriefsFs(dir).total).toBe(2);
  });

  it('sorts by to_release desc, with analysis briefs (to_release: null) first', () => {
    writeBrief(dir, 'old.md', { type: 'brief', to_release: '0.1.1', implemented: false });
    writeBrief(dir, 'new.md', { type: 'brief', to_release: '0.1.10', implemented: false });
    writeBrief(dir, 'analysis.md', { type: 'brief', to_release: null, implemented: false });

    const paths = listBriefsFs(dir).items.map((i) => i.path);
    expect(paths).toEqual(['analysis.md', 'new.md', 'old.md']);
  });

  it('paginates with limit/offset; offset >= total yields an empty page with the true total', () => {
    for (let i = 1; i <= 5; i++) {
      writeBrief(dir, `b${i}.md`, { type: 'brief', to_release: `0.1.${i}`, implemented: false });
    }
    const page = listBriefsFs(dir, { limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);

    const past = listBriefsFs(dir, { limit: 2, offset: 100 });
    expect(past).toEqual({ items: [], total: 5 });
  });
});
