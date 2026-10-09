post-api-git-fetch → src/server/routes/git.ts (POST /fetch) + src/server/services/git.ts (GitService.fetch); test src/server/routes/git.test.ts
git-fetch-response → src/shared/git.ts (GitFetchResponse), src/server/services/git.ts fetch(); tests src/server/routes/git.test.ts, src/server/services/git-lock.test.ts (busy → message null)
git-status-response → src/shared/git.ts (GitStatusResponse: ahead/behind/lastFetchedAt required) + src/server/routes/git.ts (GET /status); test src/server/routes/git.test.ts
post-api-git-sync → src/server/routes/git.ts (POST /sync, onHeadChanged reload) + src/server/services/git.ts (GitService.sync); test src/server/routes/git-sync.test.ts
git-sync-response → src/shared/git.ts (GitSyncResponse, GitSyncStatus, GitSyncDivergedReason) + src/server/services/git.ts syncResult(); test src/server/routes/git-sync.test.ts
