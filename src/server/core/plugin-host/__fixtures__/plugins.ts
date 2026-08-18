/**
 * M33 — reusable plugin manifest fixtures for tests and the local smoke
 * test. `plugin-foo` is an entity-less plugin exercising `contributes.settings`
 * + `contributes.commands` + the optional `onUnregister` (optional since 0.2.29 —
 * declared here only so tests can spy on it, NOT because a plugin needs it);
 * `plugin-legacy`
 * targets a different major Host API (`^1.0.0`) so it is reported `incompatible`
 * under the current `2.0.0` host (drives the `c4s plugins doctor` / `/_meta/plugins`
 * paths). Kept dep-free so they double as the body of a real ESM overlay
 * package when emitted to `.claude4spec/plugins/<pkg>/`.
 */

import type { PluginManifest } from '../../../../shared/plugin-host/manifest.js';

/**
 * Entity-less plugin with settings + commands. `onUnregister` is overridable so a
 * test can spy on teardown — a real declarative package omits the slot entirely.
 */
export function fooManifest(onUnregister: () => void = () => {}): PluginManifest {
  return {
    name: '@c4s/plugin-foo',
    version: '0.1.0',
    hostApiVersion: '^2.0.0',
    onUnregister,
    contributes: {
      settings: [
        {
          key: 'enableBadge',
          label: 'Enable badge',
          control: 'toggle',
          kind: 'hot-reload',
          default: true,
          help: 'Show the foo badge in the sidebar.',
        },
        {
          key: 'apiBase',
          label: 'API base URL',
          control: 'text',
          kind: 'executive',
          default: 'https://example.test',
        },
      ],
      commands: [
        {
          name: 'foo-insert',
          trigger: 'foo',
          label: 'Insert Foo',
          popoverKind: 'foo',
        },
      ],
    },
  };
}

/** Plugin built against a different major Host API (`^1.0.0`) — incompatible under 2.0.0. */
export function legacyManifest(onUnregister: () => void = () => {}): PluginManifest {
  return {
    name: '@c4s/plugin-legacy',
    version: '0.9.0',
    hostApiVersion: '^1.0.0',
    onUnregister,
    contributes: {},
  };
}
