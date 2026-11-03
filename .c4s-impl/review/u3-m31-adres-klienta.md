## u3-m31-adres-klienta — review round 1 (non-blocking)

- **rev-0001** `src/server/workspace/address-composition.test.ts:31`: the test re-implements the client composition rule in a local `composeProjectUrl` helper (with an extra `encodeURIComponent`) instead of exercising `apiFetch` in `src/client/lib/api-core.ts`. A regression in `apiFetch` would go unnoticed. Suggested fix: assert the URL `apiFetch` produces (stub `fetch`, set `window.__C4S_PROJECT__`), or use the literal URL and drop the helper.
