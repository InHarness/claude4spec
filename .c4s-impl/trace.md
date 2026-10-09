post-api-git-fetch → src/server/routes/git.ts (POST /fetch) + src/server/services/git.ts (GitService.fetch); test src/server/routes/git.test.ts
git-fetch-response → src/shared/git.ts (GitFetchResponse), src/server/services/git.ts fetch(); tests src/server/routes/git.test.ts, src/server/services/git-lock.test.ts (busy → message null)
git-status-response → src/shared/git.ts (GitStatusResponse: ahead/behind/lastFetchedAt required) + src/server/routes/git.ts (GET /status); test src/server/routes/git.test.ts
post-api-git-sync → src/server/routes/git.ts (POST /sync, onHeadChanged reload) + src/server/services/git.ts (GitService.sync); test src/server/routes/git-sync.test.ts
git-sync-response → src/shared/git.ts (GitSyncResponse, GitSyncStatus, GitSyncDivergedReason) + src/server/services/git.ts syncResult(); test src/server/routes/git-sync.test.ts

## u3-header-fetch-sync-ui (implementer, p1-l5-l10)

- ac-klient-po-odebraniu-git-status-change → src/client/lib/git-ws.ts (handleGitStatusChanged: `git:status-changed` → queue `["git-status"]`), wired in src/client/hooks/useFileWatcher.ts; test src/client/hooks/useGitStatus.refresh.test.ts
- ac-klient-po-powrocie-fokusu-okna-pobier → src/client/hooks/useGitStatus.ts (window `focus` + `visibilitychange` → refetch `["git-status"]`); test src/client/hooks/useGitStatus.refresh.test.ts
- ac-klient-ktory-nie-inicjowal-operacji-p → src/client/lib/git-ws.ts (headChanged without an own sync/checkout in flight → reloadProjectRoute), src/client/state/gitOps.ts (own op), src/client/lib/project-reload.ts; test src/client/hooks/useGitStatus.refresh.test.ts
- goal (header switcher: Fetch, `Sync ↓N`, spinner/lock, toasts/hints, "Last fetched …", reload after sync moved HEAD) → src/client/components/GitStatusBadge.tsx, src/client/lib/git-results.ts, src/client/lib/git-flash.ts, src/client/hooks/useGitRemoteOps.ts, src/client/hooks/useGitCheckout.ts, src/client/lib/git-api.ts (fetch/sync); tests src/client/components/GitStatusBadge.render.test.ts, src/client/lib/git-results.test.ts

## u4-push-non-fast-forward-recovery (implementer, p1-l2-l5)

- release-push-response → src/shared/git.ts (GitErrorRecovery.kind + 'non-fast-forward'), src/shared/release-push.ts (gitSync doc), src/server/services/git.ts (pushUnlocked → isNonFastForwardRejection → buildRecovery(kind 'non-fast-forward')), src/server/services/release-push.ts (gitSync passthrough, unchanged); test src/server/routes/release-pushes.test.ts
- ac-push-wydania-odrzucony-przez-remote-j → src/server/services/git.ts (push non-fast-forward recovery kind); test src/server/routes/release-pushes.test.ts
- ac-okno-git-sync-recover-dla-recovery-ki → src/client/ui/modals/GitSyncRecover.tsx (Sync action → useGitSync → syncOutcome toasts / flash + route reload); test src/client/ui/modals/GitSyncRecover.render.test.ts
- ac-gdy-gitsync-status-error-operacje → src/client/ui/modals/GitSyncRecover.tsx (Fix it with Agent + Dismiss; Sync instead for non-fast-forward), src/client/ui/events.ts (showGitErrorModal); test src/client/ui/modals/GitSyncRecover.render.test.ts
