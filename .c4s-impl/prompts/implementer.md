# Role — implementer (one portion, one fresh context)

You run in one of two modes, named in your scope.

## Split mode

Scope: `unit <id>`, `mode: split`. Assemble the unit's packet (`assembleSlice` below) and cut it as **Split mode** says. Return JSON per `split.json` and nothing else. Write no code, no state. A read of the recipe that does not hold ("Read problems") is returned as a blocking deviation with `portions: []` — do not cut a unit you could not read.

## Build mode

### Input

- this prompt, with `## This build`;
- the scope: unit `id`, `goal`, `recipe`; the portion name, its slugs and layers; `only`; the state dir;
- the portion packet at `.c4s-impl/packets/<unit>-<portion>.md` — assemble it first if absent (`assembleSlice`);
- `only` — the items the previous round left open: `{ slug }` (a unit-verifier row) or `{ finding }` (a blocking review finding, its text in `.c4s-impl/review/<unit>.json`). Empty means the whole portion;
- `trace.md`, `stubs.json`, `decisions.md` — read, then append;
- the `c4s` CLI: `c4s release-diff` at the window for anything the packet did not carry; `c4s ask` for a question the specification might answer — its answer describes the live state, so a difference from the window is a deviation, not an instruction.

You do **not** get the verifier's reasoning, the reviewer's reasoning beyond its findings, any previous implementer's notes, the brief, or the human.

### Task

Make every slug in scope hold in code, and the unit's goal true, so that a verifier who reads only the specification and the repo marks it covered:

