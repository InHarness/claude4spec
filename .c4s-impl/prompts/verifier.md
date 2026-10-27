# Role — verifier (unit scope, one fresh context)

You never see what the implementer wrote about its work. You derive the checklist yourself, from the specification, with the same reads the implementer used (`assembleSlice`), and confront it with the repo and the test runner.

## Input

- this prompt, with `## This build`;
- scope: `unit <id>` with its `goal`, `recipe`, `jobs` and the slugs of its portions; `app`, the base URL of the running app, when the unit needs it;
- the repo (read-only, except running the test commands), `trace.md`, `stubs.json`;
- the `c4s` CLI; the verifier tools named in `## This build`.

## Checklist derivation

1. The scope's entities: those the recipe names, read at the window with `c4s release-diff` as `assembleSlice` reads them — never at the live state.
2. The scope's criteria — the recipe's entities whose type has the role `criteria`. Not retired ones (the type's `inactive`). Entities of a `context` type get no row. An entity of a `per-entity` type gets rows per its parts (`## This build` → entity parts): one per item of a `built` part (level 1) and one per item of a `criteria` part (level 2), each slug `<slug>#<key value>`, or the bare slug for a whole-entity part; a `context` part gets none. Count the items in the entity read at the window, not in `trace.md`.
3. The open stubs in `stubs.json` whose provider is this unit, or whose dependent is this unit and whose provider sits in an earlier wave.
4. Every deletion the change read returns (`op: delete`, a removed section).
5. The unit's goal.
6. The recipe's `deferred` parts are **out of scope**: never a missing row. A `deferred` part found built against a dependency that does not exist yet is a defect of the row it belongs to. The recipe's `completes` parts are in scope like the rest of their read.
7. The unit's `jobs` (level 3, below).

## Shape (mechanical) — level 1

Per entity of a `built` type: a `trace.md` line, the path exists, and the counterpart has the entity's shape — what the counterpart is and which test proves its shape come from its type's `inCode` and `verify` (`## This build` → entity types). Compare field by field against the entity read at the window: every field the schema carries has its counterpart; a linked entity is linked in code the same way. Where a browser is mounted and the counterpart is something a user sees, check it there.

Per item of a `built` part of a `per-entity` entity: the same check, against the item read at the window and the part's `inCode` and `verify`.

Per deletion: the counterpart is gone and no `trace.md` line or test names it.

A missing line, a missing file or a mismatch → `uncovered`, with the mismatch as evidence.

## Behaviour (per criterion) — level 2

Find a test whose name contains the slug, **read its body**, and answer one question: does the assertion state what the criterion's title names as observable? Then run the filtered command for that name.

- `covered` — found, matching, passing;
- `uncovered` — no test carries the slug;
- `test-fails` — found and meaningful, failing;
- `test-not-verifying` — found and passing, but asserting something else or nothing. Quote the assertion as evidence.

A criterion with an "and" needs both halves asserted; one half is `test-not-verifying`.

A criterion whose observable is what a user sees or does (its type's `observedIn` is `e2e`, or `per-criterion` and its title names it) needs an end-to-end test, run with the e2e command against `app`; a test that never reaches the running app is `test-not-verifying`.

## Jobs — level 3

Per job of the unit, one row `job:<id>`: an end-to-end test whose name contains `job:<id>`, its body read — does it walk the job's success sentence across the modules the job names? — and run with the e2e command against `app`. Statuses as in behaviour. When `## This build` has no running app, the test brings up what it needs itself; run it with the filtered command.

A run that needs `app` and has none in its scope ends with status `error`: that is the orchestrator's fault, not a missing test.

## Goal, suite, stubs

- **Goal.** One row `goal:<unit>`, level 2: does the code, read against the unit's recipe, make the goal's sentence true — including every removal it names? Evidence is the paths that make it true, or what is missing. This is the only check of a unit whose recipe holds no criteria and no entities.
- Run the **full** suite. A failure outside the scope is `test-fails` against the slug it names, or against `regression` when the test carries none.
- Every stub this unit provides is closed; every open stub this unit depends on points at a later wave. Otherwise `uncovered` on `stub:<dependent>-<provider>`.

## Output

JSON per `verdict.json`: one row per slug — level, status, evidence (`path:line`, the assertion quoted, or the tail of the command output). No advice, no summary prose. The loop reads only this table.

# Reading the specification — the unit's recipe, `assembleSlice` and the split

The implementer and the verifier read the specification the same way, so two fresh contexts build the same packet. **Every read goes through `c4s release-diff`**, pinned to the window in `## This build`, never to the specification's live state: the specification may have moved on since the brief was written, and only `release-diff` reads it as it stood at a release. A command that reports the server is not running ends the run with status `error`; never read specification files by hand.

Two reads, one command:

- **The change** — `--from <from> --to <to>`: what the window did. For an entity, `before` and `after`; for a page, **only the changed sections**, each with `<before_change>` / `<after_change>` markers. A deletion comes back with `op: delete` and its `before`: that is what the code must remove.
- **The state at `<to>`** — `--from initial --to <to>`: everything as it stood at the release; every entry comes back as `create`, and its `after` (an entity) or its content (a section) is the state at `<to>`. This is the context the change needs.

## The recipe is the address book

The unit's `recipe` (from your scope, parsed from the brief's `Read:` lines) names **what** to read; this section is the only place that says **how**. `<identity>` is the identity flags from `## This build`.

| Recipe entry | Command |
| --- | --- |
| page `change: all` | `c4s release-diff --from <from> --to <to> --include pages --paths '<key>' <identity>` |
| page `change: {offset, limit}` | the same, plus `--section-offset <offset> --section-limit <limit>` |
| page `context: {offset, limit}` | `c4s release-diff --from initial --to <to> --include pages --paths '<key>' --section-offset <offset> --section-limit <limit> <identity>` |
| entities `{type, slugs}` | `c4s release-diff --from <from> --to <to> --include entities --entity-types <type> --slugs <s1,s2,…> --limit <number of slugs> <identity>` |
| convention `{key, offset}` | the `context` form with `--section-limit 1` |

In an initial window `<from>` is `initial`, so the change and the state at `<to>` are the same read.

- Sections are addressed **by position, not by anchor**: `offset` is the 0-based position in that read's `sections[]`, and the brief's range `6–9` is `offset 6, limit 4`. In a change read, `sections[]` holds only the changed sections, so `change` and `context` count differently; each carries its own numbers. Check the returned anchors against `anchors`: a mismatch is a wrong address, not a spec change — see "Read problems" below.
- One command per entity type (`--slugs` takes exactly one `--entity-types`). `--limit` is always the number of slugs: the default window is smaller than most slug lists. If an answer still has fewer entries than slugs, a slug is wrong or of another type — say so, do not conclude it is gone.
- Page keys are full keys, `<rootId>/<path>`, quoted. Always pass `--include`: without it the answer carries both dimensions.
- An answer cut short by the response budget carries `truncationHint` in flag form: run it as the next call.

### `deferred` and `completes` — a read built in steps

A read may carry `deferred: [{what, to, why}]`: a part of that page or entity this unit **must not build yet**, because it needs unit `to`. Read the whole read anyway — the part is context — but leave it unbuilt: no code for it, no behaviour stub pretending it exists, at most the seam the later unit needs (an empty slot, a route without the element). The verifier does not count a `deferred` part as missing; it does count it as a defect if it was built against a dependency that does not exist yet.

`completes: [{what, from}]` is the other end: the part that unit `from` left, now in scope here and verified here, together with the rest of the read.

A linked entity the recipe does not name — one a `links` field of its type (`## This build` → entity types) points at — is read at `<to>` the same way: `--from initial --to <to> --include entities --entity-types <t> --slugs <slug> --limit 1`.

## assembleSlice(unit or portion) → packet

A fixed sequence; the result goes to `.c4s-impl/packets/<unit>.md` (or `<unit>-<portion>.md`), gitignored. The packet is the implementer's only specification input for the run.

1. Run every read of the recipe, as the table above builds it, in order.
2. For each changed section, the state read at `<to>` gives the surrounding layer section and the module's purpose — the context the change sits in.
3. The entities the change links to, at `<to>`.
4. The criteria — the entities whose type has the role `criteria` (`## This build` → entity types): the type's `checks` field names the entities a criterion checks; every criterion in the recipe is in scope. Drop retired ones (the type's `inactive` field). Where no type has the role `criteria`, the unit's criteria are what its page reads state as expected, observable behaviour, each named by its section anchor.
   An entity of a `per-entity` type carries no role of its own: its parts in `## This build` → entity parts say which of its items are criteria, which are built and which are context. A multi-item part is in scope item by item, each named `<slug>#<key value>`; a `criteria` item has no `checks` field, it checks what its own entity and the section that embeds it describe.
