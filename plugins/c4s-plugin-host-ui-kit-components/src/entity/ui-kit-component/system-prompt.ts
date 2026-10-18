import type { SystemPromptContribution } from '@c4s/plugin-runtime';
import { UI_KIT_AUDIT_TOOL, UI_KIT_TOOLS_SERVER } from '../../identity.js';

/**
 * The `systemPrompt` of the manifest (c4s-plugin-host-ui-kit-components
 * `spf7qirh`): no `defaultPredicate`; the tools line names the one audit tool;
 * the narrative carries the authoring rules no schema can express. Rendered in
 * English like every other type's block.
 */
export const uiKitComponentSystemPrompt: SystemPromptContribution = {
  roleNoun: 'UI Kit components',
  mcpToolsLine: `${UI_KIT_TOOLS_SERVER}: ${UI_KIT_AUDIT_TOOL}`,
  narrativeBlock:
    'A `ui-kit-component` record is one export of `@c4s/plugin-runtime/ui`. ' +
    'A page that names a component embeds it with `inline_mention`; everything about one component goes into its record only, never into page prose. ' +
    '`behavior` keeps a fixed layout of bold-led paragraphs: **Zachowanie**, **Czego nie ma**, **Alternatywy**, **Uzasadnienie** — in that order and only those with content. ' +
    'Tag the record with the host module that contributes the component, plus `l12`. ' +
    'Fill `dataSources` with names from the `@c4s/plugin-runtime` inventory; use `usage: fetchedByComponent` only on a `connected` record, and a `connected` record must have at least one such entry. ' +
    'Changing `props` of a `stable` component requires a Host API changelog entry.',
};
