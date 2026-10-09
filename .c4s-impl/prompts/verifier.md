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
- Window: `<from>` = `2.1.9`, `<to>` = `2.1.10` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-9-to-2-1-10-workflow` (branch `impl/2-1-9-to-2-1-10-workflow`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`) — no end-to-end command, no smoke command; every criterion is proven by a test that runs without the app.
- Tests — **never run any test locally** (no `npm test`, no `vitest`, not even filtered): the whole suite runs once in an env-runner environment at system verification.
  - whole-suite command: env-runner only (`npm test` + `npm run test:e2e`); not available to you. Treat "full suite green" as: `npm run typecheck` passes, and no test you can read is broken by the diff (read the tests touching the changed code).
  - filtered command (`<pattern>`): static — find the test whose name contains `<pattern>`, read its body, and confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - e2e / smoke commands: none.
  - A verifier status `covered` therefore means: test found, assertion matches, code read through makes it pass, typecheck green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages; `node_modules` is symlinked from the main checkout if missing (do not run `npm install` that rewrites the lockfile).
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI/API messages in English; code comments may stay as the surrounding code has them.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** In this specification most active `ac` entities have an empty `verifies`. Such a criterion is NOT a read problem and NOT a `clarification` deviation: it checks its own title and description, read against the pages of its unit's recipe. Build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **UI criteria** (client behaviour: WS event → refetch, window focus → refetch, route reload, toasts, modal actions) are proven by frontend unit tests (vitest + jsdom / React Testing Library, alongside the existing client tests), not by end-to-end tests.

### Conventions (read at `<to>` with `--from initial`, `--section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L4 (API) — implementor M49 | `pages/layers/L4-api.md` | 2 | `pondhd6o` |
| L5 (UI) — implementor M50 | `pages/layers/L5-ui.md` | 2 | `tehej2wz` |
| L7 (File Change Reactions) — implementor M40 | `pages/layers/L7-file-change-reactions.md` | 2 | `6qppsun2` |
| L7 (File Change Reactions) — implementor M40 (cont.) | `pages/layers/L7-file-change-reactions.md` | 3 | `3nzulmvf` |
| L10 (Project Scoping) — implementor M31 | `pages/layers/L10-project-scoping.md` | 2 | `l10slice0` |
| Tabela modułów (zakres każdego modułu), dla weryfikatora systemowego | `pages/SKILL.md` | 13 | `oq23nb0j` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| endpoint | built |  |  | an Express route (method + path) in src/server/routes/, with its handler and error codes | a supertest test named with [entity:<slug>] hitting the route and asserting status codes and the body shape | linkedDtos[].dto |  |
| dto | built |  |  | a request/response TypeScript type (shared types or route-local) that the linked endpoint sends/accepts | the linked endpoint route test named with [entity:<slug>] asserting the DTO fields in the response/request |  |  |
| module-dependency | context |  |  |  |  |  |  |
