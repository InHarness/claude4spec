/**
 * M34 / L12 ↔ L11 — the versioned slice of the Host UI Kit.
 *
 * React-free so both the server (`server/plugin-runtime/ui.ts`) and the version
 * surface (`host-api.ts`) can reference it without importing the client catalog
 * (which pulls in React). The client catalog (`client/host-ui-kit/registry.ts`)
 * derives the SAME stable set from the components' field-level `stability`
 * constants; a test asserts the two agree, so this list can't silently drift
 * from the actual components.
 */

/** Per-component stability tier. */
export type Stability = 'stable' | 'experimental';

/**
 * The catalog components whose prop contracts are part of the versioned
 * `hostApiVersion` surface — the `stable` (Core) tier only. A breaking
 * prop-shape change to any of these requires a major `hostApiVersion` bump + a
 * `migrations[]` descriptor (see {@link file://./host-api.ts}). `experimental`
 * components are exposed by `/ui` but excluded from the surface; promoting one
 * to `stable` adds it here.
 */
export const UI_KIT_STABLE_COMPONENTS = [
  'EntityListHeader',
  'DetailPanelShell',
  'FieldRow',
  'FieldGrid',
] as const;

export type StableUiKitComponent = (typeof UI_KIT_STABLE_COMPONENTS)[number];
