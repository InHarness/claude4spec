/**
 * 2.1.20 (M33 `m33rt001`) — the leg inventory of `@c4s/plugin-runtime`.
 *
 * Every VALUE the specifier carries belongs to a leg: the browser leg (the
 * import-map shim, `client/runtime/plugin-runtime.ts`), the backend leg (the
 * Node barrel, `server/plugin-runtime/index.ts`, reached through the host-owned
 * resolver or the published-subpath fallback), or both. M33 owns only that
 * membership — a fact of transport; the contract of each name is held by its
 * owner module, in the section the row points at. Types travel the type
 * channel (`…/plugin-runtime/ambient`) and are not listed here.
 *
 * The legs are asymmetric: a name on the backend leg only does not exist in the
 * browser shim, so a plugin frontend that imports it statically fails to link as
 * an ES module. The only name both legs carry is `HOST_API_VERSION`.
 *
 * React-free and dependency-free, so both the server and the client may read it.
 * A test holds the two barrels (and the shim's export list) equal to it.
 */

/** Which end of the process a runtime value is served on. */
export type PluginRuntimeLeg = 'browser' | 'backend' | 'both';

/** The owner module of a group of names, and the section holding their contract. */
export interface PluginRuntimeContract {
  module: string;
  anchor: string;
}

/** One row of the inventory: names, their leg, and where their contract lives. */
export interface PluginRuntimeLegRow {
  names: readonly string[];
  leg: PluginRuntimeLeg;
  contract: PluginRuntimeContract;
}

export const PLUGIN_RUNTIME_LEGS: readonly PluginRuntimeLegRow[] = [
  { names: ['HOST_API_VERSION'], leg: 'both', contract: { module: 'M33', anchor: 'm33load01' } },
  {
    names: [
      'createMcpServer',
      'mcpTool',
      'z',
      'checkValidator',
      'validatorMessage',
      'contentBytes',
      'DEFAULT_CONTENT_OPERATION',
    ],
    leg: 'backend',
    contract: { module: 'M13', anchor: 'm13l11sc' },
  },
  {
    names: ['TOOL_RESULT_CEILING_TOKENS', 'DomainError'],
    leg: 'backend',
    contract: { module: 'M39', anchor: 'gz7q92lz' },
  },
  {
    names: [
      'clientPluginHost',
      'registerFrontendModule',
      'queryClient',
      'versionService',
      'useVersions',
      'useVersionDetail',
      'useRestoreVersion',
      'useVersionDiff',
      'lineDiffHunks',
      // 2.1.41 — experimental.
      'useRefLookup',
    ],
    leg: 'browser',
    contract: { module: 'M13', anchor: 'm13l11sc' },
  },
  {
    names: ['editorBridge', 'EditorBridgeProvider'],
    leg: 'browser',
    contract: { module: 'M20', anchor: 'm20l11sc' },
  },
  {
    names: ['tagsService', 'useTags', 'useEntityTags', 'useAssignTags', 'useRemoveEntityTag', 'useCreateTag'],
    leg: 'browser',
    contract: { module: 'M18', anchor: 'mn59j0le' },
  },
  {
    names: ['referencesService', 'useReferences'],
    leg: 'browser',
    contract: { module: 'M19', anchor: 'm19l11sc' },
  },
  {
    names: ['releasesService', 'useReleases'],
    leg: 'browser',
    contract: { module: 'M17', anchor: 'm17l11sc' },
  },
  {
    names: ['startSeededThread'],
    leg: 'browser',
    contract: { module: 'M05', anchor: 'm05l11sc' },
  },
  {
    names: ['openPopover', 'openModal', 'confirmDestructive', 'toast'],
    leg: 'browser',
    contract: { module: 'M50', anchor: 'tbeatf5z' },
  },
];

/** The value names a leg serves: its own rows plus the `both` rows. */
export function pluginRuntimeNamesOnLeg(leg: 'browser' | 'backend'): string[] {
  return PLUGIN_RUNTIME_LEGS.filter((row) => row.leg === leg || row.leg === 'both').flatMap((row) => [
    ...row.names,
  ]);
}

/** The leg a name belongs to, or `undefined` for a name `@c4s/plugin-runtime` does not carry. */
export function pluginRuntimeLegOf(name: string): PluginRuntimeLeg | undefined {
  return PLUGIN_RUNTIME_LEGS.find((row) => row.names.includes(name))?.leg;
}
