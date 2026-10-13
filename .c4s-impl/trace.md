section:m33load01 → src/shared/plugin-host/host-api.ts (HOST_API_RELEASES, HOST_API_UNVERSIONED_CHANGES, recordedUiKitStableComponents)
section:m33rt001 → src/shared/plugin-host/runtime-legs.ts (PLUGIN_RUNTIME_LEGS)
section:ywud56l6 → tests/helpers/plugin-test-setup.ts (+ `@c4s-internal/plugin-test-setup` alias in vitest.config.ts and plugins/*/vitest.config.ts)
section:m33l11sc → package.json (exports: `./plugin-runtime/ambient` per leg, no `./plugin-testing`), src/plugin-types/ambient.d.ts (browser leg), src/plugin-types/ambient-backend.d.ts (backend leg)
section:m13l11sc → src/shared/plugin-host/runtime-legs.ts (M13 rows), src/plugin-types/plugin-runtime.ts, src/plugin-types/ambient*.d.ts
section:m05l11sc → src/shared/plugin-host/runtime-legs.ts (M05 row: startSeededThread), src/plugin-types/ambient.d.ts
section:mn59j0le → src/shared/plugin-host/runtime-legs.ts (M18 row), src/plugin-types/plugin-runtime.ts, src/plugin-types/ambient.d.ts
section:m20l11sc → src/shared/plugin-host/runtime-legs.ts (M20 row), src/plugin-types/plugin-runtime.ts, src/plugin-types/ambient.d.ts
section:gz7q92lz → src/shared/plugin-host/runtime-legs.ts (M39 row), src/server/plugin-runtime/index.ts, src/plugin-types/ambient-backend.d.ts
section:m34l12sc → src/client/host-ui-kit/registry.ts (UI_KIT_CATALOG, STABLE_UI_KIT_COMPONENTS), src/client/host-ui-kit/index.ts (/ui browser surface), src/server/plugin-runtime/ui.ts (backend /ui leg: UI_KIT_STABLE_COMPONENTS); test src/client/host-ui-kit/registry.test.ts
get-api-plugins-frontend-manifest → src/server/routes/plugins.ts (GET /plugins/frontend-manifest), src/server/core/plugin-host/frontend-manifest.ts (buildFrontendManifest); test src/server/routes/plugins.frontend.test.ts
get-api-plugins-name-asset → src/server/routes/plugins.ts (GET /plugins/:name/:asset), src/server/core/plugin-host/frontend-assets.ts (resolvePluginAsset, effectiveFrontendSources); test src/server/routes/plugins.frontend.test.ts
frontend-manifest-response → src/shared/plugin-host/frontend-manifest.ts (FrontendManifestResponse, PluginFrontendEntry); test src/server/routes/plugins.frontend.test.ts
plugin-frontend-asset-error → src/shared/plugin-host/frontend-manifest.ts (PluginFrontendAssetError, PLUGIN_FRONTEND_NOT_FOUND); test src/server/routes/plugins.frontend.test.ts
