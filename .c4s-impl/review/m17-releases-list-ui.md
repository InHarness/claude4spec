# Review m17-releases-list-ui — non-blocking findings

- **rev-0002** `src/client/components/ReleasesPage.render.test.ts:260` — the removed-deep-link test reads router.tsx source via `readFileSync(process.cwd())` and checks `ReleasesPage.length === 0`; brittle (cwd, formatting). Prefer a behavioural assertion: render the route, `?tab=compare` does not select Compare.
