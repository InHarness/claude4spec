# Plugin author type stubs

Hand-written ambient `.d.ts` declarations for the host-provided module
specifiers a runtime plugin imports:

- [`plugin-runtime.d.ts`](./plugin-runtime.d.ts) — `@c4s/plugin-runtime`
  (live host singletons: plugin registry, `QueryClient`, editor bridge,
  extension-reference registry, `HOST_API_VERSION`, `FrontendModule` & slot
  prop types).
- [`plugin-runtime-ui.d.ts`](./plugin-runtime-ui.d.ts) — `@c4s/plugin-runtime/ui`
  (the stable Host UI Kit components: `DetailPanelShell`, `FieldRow`,
  `FieldGrid`, `EntityListHeader`).

## Why these exist

`@c4s/plugin-runtime` and `@c4s/plugin-runtime/ui` are **not npm packages**. The
host serves them to your plugin at load time via an import map, so your plugin
and the host share ONE copy of React, the registry, the `QueryClient`, etc.
Because nothing is published to npm, the type declarations are not published
either — a deliberate "in-repo module, not an npm package" consequence. Without
a stub, TypeScript in your plugin repo reports `Cannot find module
'@c4s/plugin-runtime'`.

## How to use

1. Copy both `.d.ts` files into your plugin repo (any folder your `tsconfig`
   includes, e.g. `types/`).
2. Add the host peers as devDependencies so their types resolve: `react`,
   `react-dom`, `@tiptap/core`, `@tanstack/react-query`, `lucide-react`.
3. `import { registerFrontendModule } from '@c4s/plugin-runtime'` and
   `import { DetailPanelShell } from '@c4s/plugin-runtime/ui'` now type-check.

These are **type-only** stubs (no runtime code) and a hand-maintained mirror of
the host source (`src/client/runtime/plugin-runtime.ts`,
`src/client/host-ui-kit/`). Re-copy them after a Host API change.

> These files live outside every `tsconfig` `include` in this repo, so they are
> not part of the host build — they are a copy-paste reference for plugin authors.
