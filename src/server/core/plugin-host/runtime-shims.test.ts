import { describe, expect, it } from 'vitest';
import { buildImportMap, getRuntimeShim, PEER_SLUG } from './runtime-shims.js';
import { SHARED_PEER_SPECIFIERS } from '../../../shared/plugin-host/frontend-manifest.js';

describe('runtime-shims', () => {
  it('maps every shared peer specifier to a runtime shim URL', () => {
    const map = buildImportMap();
    for (const spec of SHARED_PEER_SPECIFIERS) {
      expect(map[spec]).toBe(`/api/plugins/runtime/${PEER_SLUG[spec]}.js`);
    }
  });

  it('returns null for an unknown peer slug', async () => {
    expect(await getRuntimeShim('not-a-peer')).toBeNull();
  });

  it('emits ESM that reads the host singleton from the global', async () => {
    const src = await getRuntimeShim(PEER_SLUG['react']);
    expect(src).toContain('globalThis.__c4s_shared');
    expect(src).toContain('export default');
    // react's named exports should be re-exported (enumerated from the package).
    expect(src).toContain('export const useState =');
  });

  it('shares the automatic JSX runtime subpaths as their own peers', () => {
    // A plugin compiled with the automatic JSX runtime imports `jsx`/`jsxs` from
    // `react/jsx-runtime` (and `jsxDEV` from `react/jsx-dev-runtime` in dev). These
    // are separate bare subpaths, so each needs its own import-map entry.
    const map = buildImportMap();
    expect(map['react/jsx-runtime']).toBe('/api/plugins/runtime/react-jsx-runtime.js');
    expect(map['react/jsx-dev-runtime']).toBe('/api/plugins/runtime/react-jsx-dev-runtime.js');
  });

  it('emits the jsx-runtime exports introspected from the host package', async () => {
    const src = await getRuntimeShim(PEER_SLUG['react/jsx-runtime']);
    expect(src).toContain('globalThis.__c4s_shared');
    // The automatic-runtime entry points the plugin resolves to the host singleton.
    expect(src).toContain('export const jsx =');
    expect(src).toContain('export const jsxs =');
  });

  it('emits the fixed @c4s/plugin-runtime surface', async () => {
    const src = await getRuntimeShim(PEER_SLUG['@c4s/plugin-runtime']);
    expect(src).toContain('export const clientPluginHost =');
    expect(src).toContain('export const queryClient =');
    expect(src).toContain('export const editorBridge =');
    expect(src).toContain('export const registerExtensionReferenceType =');
  });

  it('emits the @c4s/plugin-runtime/ui (Host UI Kit) surface from one host bundle', async () => {
    const src = await getRuntimeShim(PEER_SLUG['@c4s/plugin-runtime/ui']);
    // Re-exports from the single shared singleton — one host UI bundle, not a copy.
    expect(src).toContain("globalThis.__c4s_shared[\"@c4s/plugin-runtime/ui\"]");
    // Catalog components + token bridge are re-exported.
    expect(src).toContain('export const EntityListHeader =');
    expect(src).toContain('export const DetailPanelShell =');
    expect(src).toContain('export const useHostTokens =');
  });

  it('shares lucide-react as a curatorial peer (0.1.121, not hook-correctness-gated)', async () => {
    const map = buildImportMap();
    expect(map['lucide-react']).toBe('/api/plugins/runtime/lucide-react.js');
    const src = await getRuntimeShim(PEER_SLUG['lucide-react']);
    expect(src).toContain('globalThis.__c4s_shared');
    // A real icon export, enumerated from the installed package like every peer.
    expect(src).toContain('export const Search =');
  });
});
