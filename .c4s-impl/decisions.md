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
