post-api-git-fetch → src/server/routes/git.ts (POST /fetch) + src/server/services/git.ts (GitService.fetch); test src/server/routes/git.test.ts
git-fetch-response → src/shared/git.ts (GitFetchResponse), src/server/services/git.ts fetch(); tests src/server/routes/git.test.ts, src/server/services/git-lock.test.ts (busy → message null)
git-status-response → src/shared/git.ts (GitStatusResponse: ahead/behind/lastFetchedAt required) + src/server/routes/git.ts (GET /status); test src/server/routes/git.test.ts
