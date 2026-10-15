# u1-version-release-id — non-blocking review findings

- **rev-0001** `src/shared/plugin-host/host-api.ts:223` — the 2.1.25 entry sits at the top of HOST_API_UNVERSIONED_CHANGES. The rest of the list is chronological, so it should be appended after 2.1.21.
- **rev-0002** `tests/integration/api/entities-router-generic-versions.test.ts:162` — the declared-200 proof regex-matches source text. It is brittle; a type-level assertion would be sturdier.
- **rev-0003** `src/server/core/plugin-host/entities-router.ts:136` — `ENTITY_VERSIONS_ROUTE` is a declaration that nothing enforces against the real route. It is a stand-in, because the repo has no route-schema layer.
