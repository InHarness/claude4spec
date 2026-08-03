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
      model: 'sonnet-4.6',
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
    expect(check({ model: 'opus-4.7', architectureConfig: {} }, { lastSessionId: null })).toBeNull();
  });

  it('returns null when there is no snapshot (thread predates the snapshot column)', () => {
    expect(check(null)).toBeNull();
  });

  it('flags a model change', () => {
    const res = check({ model: 'opus-4.7', architectureConfig: {} });
    expect(res?.error.code).toBe('RESUME_CONFIG_LOCKED');
    expect(res?.error.violations.map((v) => v.path)).toContain('model');
    expect(res?.error.message).toContain('model');
  });

  it('flags an FS scope change and names the field in the message', () => {
    writeConfig({ agent: { allowedPaths: ['new'] } });
    const res = check({
      model: 'sonnet-4.6',
      architectureConfig: {},
      allowedPaths: [path.join(cwd, 'old')],
    });
    expect(res?.error.violations.map((v) => v.path)).toEqual(['allowedPaths']);
    expect(res?.error.message).toContain('allowedPaths');
    // Every violation carries the library's reason text — the UI tooltip.
    expect(res?.error.violations[0].reason.length).toBeGreaterThan(0);
  });

  it('passes an unchanged scope through', () => {
    writeConfig({ agent: { allowedPaths: ['same'] } });
    expect(
      check({
        model: 'sonnet-4.6',
        architectureConfig: {},
        allowedPaths: [path.join(cwd, 'same')],
      }),
    ).toBeNull();
  });
});