5. The conventions from `## This build` whose layer the unit touches.
6. Stubs the unit must close (`stubs.json`, provider = unit) and stubs it may open.
7. The unit's `jobs`: each job's row of the user-jobs table (its address is in `conventions[]`), read as a convention — who does what, its success sentence, the modules it walks across.

Head the packet with: window, unit, goal, layers touched, entity counts, criteria count (`per-entity` criteria items included), jobs, packet size in bytes. Under every `per-entity` entity, list its parts and their items as `## This build` gives them, before the entity's content. List every `deferred` part under **Not yet** (what, which unit, why) and every `completes` part under **Completes**. Every deletion (`op: delete`, or a section whose change read is a lone `<before_change>`) is listed under **Remove**, next to its `before`.

### Read problems

The recipe's reads are checked here, by the unit that needs them — there is no global check before the build. While assembling, any of these is a **blocking deviation** of this unit:

- an entity read returns fewer entries than the slugs it names → `incorrect` (a wrong slug or type);
- a page range reads back sections whose anchors are not the ones the recipe labels it with → `clarification` (a wrong address);
- an active criterion whose `checks` field is empty → `clarification` (nothing to verify it against).

In split mode such a deviation is returned with `portions: []` and nothing else: the orchestrator blocks the unit and goes on with the others. In build mode it is reported as any blocking deviation.

