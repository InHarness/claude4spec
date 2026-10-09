# Setup — once per brief, always in an interactive session

Run these steps in order, in the session that starts the loop — also when the loop will run headless. Each step writes a file; the last one commits. After the commit **nothing reads the brief again**: not the driver, not a role.

The brief has five sections: `## Release` (window, identity, pin), `## Conventions` (addresses), `## Units` (one `### <unit-id>` per unit with `Goal:`, `Depends on:`, `Read:`), `## Order` (waves and the stub ledger) and `## How to run`. Read it once with `c4s get-brief <path> <identity>`.

## 1. Isolation

Per `defaults.md` → `isolation`. A worktree: `git worktree add .worktrees/<brief-slug> -b impl/<brief-slug>` and continue inside it. A container: the human starts it; continue inside. `main-checkout`: only in a throw-away clone — say so to the user.

## 2. State directory

Inside the isolated checkout: `.c4s-impl/` with `deviations/`, `prompts/`, `schemas/`, `review/`, `runs/`, empty `decisions.md` and `trace.md`, and a `.c4s-impl/.gitignore` holding `packets/`. Copy `schemas/*.json` from this skill into `.c4s-impl/schemas/`.

## 3. Connection

One call checks that the loop can reach the specification at its window — the server answers, the identity is right, both releases exist:

```sh
c4s release-diff --from <from> --to <to> --summary-only --limit 1 <identity>
```

A failure stops set-up: tell the user what the command answered, and go no further. Nothing else is checked here. The brief's content is checked where it is read — each unit's split step reads its whole recipe and turns a read that does not hold into a blocking deviation of that unit (`reading-the-spec.md`, "Read problems"), so one bad unit does not stop the others.

## 4. Parse the brief once into `state.json`

You, the agent, read `## Units` and `## Order` and write `state.json` per `schemas/state.json` — read the brief's sections, never pattern-match them:

- `units[]`, in wave order: `id`, `goal` (verbatim), `recipe` (the `Read:` lines parsed: each `page` line into `pages[]` with `key`, `change` (`all` or `{offset, limit, anchors}` from a range `i–j`: `offset i, limit j−i+1`) and `context` — an initial window's `sections:` is `context`; each `<entity-type>: <slugs>` line into `entities[]`; a `not yet: <what> → <unit> (<why>)` under a read into that read's `deferred[]`, a `completes: <what> (deferred from <unit>)` into its `completes[]`), `dependsOn` (unit ids from `Depends on:`, with the reason), `wave`, `status: pending`, `portions: []`, `startCommit: null`, `baseCommit: null`, `rounds: { review: 0, unit: 0 }`;
- `waves[]`: `{ n, units, startCommit: null }`, from `## Order`;
- `conventions[]`: the lines of `## Conventions`, each as `{label, key, offset, anchor}`;
- `units[].jobs[]`: who writes each user job's end-to-end test. Read the user-jobs table (its address is in `conventions[]`) at the window, as `reading-the-spec.md` reads a convention. A job walks across modules, so its test can pass only once all of them exist: give each job whose modules some unit's recipe reads to the **last** such unit in wave order, as `{id, modules}`. A job no unit touches stays with the system verifier alone. Set-up adds no unit; it only gives an existing one the job.

Write `stubs.json` per `schemas/stubs.json` from the stub ledger in `## Order` (usually empty; every row has its justification). Check the result before moving on: every unit of `## Units` appears in exactly one wave; every `dependsOn` names a unit in an earlier wave; every `deferred.to` names a unit in a later wave whose same read carries a `completes` with `from` = this unit, and every `completes` has its `deferred` counterpart.

## 5. Entity types

The skill knows no entity type: which types a specification uses is the project's choice, made by its plugins. Ask the project, then plan how each type the recipes read is built and verified in this repo.

