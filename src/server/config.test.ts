import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, configPath } from './config.js';

// 0.1.58: additive `description` field (string | null, 0–200). Type validation
// lives in config.ts `validate()` (mirrors `language`); the 0–200 length cap is
// enforced at the PATCH /api/config route, not here.
describe('config — description field (0.1.58)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X', ...cfg }));
  };

  it('rejects a non-string, non-null description with a typed error', () => {
    write({ description: 42 });
    expect(() => readConfig(dir)).toThrow(
      "config.json: field 'description' expected string | null, got number",
    );
  });

  it('accepts a string description', () => {
    write({ description: 'An elevator pitch.' });
    expect(readConfig(dir).description).toBe('An elevator pitch.');
  });

  it('accepts a null description', () => {
    write({ description: null });
    expect(readConfig(dir).description).toBeNull();
  });

  it('treats a missing description as absent (no error)', () => {
    write({});
    expect(readConfig(dir).description).toBeUndefined();
  });
});
