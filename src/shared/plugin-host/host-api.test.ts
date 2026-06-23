import { describe, expect, it } from 'vitest';
import { HOST_API_VERSION } from './manifest.js';
import { buildMigrationInfo, migrationsBetween, rangeMajor } from './host-api.js';

describe('M33 phase 3 — Host API versioning helpers', () => {
  it('parses the first major from a semver range', () => {
    expect(rangeMajor('^1.4.0')).toBe(1);
    expect(rangeMajor('>=2.5.0')).toBe(2);
    expect(rangeMajor('~3.0.0')).toBe(3);
    expect(rangeMajor('nonsense')).toBeNull();
  });

  it('returns the 1→2 changelog entry between majors', () => {
    const ms = migrationsBetween(1, 2);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.some((m) => m.slot === 'onUnregister' && m.kind === 'slot-required')).toBe(true);
  });

  it('builds migration info for a previous-major plugin, with no shim for a required slot', () => {
    const info = buildMigrationInfo('^1.4.0');
    expect(info).not.toBeNull();
    expect(info!.targetHostApiVersion).toBe(HOST_API_VERSION);
    expect(info!.migrations.length).toBeGreaterThan(0);
    expect(info!.shimAvailable).toBe(false);
  });

  it('returns null when the plugin targets the current major (no migration needed)', () => {
    expect(buildMigrationInfo('^2.0.0')).toBeNull();
    expect(buildMigrationInfo('^2.5.0')).toBeNull(); // same major, even if unsatisfiable
  });
});
