# Workflow brief (a plan of work units for staged implementation)

Use this in a brief thread when the user asks for a **workflow brief**, or agreed to one when `workflows/brief.md` offered it for a map too large for one pass. Any window qualifies: initial (`from_release` is `(initial)`) or a release-to-release delta.

The delta genre hands an implementer the whole change in one inlined narrative. This genre hands over a **plan**: units of work, each with a goal, a reading recipe and its dependencies, ordered in waves. How the plan is executed — the loop of fresh implementer, verifier and reviewer runs with state in the code repo — is not in the brief: the `c4s-workflow-implementer` skill in the code repo owns it. The brief says what to do and in what order; the skill says how.

**This genre refers where the delta genre inlines.** The host's self-containment invariant gives way to that, as its own text says for a plan genre the user asked for: self-contained here means *the brief, the `c4s` CLI and the code repo, nothing else*. Every pointer into the specification names what to read at the window — a page and its sections, an entity type and its slugs — never a quotation; the skill turns those names into `c4s release-diff` commands. You think; the brief records the result of that thinking — goals, recipes, dependencies, order. It does not copy specification content: the loop reads it itself.

## Step 0 — Window and pin

- `to_release` must be set. An open `to` (`(unreleased)`) has nothing to pin; ask the user to cut a release and stop.
- The window **is** the pin. The implementation reads the specification only through `c4s release-diff` between the window's two ends — the change from `from_release` to `to_release`, and the state at `to_release` from `initial` — so what the specification did after `to_release` does not reach it. Whether the specification has moved since is not a condition of this brief.
- The heading names the genre — the reader's way of telling the two apart: `# Initial workflow brief: <to_release>` for an initial window, `# Workflow brief: <from_release> → <to_release>` for a delta. It replaces the heading the system pre-filled.

Ask the user nothing about the harness, the test commands or the budget: those are the skill's defaults in the code repo. Do not ask what the specification answers either.

## Step 1 — The map

The host's binding on what enters your context holds in full: the summary map, and the distillates of the `diff-explore` subagents you dispatch. Nothing below needs a raw `before` or `after`.

Probe the window (`summaryOnly: true`) and filter it with the table below. Its **classification** column decides whether an entry belongs to a unit; its action column is the delta genre's and does not apply here — in this genre a substantive entry becomes **a read in a unit's recipe**, never inlined content.

<!-- include: parts/brief-substance.md -->

Group the substantive page entries by module with the module main-file pattern:

<!-- include: module-path-pattern -->

A matching path is a module's main file; every path under the same `modules/<dir>/` belongs to that module. Entities join their module by their `mNN` tag, which the map does not carry: dispatch `diff-explore` slices by entity type and ask each to return, per slug, its `op` and its module tags. Criteria join a module by its tags and, for a delta, by a `verifies` that points at an entity the window changed — a `diff-explore` read of the `ac` type from `null` to `to_release`, asked to return only the matching slugs.

Read the dependency records too: one `diff-explore` read from `null` to `to_release`, `entityTypes: ["module-dependency"]`, returning every record as `dependent → provider: needs`, and a second read of the window's `database-table` and `endpoint` entities returning foreign-key targets and linked DTO slugs.

## Step 2 — Design the units

Cutting the work into units is a design job, not a projection of modules.

- **A unit is a chunk that makes sense to build and verify on its own**, not "a module". Splitting one module into its data and the rest is fine when something else waits on its data; joining two small changes that only make sense together is fine too.
- **Foundation first.** Data changes (tables, migrations, DTOs) go into units ahead of whatever consumes them (API, UI).
- **Avoid stubs by how you cut.** When a dependent needs a provider from a later unit, move the needed part of the provider earlier. The stub ledger is only for what cannot be avoided, such as a real cycle, and each row carries its justification. In a delta window it is usually empty.
- **A stub only for new behaviour.** A row exists only when the dependent needs behaviour the provider gains *in this window*. An edge to a provider already built at `from_release` is no row at all.
- **Hard or soft.** `module-dependency` has no hard/soft field; derive it. An edge is **hard** when the dependent stores or returns the provider's data: a table of the dependent has a foreign key into a table of the provider; an endpoint of the dependent links a DTO of the provider; or `needs` names data the dependent persists or serves. Otherwise it is soft — navigation, a displayed element, a signal, a frame. The edges are input to your judgement about units, not a mechanical topological sort of modules.
- **One owner per part.** Every substantive section, entity and criterion of the map has exactly one owner for each of its parts. Usually that is one unit per entry. When one section or entity has to be built in steps — part of it needs a later unit — the reads say so explicitly: the earlier unit carries `not yet: <what> → <later unit> (<why>)` under that read, and the later unit reads it again with `completes: <what> (deferred from <unit>)`. The implementer leaves a `not yet` part alone and the verifier does not count it as missing, so an unmarked partial read is a unit that cannot pass. Where the changed sections simply divide between units, split them by range instead; `not yet` is for a part inside one section or entity. A criterion whose `verifies` spans two units goes to the later one.
- **Wave 0 only for an initial window** (from zero, no stack): stack, scaffold and conventions/design tokens. A delta window has no wave 0; a stack or convention change, if any, is an ordinary unit placed where it belongs.