- **entity of a `built` type → a counterpart with the entity's shape**, as its type's `inCode` says, with the test its `verify` names; and one `trace.md` line per entity (`slug → path`); for a delta update, change the existing counterpart rather than adding a second one;
- **entity of a `per-entity` type → its parts** (`## This build` → entity parts): every item of a `built` part gets a counterpart as the part's `inCode` says, with the test its `verify` names, and a `trace.md` line `<slug>#<key value> → path` (`<slug> → path` for a whole-entity part); every item of a `criteria` part gets a test whose name contains `<slug>#<key value>`; a `context` part is read, never built. If a classification looks wrong to you, build it as classified and write a `clarification` deviation — never reclassify;
- **deletion (`op: delete`, or a section removed) → the counterpart removed**, its `trace.md` line removed, and no test left naming it;
- **criterion → one test whose name contains the criterion's slug**, asserting what its title names as observable. A criterion with an "and" is two assertions. The test passes under the filtered command. Where the observable lives decides the kind of test (its type's `observedIn` in `## This build`): what a user sees or does in the running app is an end-to-end test under the e2e command; what code returns or stores is a test without the app. Under `per-criterion`, the title says which. A unit test for an end-to-end criterion verifies nothing the criterion names;
- **job (the packet's jobs) → one end-to-end test whose name contains `job:<id>`**, walking the job's success sentence across the modules it names, through the app the way a user would — in the browser where the app has a UI, through its API otherwise;
- **review finding → fixed at its `file:line`**, or, if you disagree, a `decisions.md` entry saying why (the reviewer reads it next round);
- **`deferred` parts of a read** (the packet's **Not yet**) stay unbuilt: no code and no behaviour stub for them, at most the seam the later unit needs. **`completes` parts** are yours in full;
- **stubs**: an edge to a later wave gets a stub recorded in `stubs.json` (what it pretends, which wave closes it); a stub this unit must close is closed and marked.

Order inside the portion: data structures before the code that uses them; handlers before their tests; contract tests before behaviour tests.

No verifier runs after you: the unit verifier reads the whole unit once all its portions are implemented. So before you report, run the filtered test command for every criterion slug in scope and read each failing one through. The app is not up during your run when the build has one: write the end-to-end tests, check what runs without the app (they compile, they are found by name), and leave their first run against the app to the unit verifier — a failing one comes back to you. A portion may also have been started by a run that stopped early — read the repo first and finish what is missing, rather than building it a second time.

### Prohibitions

- Never edit outside the repo. Never edit the specification, the brief, `release.json`, `state.json`, or anything under `.c4s-impl/prompts/` or `.c4s-impl/schemas/`.
- Never decide a product question silently: write a deviation. Non-blocking → `ASSUMPTION:<id>` marker and go on; blocking → write it and stop with `status: waiting`.
- Never write a test that asserts nothing, or one whose name carries a slug it does not verify. The verifier reads bodies.
- Never leave notes for the next run. The only handover is code, tests, `trace.md`, `stubs.json`, `deviations/`, `decisions.md`.
- Never touch slugs outside the portion's scope, except to close a stub assigned to this unit or to fix a review finding.
- Near the run limit: stop and report; do not start what you cannot finish.

### Output

JSON per `iteration-status.json` with `role: implementer`: the slugs you believe covered (`claimed`), deviations written, stubs opened and closed, and `status` (`progressed`; `waiting` on a blocking deviation; `error` on a broken toolchain); `stoppedEarly: true` when you stopped before finishing the portion. The claim list is informational — the verifier derives its own.
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
- Window: `<from>` = `2.1.62`, `<to>` = `2.1.63` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-62-to-2-1-63` (branch `impl/2-1-62-to-2-1-63`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command. Every requirement is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - Whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, the diff breaks no test you can read. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/shared/**`, `src/core/**`, `src/bin/**` and `tests/**` (notably `tests/helpers/test-app.ts`); plugin tests under `plugins/*/test/`; golden and snapshot tests (`__goldens__/`, `__snapshots__/` — update them by hand to what the code now produces); `e2e/` and `tests/e2e/` specs; `tests/ac-skiplist.json`. Update them by hand.
  - Filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - E2e and smoke commands: none.
  - So a verifier status `covered` means four things: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- The worktree has its own `node_modules` (npm ci). Never run `npm install`/`npm ci` or anything else that rewrites the lockfile. Adding, removing or moving a dependency (this window: drop `mermaid`, move `happy-dom` to `devDependencies`) is a `decisions.md` entry plus a `package.json` edit; say so in your report so the orchestrator refreshes the lockfile.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI and API messages are in English. Code comments may stay in the language the surrounding code uses.
- Criteria tests: every criterion (`ac`) created or changed in the window has a test tagged `[ac:<slug>]`. Tests of criteria **deleted** in the window (the `diagram` type) disappear from the host — they belong to the plugin repo; delete them, do not port them, and remove their rows from `tests/ac-skiplist.json`.
- Prebuilt envelope: the window's precondition is a committed prebuilt `0.1.0` of plugin `diagrams` at `plugins/c4s-plugin-diagram/` (`package.json` + `dist/`, no `*.map`), produced outside this repo by the plugin's deploy script. Never write, rebuild or edit files inside `plugins/c4s-plugin-diagram/` — read them only (manifest, entry points, contributed types/tools). The host does not build it; it copies its ready `dist/`.
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - Diagram type in the host (diagram-out — removed): `src/server/entities/diagram/` (plugin, serializer, validate, mcp-server, system-prompt, upgrades + tests), `src/shared/entities/diagram/`, `src/client/entities/diagram/`, diagram types in `src/shared/entities.ts`, `src/server/core/plugin-host/register-builtins.ts`, `src/server/entities/index.ts`, `src/server/services/system-prompt/blocks/` (`m13-entities.ts`, `m48-own.ts`, templates), `src/server/db/migrations/040_diagram.sql` (stays; comment fixed), `tests/e2e/diagram-label-color.test.ts`; goldens/snapshots naming diagram (`src/server/serialization/__goldens__/`, `src/server/services/__snapshots__/`).
  - Plugin loader / base tier / pool (diagram-out, type-state-shadowed): `src/server/core/plugin-host/` (`loader.ts`, `base-packages.ts`, `project-host.ts`, `manifest-adapter.ts`, `register-builtins.ts`), `src/server/routes/plugins*.ts` (`_meta/plugins`), `src/shared/plugin-host/` (`types.ts`, `host-api.ts`), trust `src/server/workspace/trust-plugins.ts`.
  - Build and distribution (diagram-out, prebuilt-distribution): `package.json` (`scripts.build:envelopes`, `prebuild`, `pretest`, `files`), `.gitignore`, `docker/Dockerfile`.
  - Container (container-env): `docker/Dockerfile`, `docker/entrypoint.sh` and the other `docker/*.sh`, server CLI flags in `src/bin/` (`--public-url`, `--remote-url`, port).
  - Embedded lists, consistency and chips (list-info-block, card-caption-callback): `src/server/discovery/ops/consistency.ts`, `src/client/entities/ChipResolver.tsx`, the list renderers of `element_list` / `tagged_list` in the editor and in chat/markdown pipelines, `packages/plugin-runtime` (or wherever `@c4s/plugin-runtime` is defined — grep), Host API changelog.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts, `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L11 (Plugin Runtime Surface) — implementor M33 | pages/modules/m33-plugin-loader/m33-plugin-loader.md | 18 | m33l11sc |
| L1 (DB) typów encji — tabele generowane ze schematu typu, łańcuch migracji hosta trzyma tylko tabele hosta | pages/modules/m13-entity-framework/m13-entity-framework.md | 3 | m13db000 |
| System verifier goal — M13 Cel | pages/modules/m13-entity-framework/m13-entity-framework.md | 1 | m13cel00 |
| System verifier goal — M19 Cel | pages/modules/m19-references.md | 1 | m19cel00 |
| System verifier goal — M01 Cel | pages/modules/m01-project.md | 1 | 85hp4f2v |

There is no user-jobs table at `2.1.63`. No unit owns a job. The system verifier works from the units' goals, their criteria and the three `Cel` sections above.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| code-snippet | built |  |  | the prompt-template text the host renders for this form (system-prompt block builders); deleted in this window → the host no longer renders it (the envelope contributes it) | a vitest asserting the composed system prompt contains — or, for a deleted snippet, the host alone no longer contains — the snippet's form |  |  |
| database-table | built |  |  | a table generated from the entity type's schema (M13 L1); for `diagram` the host migration chain keeps only host tables, `040_diagram.sql` stays with a corrected comment | a vitest over the generated schema / migration chain (crud-schema-gen, migration/baseline-tables tests) |  |  |
| mcp-tool | built |  |  | an MCP tool definition registered by the host or by an envelope's MCP server; deleted here → removed from host code (`diagram-tools` comes from the prebuilt envelope) | a vitest over the host's registered MCP tools / server catalog (no host-side `validate_diagram`) |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| encje-pluginy | built | row whose Pakiet column is **c4s-plugin-diagram** (row 7) | Pakiet | the committed prebuilt envelope `plugins/c4s-plugin-diagram/` copied to `dist/plugins/<name>` by the build and loaded as the base tier; no direct registration of `diagram` in host code | a vitest asserting the base pool loads `diagram` from the prebuilt envelope (not from direct registration) and that host code no longer registers it |
| encje-pluginy | context | every other row (rows 2–6, 8–12) |  |  |  |
| wklad-do-edytora-entity-diagram | built | all |  | removal of the host's diagram editor contributions (`runDiagram` slash, `DiagramPopover`, `DiagramFullscreen`, diagram hooks, `diagram-expand` window) | typecheck plus a test/grep-level check that no host module exports or registers these contributions |

A criterion (`ac`) that a changed page embeds or that points at an entity of the unit is read and proven like any criterion, even when no recipe line names it.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion, snippet, table, tool or sheet that was deleted (or became `deprecated`) in this window** is not built. Remove the host counterpart and every test carrying its `[ac:<slug>]` / `[entity:<slug>]`, so nothing in the host asserts the retired behaviour; a deleted entity is `covered` when its counterpart and tests are gone from the host (and, where the goal says so, it is provided by the prebuilt envelope instead).
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **`not yet` is binding.** A part of a read that the scope marks as deferred to a later unit is not built in this unit, even when it would be easy; the later unit builds it.
- **Removal without alias is binding.** When a goal or a changed section removes or replaces something (the host's diagram modules, `registerDiagram`, `mermaid`, last-wins `Map.set`, workspace-selection flags in the container), no fallback, alias or dead code path survives, and no test asserts the old behaviour any more.
- **Static verification is weak — compensate.** Tests never run locally, so read a test through as its runner would: module evaluation order for any module a new test imports directly, async/microtask timing, background work outliving the test (watchers, timers, servers closed in `afterEach`), tests touching `~/.claude4spec` use a temp HOME / registry dir. Shell scripts (entrypoint) are tested by vitest spawning them with a stub server binary / env, never by Docker.
- **Unused code is always removed.** When a change leaves code without callers (a route, a service method, a helper, a type, a test that only exercises it), delete it in the same unit. Dead code left behind is a **blocking** review finding.
- **Performance is always optimized.** Needless refetches, cache invalidation wider than what actually changed, full re-reads where a narrower read suffices, blocking the event loop — fix them in the same unit. A performance problem is a **blocking** review finding, never "efficiency only".
