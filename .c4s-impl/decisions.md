# Decisions

## Set-up: entityParts (confirmed by the user at plan approval, 2026-10-27)

- `wklad-do-edytora-m53` — built: both data rows (Nazwa: "adnotacje page-bound", "`chat-input`"), key `Nazwa`. Why: Rejestr wkładów M53 do edytora: dekoracja adnotacji page-bound i osadzenie chat-input. Treść identyczna z usuniętym arkuszem M05, zmienia się tylko moduł-właściciel.
- `wklad-do-edytora-m05` — context: all. Why: Arkusz usunięty w oknie; zastąpiony przez wklad-do-edytora-m53 o tej samej treści.
- `moduly-feature` — context: all. Why: Indeks modułów specyfikacji (moduł, warstwy, zakres, plik strony) — nic w kodzie mu nie odpowiada.

## Set-up: user jobs

- The convention `User jobs table, for the system verifier` (pages/SKILL.md §13 `oq23nb0j`) embeds only the `moduly-feature` module index at 2.1.56, not a user-jobs table → every unit has `jobs: []`; the system verifier works from the units' goals, criteria and built entities.

## Set-up: recipe parsing

- `pages/modules/m05-chat-agent.md` is deleted in the window; its ranges are read as `change` (numbers count changed sections). Ranges given as `a … b` keep only their endpoint anchors (plus `80prkz1j`, named in the brief as deleted inside 91–107).
- The L16 convention has two addresses (M48 sections 22–25 and the L16 schema page) → two `conventions[]` entries.

## Loop start (orchestrator)

- **Next window exists** (`2-1-56-to-2-1-57.md`, `2-1-57-to-2-1-58.md` pending): not gated — the user's standing rule is one brief per PR: finish this brief, PR + merge, then the next.
- **Baseline green without a fresh run**: the start commit `d26fcc20` is the merge of `impl/2-1-54-to-2-1-55`, whose system verification ran the full suite (`npm test` + `npm run test:e2e`) in env-runner green; only `.c4s-impl/` was removed since. Tests never run locally.

## m05-tura/p1-domain-a (implementer)

- `ac-po-przeladowaniu-watku-delegacja-prze` was retitled to a server observable (`GET /api/threads/:id` returns the cut delegation as `abandoned` after the turn closes). Its tag moved from the client reducer test (`src/client/chat/useChat.hydration.test.ts`, kept untagged — it still pins the client rendering) to a supertest in `src/server/routes/threads.test.ts`.
- `ac-dwa-rownolegle-zadania-w-tle-w-jednej` / `ac-zadanie-ktore-nigdy-nie-dostalo-backg`: proven through `runAgentTurn` with the background-task family routed to a real `ChatService` (in-memory DB), so the rows asserted are what a closed turn actually leaves in `chat_background_task`.
- `ac-abort-post-api-chat-abort-oraz-abort` names both routes: the existing `/abort/:threadId` test gained the "queue is cleared" assertion and a sibling test covers `POST /api/chat/abort` (requestId).
- `ac-dolaczenie-do-martwej-tury-404-bez-ot`: the existing server test (`chat.live-join.test.ts`) already asserts the new title; unchanged.

## m05-tura/p2-domain-b (implementer)

