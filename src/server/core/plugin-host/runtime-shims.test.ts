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

  it('emits the fixed @c4s/plugin-runtime surface', async () => {
    const src = await getRuntimeShim(PEER_SLUG['@c4s/plugin-runtime']);
    expect(src).toContain('export const clientPluginHost =');
    expect(src).toContain('export const queryClient =');
    expect(src).toContain('export const editorBridge =');
    expect(src).toContain('export const registerExtensionReferenceType =');
  });
});
