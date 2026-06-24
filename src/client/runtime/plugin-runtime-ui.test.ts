import { describe, expect, it } from 'vitest';
import * as pluginRuntimeUi from './plugin-runtime-ui.js';
import { PLUGIN_RUNTIME_UI_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';

describe('@c4s/plugin-runtime/ui export parity', () => {
  it('the shim export-name list matches the module value exports (no drift)', () => {
    // Type-only re-exports are erased at runtime, so Object.keys = value exports.
    const actual = new Set(Object.keys(pluginRuntimeUi));
    const declared = new Set<string>(PLUGIN_RUNTIME_UI_EXPORT_NAMES);
    expect(actual).toEqual(declared);
  });
});
