import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';

/**
 * 2.1.84 (M33) — the load gate across the 2.1.0 → 2.2.0 bump. The gate logic
 * itself does not change (a full semver range match); what changes is the
 * number it matches against. The "host 2.1.0" cases stand in for an app
 * released before the bump, by loading the gate against a host constant of
 * `2.1.0`.
 */

const manifest = (hostApiVersion: string): PluginManifest =>
  ({ name: '@acme/c4s-plugin-probe', version: '1.0.0', hostApiVersion, contributes: {} }) as PluginManifest;

/** The gate, loaded against a given host constant (or the real one). */
async function gateOn(hostVersion?: string) {
  vi.resetModules();
  if (hostVersion) {
    vi.doMock('../../../shared/plugin-host/manifest.js', async (importOriginal) => ({
      ...((await importOriginal()) as Record<string, unknown>),
      HOST_API_VERSION: hostVersion,
    }));
  }
  const { gateManifest } = await import('./loader.js');
  return gateManifest;
}

afterEach(() => {
  vi.doUnmock('../../../shared/plugin-host/manifest.js');
  vi.resetModules();
});

describe('M33 — the load gate on Host API 2.2.0 (2.1.84)', () => {
  it('[ac:ac-plugin-z-hostapiversion-2-1-0-laduje] a plugin declaring hostApiVersion "^2.1.0" loads on a 2.2.0 host', async () => {
    const gate = await gateOn();
    const { HOST_API_VERSION } = await import('../../../shared/plugin-host/manifest.js');
    expect(HOST_API_VERSION).toBe('2.2.0');
    expect(gate(manifest('^2.1.0'))).toBeNull();
    // Caret ranges on the 2.x line all still load — every in-repo base package declares one.
    expect(gate(manifest('^2.0.0'))).toBeNull();
    expect(gate(manifest('^2.2.0'))).toBeNull();
  });

  it('[ac:ac-plugin-z-hostapiversion-2-2-0-na-hosc] a plugin declaring hostApiVersion "^2.2.0" on a 2.1.0 host is skipped with PLUGIN_HOST_API_MISMATCH', async () => {
    const gate = await gateOn('2.1.0');
    const res = gate(manifest('^2.2.0'));
    expect(res).toMatchObject({ status: 'skipped', code: 'PLUGIN_HOST_API_MISMATCH' });
    // Same major: a skip, not an `incompatible` with a migration path.
    expect(res?.migration).toBeUndefined();
    // …while the same host still loads the ranges it always did.
    expect(gate(manifest('^2.1.0'))).toBeNull();
  });

  it('tilde / exact ranges pinned to 2.1.x are skipped on a 2.2.0 host; another major is incompatible', async () => {
    const gate = await gateOn();
    for (const range of ['~2.1.0', '2.1.0', '2.1.x']) {
      expect(gate(manifest(range)), range).toMatchObject({ status: 'skipped', code: 'PLUGIN_HOST_API_MISMATCH' });
    }
    expect(gate(manifest('^3.0.0'))).toMatchObject({ status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH' });
  });
});
