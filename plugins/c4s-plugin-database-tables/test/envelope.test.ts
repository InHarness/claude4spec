/**
 * The package envelope (PluginManifest) as the 2.1.21 page states it: the
 * package fills `contributes.entities` and `contributes.commands` and nothing
 * else — no `writingStyles`, and no settings slot (the envelope has none since
 * 2.1.21).
 */
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';

describe('database-table — package envelope', () => {
  it('[section:ityp8g1r] [section:91vq520g] declares hostApiVersion ^2.0.0 and contributes only entities + commands — no writingStyles, no settings', () => {
    expect(manifest.hostApiVersion).toBe('^2.0.0');
    expect(Object.keys(manifest.contributes ?? {}).sort()).toEqual(['commands', 'entities']);
    const contributes = manifest.contributes as Record<string, unknown>;
    expect(contributes.writingStyles).toBeUndefined();
    expect(contributes.settings).toBeUndefined();
    expect(manifest.contributes?.entities?.map((e) => e.type)).toEqual(['database-table']);
    expect(manifest.contributes?.commands?.map((c) => c.trigger)).toEqual(['database-table']);
  });
});
