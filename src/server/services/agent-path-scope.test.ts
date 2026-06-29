import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveAgentPathScope } from './agent-path-scope.js';

const CWD = '/home/me/project';

describe('resolveAgentPathScope', () => {
  it('returns empty scope when nothing is configured and pagesDir is inside cwd', () => {
    const r = resolveAgentPathScope({
      cwd: CWD,
      pagesDir: path.join(CWD, 'pages'),
      allowedPaths: [],
      disallowedPaths: [],
    });
    expect(r.allowedPaths).toEqual([]);
    expect(r.disallowedPaths).toEqual([]);
  });

  it('adds pagesDir when it is outside cwd', () => {
    const pagesDir = '/var/data/spec-pages';
    const r = resolveAgentPathScope({ cwd: CWD, pagesDir, allowedPaths: [], disallowedPaths: [] });
    expect(r.allowedPaths).toEqual([pagesDir]);
  });

  it('never appends cwd itself to allowedPaths (library adds the base)', () => {
    const r = resolveAgentPathScope({
      cwd: CWD,
      pagesDir: path.join(CWD, 'pages'),
      allowedPaths: ['/extra/lib'],
      disallowedPaths: [],
    });
    expect(r.allowedPaths).not.toContain(CWD);
    expect(r.allowedPaths).toEqual(['/extra/lib']);
  });

  it('resolves relative entries against cwd to absolute paths', () => {
    const r = resolveAgentPathScope({
      cwd: CWD,
      pagesDir: path.join(CWD, 'pages'),
      allowedPaths: ['../sibling', 'sub/dir'],
      disallowedPaths: ['secret'],
    });
    expect(r.allowedPaths).toEqual(['/home/me/sibling', path.join(CWD, 'sub/dir')]);
    expect(r.disallowedPaths).toEqual([path.join(CWD, 'secret')]);
    // Everything must be absolute.
    for (const p of [...r.allowedPaths, ...r.disallowedPaths]) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });

  it('passes disallowedPaths through (normalized, absolute)', () => {
    const r = resolveAgentPathScope({
      cwd: CWD,
      pagesDir: path.join(CWD, 'pages'),
      allowedPaths: ['/code'],
      disallowedPaths: ['/code/src', 'node_modules'],
    });
    expect(r.disallowedPaths).toEqual(['/code/src', path.join(CWD, 'node_modules')]);
  });

  it('combines pagesDir-outside base with configured allowedPaths and dedupes', () => {
    const pagesDir = '/var/data/spec-pages';
    const r = resolveAgentPathScope({
      cwd: CWD,
      pagesDir,
      allowedPaths: [pagesDir, '/extra'],
      disallowedPaths: [],
    });
    // pagesDir appears once despite also being listed in allowedPaths.
    expect(r.allowedPaths).toEqual([pagesDir, '/extra']);
  });
});
