import type { PluginManifest } from '@c4s/plugin-runtime';
import { uiKitComponentEntity } from './entity/ui-kit-component/index.js';

/**
 * The built-in envelope contributing `ui-kit-component`
 * (c4s-plugin-host-ui-kit-components `vc51375k`).
 *
 * One `contributes.entities[]` entry and nothing else: no `skills`,
 * `writingStyles`, `subagents` or `commands`. Its backend is the
 * `ui-kit-component-tools` server; its frontend fills `renderChip`,
 * `renderCard`, `renderRow`, `routes` + `detailPanel` and `sidebarTab`, so the
 * type is visible.
 *
 * Version surface: `hostApiVersion: '^2.1.0'` covers the host-side shapes this
 * package fills — the `contributes.entities` slot, the `backend.mcpServer` and
 * frontend slot signatures, and the declarative data contract (`data.schema`
 * flags, `enum` / `maxLength`, the `slugPattern` grammar). Internal to the
 * package: the name, inputs and rule set of `audit_ui_kit_components` and the
 * detail's own components. A record's `stability` says nothing about this
 * package's surface — it is the tier of the catalog component the record
 * describes.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-host-ui-kit-components',
  version: '2.1.28',
  hostApiVersion: '^2.1.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [uiKitComponentEntity],
  },
};
