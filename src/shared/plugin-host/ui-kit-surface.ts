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
 * Per-component binding class — how a catalog component gets its data.
 *
 *  - `presentational` — no access to the live host: no `useQuery()`, no
 *    `useEditor()`, no fetch. The default doctrine, and the whole `stable` core
 *    is `presentational`.
 *  - `connected` — the component reaches host-owned data / singletons through
 *    the L11 runtime surface itself. Every `connected` entry must name the L11
 *    surface it consumes (`l11Surfaces` on the catalog entry).
 *
 * `connected` moves the FETCH axis only, never the domain-computation axis: the
 * kit still renders rather than computes — versioning, diff algorithms and
 * release semantics stay in the domain modules (M13/M17).
 */
export type Binding = 'presentational' | 'connected';

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
