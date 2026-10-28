// @vitest-environment happy-dom
/**
 * M13 `m26esec` (2.1.58) — the two axes of plugin management on the settings
 * page. Axis B (pool composition) is shown read-only on the Plugin pool card;
 * its base package list is a fact of the workspace (M31), not of the project
 * config file, and the card does not send the user to edit it anywhere.
 */
import { describe, expect, it, vi } from 'vitest';

// The card declarations are data; the plugin boot graph behind the Entities
// card's save hook (tiptap mounting, shared runtime) is not needed to read them.
vi.mock('../../runtime/boot-plugins.js', () => ({ refreshPluginActivation: async () => {} }));

import { PLUGIN_HOST_SETTINGS } from './pluginSettings.js';

describe('[section:m26esec] plugin pool card — axis B, read-only', () => {
  const card = (PLUGIN_HOST_SETTINGS.cards ?? []).find((c) => c.anchor === 'plugin-pool');

  it('[section:m26esec] describes the base as the workspace\'s plugin list, not something the workspace switch edits', () => {
    expect(card).toBeDefined();
    const text = card!.description ?? '';
    expect(text).toMatch(/Read-only/);
    expect(text).toMatch(/workspace's plugin list/);
    expect(text).not.toMatch(/workspace switch/i);
    expect(text).not.toMatch(/config/i);
  });

  it('[section:m26esec] edits nothing: no element of the card writes a config key', () => {
    const elements = (PLUGIN_HOST_SETTINGS.elements ?? []).filter((e) => e.card === 'plugin-pool');
    expect(elements.length).toBeGreaterThan(0);
    for (const e of elements) expect('configKey' in e ? (e as { configKey?: unknown }).configKey : undefined).toBeUndefined();
  });
});
