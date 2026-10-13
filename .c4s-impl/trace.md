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
section:tbeatf5z → src/client/runtime/plugin-runtime.ts (openPopover, openModal, confirmDestructive, toast — the host's own functions from src/client/ui/events.ts, `kind` typed open), src/plugin-types/plugin-runtime.ts (published signatures), src/plugin-types/ambient.d.ts; tests src/client/runtime/window-facades.render.test.ts, src/server/plugin-runtime/l11-surfaces.test.ts, src/plugin-types/ambient-legs.test.ts
section:l5pregst → src/client/ui/events.ts (confirmDestructive extended options, toast.*(msg, action?)); test src/client/runtime/window-facades.render.test.ts
section:l5pextnd → src/client/runtime/plugin-runtime.ts (PluginOpenPopover / PluginOpenModal / confirmDestructive typed `kind: string`); test src/client/runtime/window-facades.render.test.ts
section:77rzi036 → src/client/ui/events.ts (UI_EVENTS), plugins/*/src (frontend-kit/host-events.ts removed; envelopes import the facades from @c4s/plugin-runtime); test src/client/runtime/window-facades.render.test.ts
section:wkkqzeum → src/client/ui/ToastHost.tsx (controlled ToastViewport); test src/client/runtime/window-facades.render.test.ts
section:m33rt001 → src/shared/plugin-host/runtime-legs.ts (M50 row), src/shared/plugin-host/frontend-manifest.ts (PLUGIN_RUNTIME_EXPORT_NAMES)
section:m33load01 → src/shared/plugin-host/host-api.ts (HOST_API_UNVERSIONED_CHANGES: window facades record)
ac-plugin-otwiera-okno-potwierdzenia-prz → plugins/c4s-plugin-*/src/**/delete-confirm.ts, detail-panel.tsx, examples-panel.tsx (confirmDestructive from @c4s/plugin-runtime); test src/client/runtime/window-facades.render.test.ts
section:m34l12sc → src/client/host-ui-kit/overlay-feedback/useToast.ts (useToast = thin layer over the shell `toast` facade, beside the catalog); test src/client/host-ui-kit/overlay-feedback/useToast.render.test.ts
section:wbs9m5zj → src/client/host-ui-kit/overlay-feedback/ToastViewport.tsx (controlled stack only; self-managed `c4s-ui:toast` fallback and src/client/host-ui-kit/overlay-feedback/toast-store.ts removed), src/client/ui/ToastHost.tsx (the one host stack); test src/client/host-ui-kit/overlay-feedback/useToast.render.test.ts
section:l0i0c5wm → src/client/host-ui-kit/overlay-feedback/useToast.ts, src/plugin-types/ui.ts (published useToast doc); test src/client/host-ui-kit/overlay-feedback/useToast.render.test.ts
ac-toast-wywolany-przez-usetoast-z-c4s-p → src/client/host-ui-kit/overlay-feedback/useToast.ts, src/client/ui/ToastHost.tsx; test src/client/host-ui-kit/overlay-feedback/useToast.render.test.ts
ac-toastviewport-usetoast-grupa-overlay → src/client/host-ui-kit/registry.ts (ToastViewport, group feedback), src/client/host-ui-kit/overlay-feedback/useToast.ts; test src/client/host-ui-kit/overlay-feedback/useToast.render.test.ts
