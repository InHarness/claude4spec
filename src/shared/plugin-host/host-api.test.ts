import { describe, expect, it } from 'vitest';
import { HOST_API_VERSION } from './manifest.js';
import { buildMigrationInfo, migrationsBetween, rangeMajor } from './host-api.js';

describe('M33 — Host API versioning helpers', () => {
  it('parses the first major from a semver range', () => {
    expect(rangeMajor('^1.4.0')).toBe(1);
    expect(rangeMajor('>=2.5.0')).toBe(2);
    expect(rangeMajor('~3.0.0')).toBe(3);
    expect(rangeMajor('nonsense')).toBeNull();
  });

  it('has an empty changelog at the 1.0.0 baseline (no major crossed yet)', () => {
    expect(migrationsBetween(1, 2)).toHaveLength(0);
    expect(migrationsBetween(0, 9)).toHaveLength(0);
  });

  it('builds migration info for a different-major plugin, with empty descriptors and no shim', () => {
    const info = buildMigrationInfo('^2.0.0');
    expect(info).not.toBeNull();
    expect(info!.targetHostApiVersion).toBe(HOST_API_VERSION);
    expect(info!.migrations).toHaveLength(0);
    expect(info!.shimAvailable).toBe(false);
  });

  it('returns null when the plugin targets the current major (no migration needed)', () => {
    expect(buildMigrationInfo('^1.0.0')).toBeNull();
    expect(buildMigrationInfo('^1.5.0')).toBeNull(); // same major, even if unsatisfiable
  });
});