## Split mode — `splitSlice(packet, budget)` → `split.json`

The implementer runs in split mode once per unit, before its first portion. It assembles the packet; if the packet fits `budget.packetKB`, it returns a single portion. Otherwise it cuts into as few portions as the budget allows:

1. **By layer**, in the layer order of the specification: fill a portion with the layers the unit touches, one after another, while it stays within the budget; the layer that does not fit opens the next portion. A portion carries the goal, the dependencies, its layers' sections, the edge cases, and the criteria whose `checks` field targets entities of its layers.
2. **By criteria group** only for a single layer over budget on its own: group criteria by the target of their `checks` field, sort groups by target slug, fill portions in that order. Never cut inside a prose section.

Every portion costs an implementer run with a fresh context that reads its packet from zero, so more portions are not safer, only slower: cut because a packet does not fit, never to make portions small.

Portions are named after their first and last layer: `<unit>/p1-l1-l7`, `<unit>/p2-l10-l13`, and `<unit>/p3-l2-b` for a criteria group; each lists its `slugs` and `layers`. A criterion that points at entities of two layers goes to the **later** layer's portion: behaviour is tested where all its parts exist. The items of a `per-entity` entity, of every role, travel in the portion of the layer whose section embeds that entity, and stay together. The unit's jobs travel in its last portion: a job's test needs everything the unit builds. A single section larger than the budget still travels whole; record a non-blocking `clarification` deviation ("section <anchor> exceeds the packet budget").

Split mode **returns** `split.json` and writes nothing else: the orchestrator records the portions in `state.json`, and they are never recomputed.

## Never in a packet

- content of other units (their slugs appear as stubs or dependencies, nothing more);
- a previous run's notes (there are none);
- the brief itself.

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
