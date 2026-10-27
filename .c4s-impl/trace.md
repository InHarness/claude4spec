remote-session → src/server/db/migrations/000_baseline.sql
get-api-remote-account → src/server/routes/remote-account.ts
remote-account-response → src/shared/remote-account.ts
app-config-response → src/server/routes/config.ts
patch-config-request → src/server/services/remote-settings-fields.ts
release-detail → src/client/components/ReleaseDetail.tsx
config-json-shape → src/server/config.ts
flagi-cli-m01#--create-project → src/bin/launch.ts
file-version → src/server/db/migrations/000_baseline.sql
release-service-contract → src/server/services/release.ts
spec-snapshot-entity-row → src/shared/entities.ts
get-api-releases-nameorid-snapshot → src/server/routes/releases.ts
git-service-contract → src/server/services/git.ts
release → src/shared/entities.ts
get-api-git-status → src/server/routes/git.ts
get-api-git-branches → src/server/routes/git.ts
- system verification r1 (env 2-1-54-to-2-1-55, sha 3b5f75d4): release-pages-roots.test.ts 5/5 red — createRelease with description '' (RELEASE_DESCRIPTION_REQUIRED); fixed test inputs. chat.live-join flake green 3/3 in isolation. e2e red files (artifact-threads-panel, plan-footer, entity-version-history: "seed one first"; envelope-entity-pages, frontend-mockups-envelope green 2/2 in isolation) — seed/flake, same set as main env 2-1-53-to-2-1-54.