1. `c4s catalog <identity>` — the project's types, each with its `description`, `roleNoun` and `payloadVersion`.
2. For every type named in a recipe (`units[].recipe.entities[].type`): `c4s describe --type <t> <identity>` — its record schema. A field whose items are `{type, slug}` is a link to another entity; a field with an enum like `active | deprecated` tells live entities from retired ones.
3. A type a recipe names that the catalog does not know stops set-up: the brief belongs to another project, or the identity is wrong.
4. Write one `state.json` → `entityTypes[]` entry per such type (`schemas/state.json`):
   - `role` — `criteria` (its entities become tests; the verifier checks behaviour), `built` (its entities get a counterpart in code and a `trace.md` line; the verifier checks shape), `context` (read, never built) or `per-entity` (the type says nothing about what its records mean; each entity is classified on its own, item 5). Judge from the description and the schema: a type whose records state an observable expectation and point at what they check is `criteria`; a type that describes a structure the system has is `built`; a type that records relations or decisions about the specification itself is `context`; a generic container — a grid, a table, a block of text — whose meaning comes from what the author put in it and from the page that embeds it is `per-entity`;
   - `checks` — for `criteria`: the link field naming the entities a criterion checks;
   - `inCode` — for `built`: what the counterpart is **in this repo**, given its stack and the type's schema (one sentence);
   - `verify` — for `built`: the verification structure the implementer builds and the verifier reads — which test proves the counterpart has the entity's shape, and where such tests live;
   - `links` — the link fields `assembleSlice` follows to read linked entities at `<to>`;
   - `observedIn` — for `criteria`: where a criterion's observable lives. `unit` — in code, proven without the running app; `e2e` — what a user sees or does, proven against the running app (`defaults.md` → `app`); `per-criterion` — the type covers both, and each criterion's title says which;
   - `inactive` — the field and value that retire an entity, if the schema has one;
   - `version` — the catalog's `payloadVersion`.
5. For every entity of a `per-entity` type that a recipe names, read it at the window (`reading-the-spec.md`, the entities row; a `truncated` answer is read again for that slug alone) together with the page section that embeds or mentions it, and write one `state.json` → `entityParts[]` entry: `slug`, `type`, `why` (one sentence), and `parts[]` — each part a `role` (`criteria`, `built` or `context`), the `items` it covers ("all", or which rows, columns or entries, stated so that a reader of the entity finds the same ones), the `key` that names one item (a label column, an entry's name; omitted when the part is the whole entity), and for `built` its `inCode` and `verify` as in item 4. One entity may hold several parts: a grid whose rows are things the system registers and whose last column states what a user observes is a `built` part and a `criteria` part. Classify from what the entity says, never from what is easier to build: this is set-up's decision, made once, before any implementer runs, and the user confirms it in step 6. After step 6, append each entry to `decisions.md` (slug, parts, why), so the reviewer can question a classification the way it questions any decision.

`catalog` and `describe` read the type definitions as they are now, not at the window — there is no read of a type at a release. Definitions change rarely; `version` records what this plan was made against. Entity **content** is still read only through `release-diff`, at the window.

The table goes to the user in step 6, with the other questions.

## 6. `release.json` and the questions

Per `schemas/release.json`: `project`, `workspace`, `from`, `to`, `brief` from `## Release` and the brief path; `harness` and `build` from `defaults.md`. For every row of `defaults.md` that reads `ask`, ask the user — **all such questions in one message, as a numbered list**, followed by the `entityTypes` table from step 5, when there is one the `entityParts` table (slug, part role, items, key, why), and the jobs table from step 4 (job, modules, owning unit) for the user to correct. Apply the answers and corrections, then write `release.json` and update `entityTypes` and `entityParts`. Do not ask what `defaults.md` already answers. Start mode `detect`: a delta window is `resume`; an initial window asks whether the repo already holds code for this specification. `reviewer: command:…` is refused for now (no converter to `review.json`): offer `same-harness` instead. `app: skill:…` needs a session to call the skill: with a headless harness it is refused, and the user gives a `command:` instead.

A question whose answer would change what a user of the system can observe is a product decision, not a setting: do not decide it — write it as a deviation and tell the user.

## 7. Role prompts

Materialize one prompt per role in `.c4s-impl/prompts/<role>.md` — `implementer`, `verifier`, `reviewer`, `verifier-system` — by concatenating:

1. the role file from `roles/<role>.md`;
2. for `implementer` and `verifier`: the whole of `reading-the-spec.md`;
3. a `## This build` block: the identity flags, `<from>`, `<to>`, the test commands (suite, filtered, e2e, smoke), whether a running app is part of the build (`app` is not `none`), the verifier tools, the state dir, `state.json`'s `conventions[]`, its `entityTypes[]` as a table (type, role, checks, observedIn, inCode, verify, links, inactive), and its `entityParts[]` as a table (slug, role, items, key, inCode, verify) when it has entries.

A role run gets this prompt plus its scope (`loop-protocol.md`, "Scope of a run"), and nothing else.

## 8. Commit

`git add .c4s-impl && git commit -m "init: loop state for <brief path>"`. Then start the loop per `SKILL.md` step 3.
