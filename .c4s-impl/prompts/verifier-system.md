# Role — system verifier (the whole window, one fresh context)

Runs once every unit is `verified`. The same posture as the verifier role: derive, confront, report a table.

## Input

- this prompt, with `## This build`; `app`, the base URL of the running app, when the build has one;
- `state.json`'s `units[]` (ids, goals, recipes) and `conventions[]`;
- the repo (read-only, except running the test commands), `trace.md`, `stubs.json`, `deviations/`;
- the `c4s` CLI; the verifier tools named in `## This build`.

## Checklist

1. **Criteria.** Every criterion named in any unit's recipe — for an initial window that is every criterion of the specification at `<to>`; for a delta window, the window's own criteria plus those whose `checks` field points at an entity the window changed. Read them at the window as `reading-the-spec.md` builds the recipes' reads. Each one: a passing test with the slug in its name, body read, as in behaviour verification.
2. **User jobs.** The user-jobs address in `conventions[]`, read at `<to>`. Initial window: every row; delta window: the rows that name a unit. Per row: one end-to-end test whose name contains `job:<id>` and that walks its success sentence across the named modules — in the browser where the app has a UI, through its API otherwise. A job a unit owns (`units[].jobs`) already has its test from that unit: read its body and run it. Run with the e2e command against `app`, or, when the build has no running app, with the filtered command. A job without a test → `uncovered` on `job:<id>`.
3. **Stubs.** `stubs.json` has no open row; otherwise `uncovered` on `stub:<dependent>-<provider>`.
4. **Deviations.** Every file in `deviations/` has `sent: true`; otherwise `uncovered` on `deviation:<id>`.
5. **Trace.** Initial window: every entity at `<to>` (`c4s release-diff --from initial --to <to> --summary-only --include entities <identity>`) has a `trace.md` line. Delta window: every created or updated entity of the window has one, and no deleted one does.
6. **Full suite** green under the whole-suite command, and the whole e2e command green against `app` when the build has one.

## Output

JSON per `verdict.json`. The loop reopens the unit owning each failed slug (`job:*` reopens the unit that owns the job, or, for a job no unit owns, the last unit its row names; `stub:*` reopens the provider). All covered → the loop marks the brief implemented. Nothing else leaves this run.

## This build

- Identity flags for every `c4s` command: `--project 'app-spec' --workspace 'default'`
- Window: `<from>` = `2.1.55`, `<to>` = `2.1.56` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-55-to-2-1-56` (branch `impl/2-1-55-to-2-1-56`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command. Every requirement is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - Whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, the diff breaks no test you can read. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/bin/**` and `tests/**`; plugin tests under `plugins/*/test/`; golden and snapshot tests (`src/server/services/__snapshots__/system-prompt.golden.test.ts.snap`); `e2e/` specs; `tests/ac-skiplist.json`. Update them by hand.
  - Filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - E2e and smoke commands: none.
  - So a verifier status `covered` means four things: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages. Never run `npm install` or anything else that rewrites the lockfile; if `node_modules` is missing in the worktree, symlink it from the main checkout (`ln -s ../../node_modules node_modules`) and never commit it.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI and API messages are in English. Code comments may stay in the language the surrounding code uses.
