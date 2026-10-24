# u2-git-merge-primitives — non-blocking review findings

- rev-0002 `src/server/services/git.ts:1217` — `tipSha` goes to `git merge --no-commit --no-ff <tipSha>` unchecked. If the value starts with `-`, git reads it as an option. Today the only caller is internal (u4 reads it from refs/runs/*), but this primitive is the boundary. Check that it is a full hex object id (/^[0-9a-f]{40,64}$/) before the merge, or resolve it with `rev-parse --verify <sha>^{commit}`.