- No production code changed: every behaviour these 14 criteria name was already in the turn engine (`src/server/routes/agent-turn.ts`, `src/server/routes/chat.ts`). The portion adds or retags tests so each criterion has a server test carrying its slug.
- `ac-echo-tool-result-rodziny-task-nie-tra` / `ac-zdarzenia-rodziny-scheduling-schedule`: the page puts both suppressions in the adapter (`4fc4hute` §4: "Echo wyników rodziny `Task*` tłumi adapter", "Rodzinę zdarzeń scheduling tłumi adapter"). The library cannot be driven without the SDK: it loads `@anthropic-ai/claude-agent-sdk` through a dynamic import, from node_modules that vitest does not inline, so `vi.mock` does not reach it. So the tests feed `runAgentTurn` the stream the claude-code adapter produces (a `Task*` call arrives as `todo_list_updated` with no tool_result) and assert that the turn adds nothing: no card, no result and no row on the live stream, the joiner stream or the replay. The scheduling test also pins the library's `CLAUDE_CODE_SUPPRESSED_HARNESS_TOOLS` list, which the deny relies on. No server-side filter was added, because it would duplicate the adapter's job.
- `ac-odmowa-polityki-narzedzi-produkuje-st`: "`error` (`phase: 'init'`)" is read as the adapter's refusal event (`phase: 'init'` on the `UnifiedEvent`). The wire frame stays `{ type: 'error', code: 'TOOL_POLICY_REFUSED', error }`, as before. The page (`jx42zf7p`) asks for exactly one `error` and `done` and names no `phase` on the wire.
- `ac-przekroczenie-capa-oczekiwania-na-zad`: the title lost its UI half. The tag moved from the client test `useChat.turn-endings.test.ts`, which is kept untagged as the client half, to a server test of a background hold that expires.
- `ac-agent-moze-zadac-pytanie-przez-askuse`, `ac-dismiss-karty-user-input-request-pozb`, `ac-pytanie-askuserquestion-i-odpowiedz-u`: these are route-level tests in the new `src/server/routes/chat.user-input.test.ts`. `runAgentTurn` is replaced by a stand-in that asks through the `onUserInput` handler that `POST /api/chat` hands the adapter. The question and the answer go through the real routes and a real `ChatService`.
- `ac-post-api-chat-queue-threadid-na-watek-2`: the hold-window half needs a request made while the turn is parked. The agent-turn test mock now `await`s `hoisted.beforeEvent`, typed to return `unknown`. Existing synchronous hooks behave as before.

## m05-polityka/p1-domain-l17 (implementer)

- `<task_tracking>` removal: block, template and its `default` composition slot are gone, and so are the tests that pinned its presence, its position next to `todo_markers` and its ask-only omission (the M48 composition test rule). The golden snapshot was edited by hand (34 blocks removed with their trailing blank line). The `<todo_markers>` sweep tests stay, under their own describe.
- `autoApproveTools: CLAUDE_CODE_TASK_TRACKING_TOOLS` in `agent-turn.ts` is **kept**. It is not wiring of the prompt block: it is the SDK opt-in that lets the model keep the turn's task list at all, and that list is still part of the turn (`todo_list_updated`, `chat_thread.current_todo_items`, the M05 stream contract). Only its comment, which justified it by the block, was rewritten.
- `GET /api/chat/config` keeps `planModeEnforceable` and `sessionResumeConstraints`: M53 (`fpo8oq66`) still has the shell hide the plan-mode toggle until enforceability is confirmed and take the lock list from the library, and the route is M05's. The M05 page dropping its UI wording does not remove the data the shell consumes.
- M05 UI (L5) at 2.1.56 is the `["agent-credentials"]` query and the `agent-credential-remove` window; both already exist (`src/client/hooks/useAgentCredentials.ts`, `src/client/chat/settings/agentSettings.tsx`). Nothing to remove client-side in this unit; client chat code relabelling belongs to the M53 units.
- `ac-claude-cli-niezainstalowane-lub-nieza`: tested through `runAgentTurn` (AdapterInitError → `AGENT_UNAVAILABLE`) plus the route status table (`STATUS_FOR_TURN_ERROR.AGENT_UNAVAILABLE === 503`), which both turn routes use. On `POST /api/chat` the error arrives after the SSE headers, as an `error` frame with that code; the JSON `503` is the `ask` route.

## m53-powloka/p1-domain-l15 (implementer)

