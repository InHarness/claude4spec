import { describe, expect, it } from 'vitest';
import * as pluginRuntime from './plugin-runtime.js';
import type { EditorBridge } from './plugin-runtime.js';
import { PLUGIN_RUNTIME_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';
import { editorBridge as hostEditorBridge } from './editor-bridge.js';
import { EditorBridgeProvider as hostEditorBridgeProvider } from '../tiptap/EditorContext.js';

describe('@c4s/plugin-runtime export parity', () => {
  it('the shim export-name list matches the module value exports (no drift)', () => {
    // Type-only re-exports are erased at runtime, so Object.keys = value exports.
    const actual = new Set(Object.keys(pluginRuntime));
    const declared = new Set<string>(PLUGIN_RUNTIME_EXPORT_NAMES);
    expect(actual).toEqual(declared);
  });

  it('[section:m19l11sc] the frontend module re-exports the host\'s own editorBridge singleton and EditorBridgeProvider (not a copy), types them by EditorBridge, and exports no useEditorBridge', () => {
    expect(pluginRuntime.editorBridge).toBe(hostEditorBridge);
    expect(pluginRuntime.EditorBridgeProvider).toBe(hostEditorBridgeProvider);
    // The `EditorBridge` type is importable from the same module.
    const bridge: EditorBridge = { openEntity: () => undefined, openSection: () => undefined };
    expect(Object.keys(bridge).sort()).toEqual(['openEntity', 'openSection']);
    // The hook stays host-internal: no export, no alias.
    expect(pluginRuntime).not.toHaveProperty('useEditorBridge');
    expect(Object.keys(pluginRuntime).filter((k) => /^use.*Bridge/i.test(k))).toEqual([]);
  });
});
