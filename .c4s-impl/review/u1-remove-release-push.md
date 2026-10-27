# u1-remove-release-push — non-blocking review findings

- **rev-0001** (`src/shared/git.ts:189`, p1-l1-l3): doc comments still name deleted M25 types/service (`ReleasePushResponse` in src/shared/git.ts:189 and src/shared/release-import.ts:3; `ReleasePushService` in src/server/services/release-import.ts:3, git.ts:1040/:1153, release.ts:543). The code itself is removed by u2/u3/u4; reword the comments when those units touch these files.
