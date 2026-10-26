git-service-contract → src/server/services/git.ts (GitService; result types in src/shared/git.ts) — test src/server/services/git-merge-primitives.test.ts "[entity:git-service-contract]"
section:ezudoqef → src/server/services/git.ts (GitRepoLock, tryWithRepoLock, commit/commitOnRelease lockHandle)
section:es9w55mr → src/server/services/git.ts (pendingChanges, mergeIntoIndex, abortMerge, mergePrimitiveRoot)
section:m28aug01 → src/server/services/git.ts (diffRefs, statusAheadBehind, resolveReleaseCommit)
section:57bep23m → src/server/services/git.ts (resolveReleaseCommit, findFirstAdd)
section:c38qf5p5 → src/server/fs/watcher.ts (OPERATION_SUPPRESS_LIMIT_MS — the operation suppression limit; expiry warning names it and logs its value)
release-service-contract → src/server/services/release.ts (ReleaseService; createRelease: cache row in the transaction, metadata file after commit logged not thrown, no git hook) — test src/server/services/release-create-transaction.test.ts "[entity:release-service-contract]"
section:spdg8mon → src/server/services/release.ts (createRelease: transaction → file, no separate cache rebuild; failed file write logged, release stands without a marker)
section:w6cocvik → src/server/routes/releases.ts (POST /) + src/server/mcp/release-tools/index.ts (release_create) — commitOnRelease called by the channel after createRelease returns
section:ry0bx4ji → src/server/services/entity-indexer.ts (indexAll / per-file reindex — no entity_version INSERT; sync() merged entity changes arrive this way) — test tests/integration/api/sync-merge-entity-version.test.ts
