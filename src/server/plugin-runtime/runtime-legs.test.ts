/**
 * 2.1.20 (M33 `m33rt001`) — every value of `@c4s/plugin-runtime` belongs to a
 * leg and to an owner module, and each leg serves exactly its names.
 *
 * The two legs are compared against the inventory from both directions: the
 * backend barrel this process resolves the bare specifier to, and the browser
 * shim the import map serves. The browser leg is a browser module the server
 * cannot import, so its side is the shim the server renders for it — the same
 * text a plugin frontend links against (its parity with the client module is
 * held by `client/runtime/plugin-runtime.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import * as backendLeg from './index.js';
import * as uiBackendLeg from './ui.js';
import {
  PLUGIN_RUNTIME_LEGS,
  pluginRuntimeLegOf,
  pluginRuntimeNamesOnLeg,
} from '../../shared/plugin-host/runtime-legs.js';
import { PLUGIN_RUNTIME_UI_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';
import { getRuntimeShim } from '../core/plugin-host/runtime-shims.js';

/** The names a rendered shim exports (`export const <name> = …`). */
function shimExports(source: string): string[] {
  return [...source.matchAll(/^export const ([A-Za-z_$][\w$]*) =/gm)].map((m) => m[1]!);
}

const sorted = (names: Iterable<string>) => [...names].sort();

describe('[section:m33rt001] the leg inventory of @c4s/plugin-runtime', () => {
  it('[section:m33rt001] assigns every name to exactly one leg and one owner contract section', () => {
    const all = PLUGIN_RUNTIME_LEGS.flatMap((row) => [...row.names]);
    expect(new Set(all).size).toBe(all.length);
    for (const row of PLUGIN_RUNTIME_LEGS) {
      expect(['browser', 'backend', 'both']).toContain(row.leg);
      expect(row.contract.module).toMatch(/^M\d{2}$/);
      expect(row.contract.anchor).toMatch(/^[a-z0-9]{8,9}$/);
      expect(row.names.length).toBeGreaterThan(0);
    }
    // Names the inventory places, sampled from each owner.
    expect(pluginRuntimeLegOf('createMcpServer')).toBe('backend');
    expect(pluginRuntimeLegOf('DomainError')).toBe('backend');
    expect(pluginRuntimeLegOf('z')).toBe('backend');
    expect(pluginRuntimeLegOf('registerFrontendModule')).toBe('browser');
    expect(pluginRuntimeLegOf('editorBridge')).toBe('browser');
    expect(pluginRuntimeLegOf('startSeededThread')).toBe('browser');
    // 2.1.20 — the shell's window facades (M50 `tbeatf5z`), browser only.
    for (const name of ['openPopover', 'openModal', 'confirmDestructive', 'toast']) {
      expect(pluginRuntimeLegOf(name), name).toBe('browser');
    }
    expect(PLUGIN_RUNTIME_LEGS.find((r) => r.names.includes('toast'))?.contract).toEqual({ module: 'M50', anchor: 'tbeatf5z' });
    expect(pluginRuntimeLegOf('HOST_API_VERSION')).toBe('both');
  });

  it('[section:m33rt001] HOST_API_VERSION is the only name both legs carry', () => {
    const backend = new Set(pluginRuntimeNamesOnLeg('backend'));
    const shared = pluginRuntimeNamesOnLeg('browser').filter((n) => backend.has(n));
    expect(shared).toEqual(['HOST_API_VERSION']);
    expect(PLUGIN_RUNTIME_LEGS.filter((r) => r.leg === 'both').flatMap((r) => r.names)).toEqual(['HOST_API_VERSION']);
  });

  it('[section:m33rt001] the backend leg (the Node barrel) carries exactly the backend and shared names — React-free', () => {
    expect(sorted(Object.keys(backendLeg))).toEqual(sorted(pluginRuntimeNamesOnLeg('backend')));
    // No browser singleton leaks onto the backend leg.
    for (const name of ['queryClient', 'editorBridge', 'clientPluginHost', 'registerFrontendModule']) {
      expect(backendLeg).not.toHaveProperty(name);
    }
  });

  it('[ac:ac-zbior-nazw-wartosci-eksportowanych-pr] the set of value names the backend leg of the main @c4s/plugin-runtime entry exports equals the set of inventory names marked backend or both', () => {
    // The inventory's backend + shared rows, read straight off the table.
    const inventory = PLUGIN_RUNTIME_LEGS.filter((row) => row.leg === 'backend' || row.leg === 'both').flatMap(
      (row) => [...row.names],
    );
    // The leg inventory as M33 m33rt001 states it at 2.1.25 (exhaustive for the
    // backend leg): `HOST_API_VERSION` (both) plus the backend rows of M13 and M39.
    expect(sorted(inventory)).toEqual(
      sorted([
        'HOST_API_VERSION',
        'createMcpServer',
        'mcpTool',
        'z',
        'checkValidator',
        'validatorMessage',
        'contentBytes',
        'DEFAULT_CONTENT_OPERATION',
        'TOOL_RESULT_CEILING_TOKENS',
        'DomainError',
      ]),
    );
    // The Node barrel the bare specifier resolves to: its value exports (types
    // are erased, so the module namespace holds values only) are exactly that
    // set — nothing missing, nothing extra.
    const exported = Object.keys(backendLeg);
    expect(new Set(exported).size).toBe(exported.length);
    expect(sorted(exported)).toEqual(sorted(inventory));
    for (const name of inventory) expect(backendLeg, name).toHaveProperty(name);
    // No browser-only name of the inventory is on the backend leg.
    for (const row of PLUGIN_RUNTIME_LEGS.filter((r) => r.leg === 'browser')) {
      for (const name of row.names) expect(exported, name).not.toContain(name);
    }
  });

  it('[section:m33rt001] the browser leg (the import-map shim) carries exactly the browser and shared names, and no backend-only name', async () => {
    const shim = await getRuntimeShim('plugin-runtime');
    expect(shim).not.toBeNull();
    const exported = shimExports(shim!);
    expect(sorted(exported)).toEqual(sorted(pluginRuntimeNamesOnLeg('browser')));
    // A backend-only name has no export in the module a plugin frontend links
    // against, so a static import of it fails to link as an ES module.
    for (const row of PLUGIN_RUNTIME_LEGS.filter((r) => r.leg === 'backend')) {
      for (const name of row.names) expect(exported).not.toContain(name);
    }
  });

  it('[section:m33rt001] the /ui backend leg carries only UI_KIT_STABLE_COMPONENTS; the browser /ui leg carries the same UI_KIT_STABLE_COMPONENTS beside the components, and no STABLE_UI_KIT_COMPONENTS', async () => {
    expect(Object.keys(uiBackendLeg)).toEqual(['UI_KIT_STABLE_COMPONENTS']);
    const uiShim = await getRuntimeShim('plugin-runtime-ui');
    const exported = shimExports(uiShim!);
    expect(sorted(exported)).toEqual(sorted(PLUGIN_RUNTIME_UI_EXPORT_NAMES));
    // 2.1.25 — one name on both legs; the previous browser name has no alias.
    expect(exported).toContain('UI_KIT_STABLE_COMPONENTS');
    expect(exported).not.toContain('STABLE_UI_KIT_COMPONENTS');
  });
});