- UI tests: React components are tested in vitest without the running app. Use `// @vitest-environment happy-dom` with `createRoot`/`act` (pattern: `src/client/chat/work-clock.render.test.ts`, `src/client/chat/ChatEditorBridge.render.test.ts`), or `renderToStaticMarkup`; hook/reducer logic like `src/client/chat/useChat.turn-endings.test.ts`. Server tests use vitest + supertest (pattern: `src/server/routes/chat.live-join.test.ts`, `src/server/routes/agent-turn.test.ts`, `src/server/routes/chat.config.test.ts`).
- **What this window is.** M05 "Chat & Agent" is split: M05 "Agent Runtime" (channel-agnostic turn engine — server) and M53 "Agent Chat Shell" (chat overlay consuming the turn — client, no own routes or tables). Most content moved without behaviour change; the old page `m05-chat-agent.md` is deleted and its sections (same anchors) live on the two new pages. A section that only moved is not rebuilt: confirm the code still does what it says and that its tests carry the slug. Only what the unit goal lists as new, changed or removed is real work. Module attribution in code (comments, file headers, registration labels that name M05 for client chat code) follows the new split where the code names a module.
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - M05 turn engine (m05-tura): `src/server/routes/chat.ts`, `src/server/routes/agent-turn.ts`, `src/server/routes/threads.ts`, `src/server/services/chat.ts` (+ `chat.background-task.test.ts`, `chat.subagent-task.test.ts`), `src/server/routes/chat.live-join.test.ts`, `chat.user-input-replay.test.ts`, `abort-all-turns.test.ts`, `src/server/services/todos-indexer.ts`, `src/server/services/transagent-dispatcher.ts`; shared stream types under `src/shared/**` (grep `turn_start`, `user_input_request`, `background_task`).
  - M05 policy/config (m05-polityka): `src/server/routes/chat.ts` (config/models), `src/server/routes/models.ts`, `src/server/routes/agent-credential.ts`, `src/server/services/agent-tool-posture.ts`, `agent-path-scope.ts`, `agent-execution-scope.ts`, `agent-settings-fields.ts`, `agent-credential*.ts`; system prompt `src/server/services/system-prompt/blocks/m05-chat-turn.ts` (+ test; holds `<task_tracking>`), `compositions/default.ts`, `src/server/services/chat-context.ts` (+ test), golden snapshot; M05 UI (credentials prompt, key-delete dialog) under `src/client/components/settings/**` / `src/client/chat/settings/`.
  - M53 shell (m53-powloka): `src/client/chat/ChatOverlay.tsx`, `ChatInputEditor.tsx`, `ChatEditorBridge.tsx`, `AnnotationPanel.tsx`, `BlockRenderer.tsx`, `ToolCard.tsx`, `toolRenderers.tsx`, `ChatMarkdown.tsx`, `XmlChipDispatcher.tsx`, `xml-chip-preprocess.ts`, `remark-page-refs.ts`, `chat/settings/`, `startSeededThread.ts`, `chatPrefill.ts`, `useThreadList.ts`, `ThreadListContext.tsx`, `src/client/state/chat.ts`; editor contributions `src/client/tiptap/registrations.ts`, `EditorFactory.ts`, `contextSpec.test.ts`; plugin-surface seeded-thread action under `src/client/runtime/**` / L11.
  - M53 turn state (m53-stan-tury): `src/client/chat/useChat.ts` (+ `useChat.hydration`, `turn-clock`, `turn-endings`, `transagent-reconstruct` tests), `StreamingBubble.tsx`, `ElapsedClock.tsx`, `elapsed.ts`, `CurrentTodoList.tsx`, `BackgroundTaskPanel.tsx`, `SubagentPanel.tsx`, `TransagentPanel.tsx`, `UserInputRequestCard.tsx`, `UsageBadge.tsx`; live-join client side lives in `@inharness-ai/agent-chat` hooks (own library, registry dependency — do not edit it here; a gap there is a deviation).
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts, `[section:<anchor>]` when the requirement is a changed section. An AC that moved to a `-2` suffixed twin (e.g. `ac-…-o` → `ac-…-o-2` in M53) gets its own test tag; an existing test may carry both tags only if it really asserts both halves.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L5 (UI) — stan klienta, pamięć lokalna, okna | pages/layers/L5-ui.md | 2 | tehej2wz |
| L11 (Plugin Runtime Surface) — implementor M33 | pages/layers/L11-plugin-runtime-surface.md | 2 | l11slice0 |
| L15 (Context Types) | pages/layers/L15-context-types.md | 2 | 6jkqb2h4 |
| L16 (System Prompt Contribution) — implementor M48, sections 22–25 (mdvnzemp … mtrrm6m5) | pages/modules/m48-system-prompt-composition.md | 22 | mdvnzemp |
| L16 (System Prompt Contribution) — schema | pages/layers/L16-system-prompt-contribution.md | 2 | 6g3aicw4 |
| User jobs table, for the system verifier | pages/SKILL.md | 13 | oq23nb0j |

The `User jobs table` convention embeds only the `moduly-feature` module index, not a user-jobs table. No unit owns a job. The system verifier works from the units' goals, criteria and built entities.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| code-snippet | built |  |  | szablon-task-tracking (deleted in the window) → the <task_tracking> system-prompt block: its template and builder in src/server/services/system-prompt/blocks/m05-chat-turn.ts, its slot in src/server/services/system-prompt/compositions/default.ts and any wiring in src/server/routes/agent-turn.ts are gone, together with M48's composition test rule for it | a vitest test next to the composition (src/server/services/system-prompt/**.test.ts or the golden test) named with [entity:szablon-task-tracking] asserting the composed system prompt contains no <task_tracking> block; golden snapshots updated accordingly |  |  |
| module-dependency | context |  |  |  |  |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts (per-entity types)

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| wklad-do-edytora-m53 | built | both data rows (Nazwa: "adnotacje page-bound", "`chat-input`") | Nazwa | the editor contribution registered by the chat shell (M53) client code: the page-bound annotation decoration (src/client/tiptap/registrations.ts and the annotation extension) and the chat-input editor context (contextSpec / EditorFactory) — owned/labelled as M53, behaviour unchanged | a vitest/happy-dom test next to the registration (src/client/tiptap/*.test.ts) named with [entity:wklad-do-edytora-m53#<Nazwa>] asserting the decoration is registered directly and non-persisting, and that the chat-input context exists with its slash framework and serialises PageRefNode to @path.md |
| wklad-do-edytora-m05 | context | all |  |  |  |
| moduly-feature | context | all |  |  |  |

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` or was deleted in this window** is not built. Remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **An entity deleted in this window** (`op: delete`) is built as an absence: the code no longer has what the entity described. A test that asserted it is removed or rewritten.
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **`not yet` is binding.** A part of a read that the scope marks as deferred to a later unit is not built in this unit, even when it would be easy; the later unit builds it.
- **Removal without alias is binding.** When a goal or a changed section removes or replaces something, no fallback, alias or dead code path survives, and no test asserts the old behaviour any more.
- **Static verification is weak — compensate.** Tests never run locally, so read a test through as its runner would: module evaluation order for any module a new test imports directly (circular imports hidden by `main.tsx`), happy-dom limits (selectors, layout), React SSR attribute order when matching markup with regexes, async/microtask timing (await the query/refetch the assertion depends on), background work outliving the test (vitest "Unhandled Errors", timers must be cleared or faked).
- **Unused code is always removed.** When a change leaves code without callers (a route, a service method, a helper, a type, a test that only exercises it), delete it in the same unit. Dead code left behind is a **blocking** review finding.
- **Performance is always optimized.** Needless refetches, cache invalidation wider than what actually changed, full re-reads where a narrower read suffices, recomputation on the server — fix them in the same unit. A performance problem is a **blocking** review finding, never "efficiency only".