Each unit carries three things:

- **Goal** — one or two sentences: what changes in the system once the unit is done. A derived statement, not a quote. It names the removals in one clause, so implementer and verifier read them the same way; there is no separate line per deletion, because `op: delete` shows up in the recipe.
- **Depends on** — the earlier units it needs, and why. Blocking dependencies only.
- **Read** — what to read at the window, grouped: one line per page with its section ranges, one line per entity type with its slugs (criteria included, under their own type), and the `not yet` / `completes` notes. No commands: the window and the identity are stated once, in `## Release`.

### The recipe's lines

```
- page `<key>` — change: sections 6–9 (`q91m4kgl`, `bhh6625d`, `sexa5u1i`, `m19l13rt`); context: sections 1–2 (`m19cel00`, `m19dep00`)
  - not yet: <what> → <later unit> (<why>)
- <entity-type>: <slug>, <slug>
- <another entity-type>: <slug>
```

- Sections are addressed **by position, not by anchor**, and in a delta the change read's `sections[]` holds only the changed sections. So `change:` and `context:` count differently: `change:` numbers count the changed sections, `context:` numbers count every section of the page at `<to>`. Compute both from `summaryOnly` with that one path — once at `from → to`, once at `initial → to`. Numbers are 0-based positions; a range `6–9` is four sections. Releases are frozen, so they stay stable. The anchors are labels for the reader to check against, not the address.
- `change: all` when the unit owns every changed section of the page. An initial window has no change/context split: the line reads page `<key>` — sections <i>–<j> (…), at `<to>`.
- The context at `<to>` covers the module's purpose and dependencies and the layer sections the change sits in — not the whole module.
- One line per entity type, criteria included, each under its own type name. Do not describe the types: the skill asks the project for them and plans how each is built and verified. The skill derives `--include`, `--limit` and quoting; do not write them.

## Step 3 — Order

A list of units grouped into waves, where units within a wave are independent: a unit's wave is above every unit it depends on. Then the stub ledger, usually empty.

## Step 4 — Write

Fill `templates/brief-workflow.md` top to bottom: `## Release`, `## Conventions` (only the convention addresses some unit touches, plus the user-jobs address), `## Units` in the fixed format the template shows, `## Order`, `## How to run`. The unit format is a contract with the skill, which lifts it into its state once — keep its labels (`Goal:`, `Depends on:`, `Read:`) exactly.

Save with one `update_brief` (`action: replace`), then read it back with `get_brief`.

## Step 5 — Checklist, then report

- [ ] The heading names the genre and the window; `## Release` names both ends, the pin every read takes.
- [ ] Every unit is in the fixed format: `### <unit-id>`, `Goal:`, `Depends on:`, `Read:`.
- [ ] Every substantive entry of the map has exactly one owner for each of its parts; every `not yet` names a later unit whose reads carry the matching `completes`.
- [ ] `Read:` holds lines, not commands: one per page with its own ranges for `change:` and `context:`, one per entity type.
- [ ] Data units come before their consumers; `Depends on` lists only blocking dependencies; every unit appears in exactly one wave, above its dependencies.
- [ ] No wave 0 in a delta window; the stub ledger is empty, or each row is justified and is about behaviour new in this window.
- [ ] Every spec pointer is a read at the window — no live read; no entity field, endpoint path, column or AC title is quoted.

Reply with the brief path, the pinned release, the units by wave, and what the human does next: in the code repo, implement it with the `c4s-workflow-implementer` skill. Do not offer to start the implementation — this thread cannot.

When the user asks for an edit to an existing workflow brief, a unit keeps the fixed format, and a different window is a new brief, not an edit.
