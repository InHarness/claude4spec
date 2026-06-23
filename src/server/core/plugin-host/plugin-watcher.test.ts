import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginWatcher } from './plugin-watcher.js';

/** Poll until `cond()` is truthy or `timeoutMs` elapses. */
async function until(cond: () => boolean, timeoutMs = 3000, stepMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}

describe('M33 phase 3 — PluginWatcher', () => {
  let dir: string;
  let watcher: PluginWatcher | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-plugin-watch-'));
  });
  afterEach(async () => {
    await watcher?.close();
    watcher = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('empty roots ⇒ start() is a no-op (never fires)', async () => {
    const calls: string[][] = [];
    watcher = new PluginWatcher([], (paths) => calls.push(paths), 30);
    watcher.start();
    fs.writeFileSync(path.join(dir, 'x.js'), '1');
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toEqual([]);
  });

  it('fires a debounced onReload for a change under a watched root', async () => {
    const calls: string[][] = [];
    watcher = new PluginWatcher([dir], (paths) => calls.push(paths), 40);
    watcher.start();
    await new Promise((r) => setTimeout(r, 150)); // let chokidar settle

    fs.writeFileSync(path.join(dir, 'a.js'), 'one');
    expect(await until(() => calls.length === 1)).toBe(true);
    expect(calls[0]?.some((p) => p.endsWith('a.js'))).toBe(true);
  });

  it('coalesces a burst into a single onReload', async () => {
    const calls: string[][] = [];
    watcher = new PluginWatcher([dir], (paths) => calls.push(paths), 80);
    watcher.start();
    await new Promise((r) => setTimeout(r, 150));

    fs.writeFileSync(path.join(dir, 'a.js'), '1');
    fs.writeFileSync(path.join(dir, 'b.js'), '1');
    fs.writeFileSync(path.join(dir, 'c.js'), '1');

    expect(await until(() => calls.length >= 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 150)); // ensure no late extra flush
    expect(calls.length).toBe(1);
  });

  it('suppress() drops the self-write event that follows it', async () => {
    const calls: string[][] = [];
    watcher = new PluginWatcher([dir], (paths) => calls.push(paths), 40);
    watcher.start();
    await new Promise((r) => setTimeout(r, 150));

    const target = path.join(dir, 'self.js');
    watcher.suppress(target);
    fs.writeFileSync(target, 'written-by-reload');

    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toEqual([]);
  });
});