- The six "new behaviours" of the goal, against the code: the `queue_cleared` restore for other clients, the Plan Mode toggle gated on `planModeEnforceable`, the posture-free popover, the config-ordered picker, the in-stream warning (live carrier + persisted `warning` row) and `Monitor` as a plain card were already in the code. They get tests that carry their slugs (`ChatOverlay.render.test.ts`, `useChat.render.test.ts`, `BlockRenderer.render.test.ts`). The other-clients restore has no criterion of its own, so it is tagged `[section:impolq96]`.
- Real changes, where the M53 pages at 2.1.56 and the code differed:
  - Plan mode wording: "Agent proposes, doesn't modify" read as a read-only guarantee, which `fpo8oq66` forbids. The popover and the user-bubble tooltip now say "a strong signal, not a read-only guarantee".
  - The system-prompt preview hid the composer. `wraq0g4h` swaps only the message list, and the toggle criterion needs a send from preview mode. The composer now stays, and sending closes the preview.
  - The empty thread list now offers "Start new" (`wraq0g4h`).
  - The batch card header showed `<first tool> × N`. It now shows the library's `categoryLabel` ("Edited 3 files", "Read 5 files", `{toolName} × N` for `other`), as `5615w04d` and the batching criterion ask.
  - Annotation highlights: the range is no longer trusted. A highlight is drawn, and kept after an edit, only while its range still covers the saved text (`9x9xm07q`); the annotation stays in the store. The saved text of a selection takes what an atom node renders (its node view's text), not its XML (`annotationSelectionText`).
  - Chat chips: a tag with an assigned render but no target attribute (`anchor`/`slug`/`slugs`/`tags`) now stays text (`rehyxchp` precondition). Before, `type` alone was enough.
- Module attribution: client chat-shell comments, the L12 gate's out-of-scope label and test titles now name M53 instead of M05. Session-lock comments still name M05, because they describe the M05 server rule. `useChat.ts` and the turn-state panels belong to `m53-stan-tury` and were not relabelled here. No code names the module dependencies M05→M14/M20/M51 or M28→M05, so nothing changed for them.
- `wklad-do-edytora-m05` tests were rewritten as `wklad-do-edytora-m53` (`slashSources.test.ts`). No test names the deleted sheet now.
- The "Clear all" and "Remove" highlight tests subscribe `refreshAnnotations` to the store, the way `Editor.tsx`/`PlanEditor.tsx` do it in an effect on `annotations`.

## m53-powloka review base (orchestrator)

- The unit-verifier reopen moved `startCommit` before any review round ran, so the first review reads `baseCommit..HEAD` (the whole unit), not only the reopen fix.

## m53-stan-tury/p1-domain-l5 (implementer)

- Most of the unit had already moved and worked. It now has client tests carrying its slugs: `useChat.turn-state.test.ts` (real hook over a faked network, blocks drawn by `<BlockRenderer />`), `BackgroundTaskPanel.render.test.ts`, `UserInputRequestCard.render.test.ts`, `useChat.hydration.test.ts`, and `ChatOverlay.render.test.ts`. The clock, busy-indicator and delegation-status slugs keep their earlier client tests (`work-clock.render.test.ts`, `useChat.turn-clock.test.ts`, `useChat.turn-endings.test.ts`). `ac-tura-czysto-tekstowa-wznawia-sie-po-f` also has its server tag in `chat.live-join.test.ts`, so its client half now gets a tag of its own.
- Real changes:
  - Hold-cap ending (`ie5g78h8`, `x2jiptny`). The line is set on `BACKGROUND_HOLD_EXPIRED` even when no background task of ours is running, because a hold kept only by a delegation ends the same way. Its wording is the server's message, built from both abandoned-work counters (`HoldEnding.detail`). Before, the line counted local background tasks only, and showed nothing for a hold kept only by a delegation.
  - Policy refusal. The toast for `TOOL_POLICY_REFUSED` now reads "Turn refused — …". The `error` and `done` frames already closed the turn, so no bubble or clock is left waiting.
  - Agent question with no questions. `<UserInputRequestCard />` renders no form and no `Send answer` when the questions are missing or empty, so it offers only `Decline` and `Cancel`. Before, `Send answer` was enabled on an empty list, and an absent list crashed the card. The history card reads its questions defensively too.
  - Long history (`ac-starsze-wiadomosci-watku-z-bardzo-dlu`, dev-0005). The message list renders the newest 60 messages. Scrolling to the top, or clicking the "Scroll up to load N earlier messages" line, adds the next 60 and keeps the viewport where it was. The thread read stays whole, because the live-join cut needs every row.
- `connected.replayTruncated` (dev-0006). agent-chat 0.4.0 never gives `connected` to `onEvent`, so the existing "Replay incomplete" toast branch in `useChat` cannot run. It is kept as the seam a library fix plugs into, and is marked in code. `ac-po-f5-ui-pokazuje-pelna-tresc-trwajac` is tested for its full-turn half and left the skiplist.
- Model task list (`bc08os5a`). The sticky `<CurrentTodoList />` stays the block. The section only moved, and its two sources (model update, session restore) both arrive as full snapshots that are rendered as they are. The per-item merge for `Task*` versus whole replacement for `TodoWrite` is done in the adapter, and the client test asserts what the user sees for each.
- Attribution: client turn-state comments in `useChat.ts`, `BackgroundTaskPanel.tsx` and `StreamingBubble.tsx` now name M53. The queue endpoints comment still names M05, because those routes are M05's.

## m53-stan-tury: agent-chat 0.4.1 (user decision, 2026-10-27)

- dev-0006 (trimmed-replay notice unreachable on agent-chat 0.4.0) was resolved at the library: the user chose to release `@inharness-ai/agent-chat` 0.4.1 (PR InHarness/agent-chat#7), where `onConnected(requestId, threadId, frame)` receives the whole `connected` frame (`ConnectedFrame`). The app pins `^0.4.1`; the worktree has its own `npm ci` install (no symlink to the main checkout).

## m53-stan-tury/p1-domain-l5 reopen (implementer, agent-chat 0.4.1)

- The trimmed-replay notice moved from `onEvent` to `onConnected(requestId, threadId, frame)`: agent-chat 0.4.1 hands the whole `connected` frame there and still never to `onEvent`. The `onEvent` branch and the `connected` member of `WireEventExtended` (used only by that branch) are removed; the `ASSUMPTION:dev-0006` marker is gone from code. The notice sits after the stale-thread guard, so a `connected` from a thread the user already left raises nothing.
- Tests: `useChat.turn-state.test.ts` drives a real live-join with `connected.replayTruncated: true` and asserts one warning toast with the "Replay incomplete" text, plus an untrimmed join that raises none. The `ASSUMPTION:dev-0006` markers in `src/server/routes/agent-turn.test.ts` belong to an earlier brief's deviation of the same number and are not touched.

## m53-stan-tury/p1-domain-l5 reopen (implementer, rev-0001 + rev-0002)

- rev-0001: `ChatOverlay` slices the thread to the visible window first and runs `batchToolBlocks` and the copy only over that slice. The user-message counter starts at the number of user messages in the hidden prefix (`firstUserIdx`), so `userPlanModes`/`userAnnotations` still index over the whole thread. The null branch for hidden messages is gone.
- rev-0002: the window is a start index (`revealedWindow = { threadId, start }`, the count of oldest hidden messages). Before the first reveal there is no pinned start and the window is the newest 60. A start pinned at thread switch would be computed against the previous thread's messages, because `useChat` hydrates the new thread after the switch render. After a reveal the start is a fixed count, so live messages never re-hide what the user revealed. A start that belongs to another thread is dropped during render (setState in render), so a switch, A → B → A included, renders the newest window on its first render. The `useEffect` reset is removed.
- Tests: `ChatOverlay.render.test.ts` spies on `batchToolBlocks` and `BlockRenderer` (pass-through). It asserts that a delta batches only `HISTORY_WINDOW` messages, that plan-mode indexing holds across the hidden prefix, that a new message after a reveal keeps the revealed range (`msg-0010`, 10 hidden), and that a switch never renders the other thread's hidden history, not even on its first render.

## System verification (orchestrator)

- env-runner `2-1-55-to-2-1-56` @ 6e321c11: `npm test` 594/594 files, 7113/7113 tests green; typecheck green. `npm run test:e2e` 5 failed files / 3 failed tests: 4 seed-precondition files (same as merged 2-1-54-to-2-1-55) + `ac-envelope` `/ac` slash-menu poll timeout in the full run, green 2/2 in isolation on the same image — same baseline shape as the previous brief (its flake was `frontend-mockups-envelope`). System verifier: all covered, no regression.
