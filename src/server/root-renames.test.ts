import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinPagesRoot, configPath, readConfig, type Config } from './config.js';
import {
  appendTransition,
  clearRenameJournal,
  formerIdsOf,
  readRootRenames,
  recoverPendingRootRename,
  relinkRoots,
  resolveCurrentRootId,
  retiredRootIds,
  rootIdChain,
  rootRenameJournalPath,
  rootRenamesPath,
  seedRootRenamesFromManifest,
  writeRenameJournal,
  writeRootRenames,
  type RootRenameTransition,
} from './root-renames.js';
import type { Root } from '../shared/types.js';

const t = (from: string, to: string): RootRenameTransition => ({ from, to, at: '2026-01-01T00:00:00.000Z' });

describe('root-renames — the identifier chain (0.2.101)', () => {
  it('walks a multi-step chain back to the oldest identifier', () => {
    const transitions = [t('pages', 'docs'), t('docs', 'spec')];
    expect(rootIdChain(transitions, 'spec')).toEqual(['spec', 'docs', 'pages']);
    // `formerIds` in a bundle manifest is the same chain, oldest first.
    expect(formerIdsOf(transitions, 'spec')).toEqual(['pages', 'docs']);
  });

  it('a never-renamed root is its own chain and has no former ids', () => {
    expect(rootIdChain([], 'adr')).toEqual(['adr']);
    expect(formerIdsOf([], 'adr')).toEqual([]);
  });

  it('resolves a retired identifier forward to the address it leads to today', () => {
    const transitions = [t('pages', 'docs'), t('docs', 'spec')];
    expect(resolveCurrentRootId(transitions, 'pages')).toBe('spec');
    expect(resolveCurrentRootId(transitions, 'docs')).toBe('spec');
    // A live identifier was never retired — that is not the same as "leads to
    // itself", and the caller must be able to tell the two apart.
    expect(resolveCurrentRootId(transitions, 'spec')).toBeNull();
    expect(resolveCurrentRootId(transitions, 'adr')).toBeNull();
  });

  /**
   * A corrupt or hand-edited file must not hang the process. The walk is what
   * every history read goes through, so it terminates on a cycle rather than
   * spinning — the registry's own writer refuses to create one.
   */
  it('terminates on a cyclic file instead of spinning', () => {
    const cyclic = [t('a', 'b'), t('b', 'a')];
    expect(rootIdChain(cyclic, 'a').length).toBeLessThanOrEqual(2);
    expect(resolveCurrentRootId(cyclic, 'a')).toBeTruthy();
  });
});

describe('root-renames — persistence (0.2.101)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-renames-'));
    fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a missing file reads as no transitions', () => {
    expect(readRootRenames(dir).transitions).toEqual([]);
    expect(retiredRootIds(dir).size).toBe(0);
  });

  /**
   * The sidecar is additive. A damaged one must never make a project that is
   * otherwise intact refuse to open — it degrades to "nothing was ever renamed".
   */
  it('a malformed file reads as no transitions, with a warning rather than a throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(rootRenamesPath(dir), '{ not json');
    expect(readRootRenames(dir).transitions).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('appendTransition refuses to retire the same identifier twice or to close a cycle', () => {
    appendTransition(dir, 'pages', 'docs');
    expect(retiredRootIds(dir)).toEqual(new Set(['pages']));
    expect(() => appendTransition(dir, 'pages', 'other')).toThrow(/already retired/);
    // `docs → pages` would send an identifier back to a space it has left, which
    // is exactly what makes `rootId IN (<chain>)` undecidable.
    expect(() => appendTransition(dir, 'docs', 'pages')).toThrow(/cycle/);
  });

  it('relinkRoots rewrites every linkTargets entry and names the roots it touched', () => {
    const roots: Root[] = [
      { ...builtinPagesRoot(), linkTargets: ['adr'] },
      { ...builtinPagesRoot(), id: 'adr', dir: 'adr', builtin: false, linkTargets: [] },
      { ...builtinPagesRoot(), id: 'rfc', dir: 'rfc', builtin: false, linkTargets: ['adr', 'pages'] },
    ];
    const { roots: next, relinked } = relinkRoots(roots, 'adr', 'decisions');
    expect(relinked).toEqual(['pages', 'rfc']);
    expect(next[0]!.linkTargets).toEqual(['decisions']);
    expect(next[2]!.linkTargets).toEqual(['decisions', 'pages']);
    // Nothing else moves: the rename changes an address, not a directory.
    expect(next.map((r) => r.dir)).toEqual(roots.map((r) => r.dir));
  });

  it('seeds a clone from a manifest so the retired ids are taken from its first boot', () => {
    seedRootRenamesFromManifest(dir, [{ id: 'spec', formerIds: ['pages', 'docs'] }, { id: 'adr' }]);
    expect(retiredRootIds(dir)).toEqual(new Set(['pages', 'docs']));
    expect(rootIdChain(readRootRenames(dir).transitions, 'spec')).toEqual(['spec', 'docs', 'pages']);
    // A manifest predating the field means "never renamed" and seeds nothing.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-clone-'));
    seedRootRenamesFromManifest(fresh, [{ id: 'pages' }]);
    expect(fs.existsSync(rootRenamesPath(fresh))).toBe(false);
    fs.rmSync(fresh, { recursive: true, force: true });
  });
});

