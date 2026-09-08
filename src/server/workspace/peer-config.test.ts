import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPeerConfigSummary } from './peer-config.js';

/**
 * The one sanctioned read of a peer project's config — the departure from
 * no-ambient that the schema check cannot see, because no object is created.
 *
 * The behaviour these pin is what makes the departure defensible: it must never
 * build a ProjectContext (the `list_projects` contract requires an answer for
 * every project in the workspace, and a build would raise PROJECT_BUILD_FAILED
 * where the contract wants a degraded entry), and it must never throw.
 */
describe('readPeerConfigSummary', () => {
  const dirs: string[] = [];

  const project = (config: string | null): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-peer-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
    if (config !== null) fs.writeFileSync(path.join(dir, '.claude4spec', 'config.json'), config);
    return dir;
  };

  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('degrades a malformed config to an empty summary rather than throwing', () => {
    const dir = project('{ this is not json');
    expect(() => readPeerConfigSummary(dir)).not.toThrow();
    expect(readPeerConfigSummary(dir).name).toBeUndefined();
  });

  it('answers for a directory that is not a project at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bare-'));
    dirs.push(dir);
    expect(() => readPeerConfigSummary(dir)).not.toThrow();
  });

  it('is a pure read — it never builds a context or writes the config back', () => {
    const dir = project('{ "name": "Peer", "description": "d" }');
    const before = fs.readdirSync(path.join(dir, '.claude4spec')).sort();
    readPeerConfigSummary(dir);
    // Nothing created, nothing rewritten: the read leaves the peer's directory
    // exactly as it found it.
    expect(fs.readdirSync(path.join(dir, '.claude4spec')).sort()).toEqual(before);
  });

  it('surfaces both display fields, which is what the three callers each needed', () => {
    const dir = project('{ "name": "Peer Project", "description": "the peer" }');
    expect(readPeerConfigSummary(dir)).toEqual({ name: 'Peer Project', description: 'the peer' });
  });

  it('omits a field the config does not set, rather than inventing an empty string', () => {
    const dir = project('{ "name": "Peer Project" }');
    const summary = readPeerConfigSummary(dir);
    expect(summary.name).toBe('Peer Project');
    expect('description' in summary).toBe(false);
  });
});
