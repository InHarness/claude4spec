import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkResumeConfigLock } from './resume-lock.js';

/**
 * The guard used to be two byte-identical copies, in `POST /api/chat` and in
 * `POST /api/threads/:id/ask`; only the second had any test. It is one helper now, so
 * these tests cover both routes' behaviour. The route-level wiring is exercised in
 * `threads.test.ts`.
 */
describe('checkResumeConfigLock', () => {
  let cwd: string;

  const writeConfig = (cfg: Record<string, unknown>) => {
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'config.json'), JSON.stringify(cfg));
  };
  const check = (snapshot: Record<string, unknown> | null, overrides: Record<string, unknown> = {}) =>
    checkResumeConfigLock({
      snapshotJson: snapshot === null ? null : JSON.stringify(snapshot),
      lastSessionId: 'sess-1',
      model: 'opus-5',
      architectureConfig: {},
      cwd,
      roots: [],
      ...overrides,
    });

  beforeEach(() => {
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-resume-lock-')));
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when the thread is not resuming', () => {
    expect(check({ model: 'haiku-4.5', architectureConfig: {} }, { lastSessionId: null })).toBeNull();
  });

  it('returns null when there is no snapshot (thread predates the snapshot column)', () => {
    expect(check(null)).toBeNull();
  });

  it('flags a model change', () => {
    const res = check({ model: 'haiku-4.5', architectureConfig: {} });
    expect(res?.error.code).toBe('RESUME_CONFIG_LOCKED');
    expect(res?.error.violations.map((v) => v.path)).toContain('model');
  });

  it('flags an FS scope change and names the field in violations, not in the message', () => {
    writeConfig({ agent: { allowedPaths: ['new'] } });
    const res = check({
      model: 'opus-5',
      architectureConfig: {},
      allowedPaths: [path.join(cwd, 'old')],
    });
    expect(res?.error.violations.map((v) => v.path)).toEqual(['allowedPaths']);
    // Every violation carries the library's reason text — the UI tooltip.
    expect(res?.error.violations[0].reason.length).toBeGreaterThan(0);
  });

  it('uses one static message for every violation — the per-field detail lives in violations[]', () => {
    const STATIC =
      'Model, reasoning and filesystem scope are locked for the lifetime of a session. Start a new conversation to use the new settings.';
    const modelChange = check({ model: 'haiku-4.5', architectureConfig: {} });
    expect(modelChange?.error.message).toBe(STATIC);

    writeConfig({ agent: { allowedPaths: ['new'] } });
    const scopeChange = check({
      model: 'opus-5',
      architectureConfig: {},
      allowedPaths: [path.join(cwd, 'old')],
    });
    // Two different violated fields, byte-identical message — a non-UI consumer can
    // match on it, and the field that diverged is still recoverable from violations[].
    expect(scopeChange?.error.message).toBe(STATIC);
    expect(scopeChange?.error.violations.map((v) => v.path)).not.toEqual(
      modelChange?.error.violations.map((v) => v.path),
    );
  });

  it('does not 409 when a Settings write merely reshuffled the order of the same paths', () => {
    // Regression: the library compares by JSON.stringify, so order matters, and a bare
    // Set serializes in insertion order (config → page roots → default deny set). Both
    // sides go through the same dedupe+sort, so a reordered — or duplicated — config
    // entry has to resolve to the same array and let the turn proceed.
    // Turn-1 stored the scope already deduped and sorted, as the column always does.
    const snapshot = {
      model: 'opus-5',
      architectureConfig: {},
      allowedPaths: [path.join(cwd, 'alpha'), path.join(cwd, 'beta'), path.join(cwd, 'gamma')],
    };

    writeConfig({ agent: { allowedPaths: ['alpha', 'beta', 'gamma'] } });
    expect(check(snapshot)).toBeNull(); // baseline: same order resumes cleanly

    // Same three directories, reordered and with one repeated — semantically identical.
    writeConfig({ agent: { allowedPaths: ['gamma', 'alpha', 'beta', 'alpha'] } });
    expect(check(snapshot)).toBeNull();
  });

  it('passes an unchanged scope through', () => {
    writeConfig({ agent: { allowedPaths: ['same'] } });
    expect(
      check({
        model: 'opus-5',
        architectureConfig: {},
        allowedPaths: [path.join(cwd, 'same')],
      }),
    ).toBeNull();
  });
});