/**
 * Crash recovery. A rename commits two files, so a process death between them
 * is the one state no single atomic write can rule out. The journal names the
 * intent and startup replays it — the invariant being protected is that the
 * project never opens with `linkTargets` half-rewritten.
 */
describe('root-renames — recovery from an interrupted rename (0.2.101)', () => {
  let dir: string;

  function write(cfg: Partial<Config>): void {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'X', ...cfg }, null, 2) + '\n');
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-recover-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('no journal means nothing to do', () => {
    write({ roots: [builtinPagesRoot()] });
    expect(recoverPendingRootRename(dir)).toBe('none');
  });

  it('finishes a rename whose config write landed but whose registry write did not', () => {
    write({
      roots: [
        { ...builtinPagesRoot(), id: 'docs' },
        { ...builtinPagesRoot(), id: 'rfc', dir: 'rfc', builtin: false, linkTargets: ['pages'] },
      ],
    });
    writeRenameJournal(dir, { from: 'pages', to: 'docs', startedAt: '2026-01-01T00:00:00.000Z' });

    expect(recoverPendingRootRename(dir)).toBe('completed');
    expect(readRootRenames(dir).transitions).toEqual([
      expect.objectContaining({ from: 'pages', to: 'docs' }),
    ]);
    // The half-done relink is finished too — this is the state the contract
    // rules out by name.
    expect(readConfig(dir).roots.find((r) => r.id === 'rfc')!.linkTargets).toEqual(['docs']);
    expect(fs.existsSync(rootRenameJournalPath(dir))).toBe(false);
  });

  it('rolls back a rename that died before the config was written', () => {
    write({ roots: [builtinPagesRoot()] });
    writeRenameJournal(dir, { from: 'pages', to: 'docs', startedAt: '2026-01-01T00:00:00.000Z' });

    expect(recoverPendingRootRename(dir)).toBe('rolled-back');
    expect(readConfig(dir).roots.map((r) => r.id)).toEqual(['pages']);
    expect(readRootRenames(dir).transitions).toEqual([]);
    expect(fs.existsSync(rootRenameJournalPath(dir))).toBe(false);
  });

  it('is idempotent — a replay over an already-recorded transition changes nothing', () => {
    write({ roots: [{ ...builtinPagesRoot(), id: 'docs' }] });
    writeRootRenames(dir, { version: 1, transitions: [t('pages', 'docs')] });
    writeRenameJournal(dir, { from: 'pages', to: 'docs', startedAt: '2026-01-01T00:00:00.000Z' });

    expect(recoverPendingRootRename(dir)).toBe('completed');
    expect(readRootRenames(dir).transitions).toHaveLength(1);

    clearRenameJournal(dir);
    expect(recoverPendingRootRename(dir)).toBe('none');
  });
});
