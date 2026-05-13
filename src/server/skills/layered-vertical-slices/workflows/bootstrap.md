# Bootstrap workflow (greenfield spec)

Use this when **no `<index>` file exists in the CWD** — the spec does not yet exist. If an index file is already present, use `workflows/daily.md` instead. Never run bootstrap on top of an existing spec; if the user wants a clean restart, ask them to move the existing spec aside first.

Announce the phase at the start of each one ("**Phase 2: Layer proposal**") so the user can see progress. Do not skip phases. Do not write files before Phase 4.

## Phase 1 — Project discovery

Ask the following topics as **one-at-a-time** questions. Summarize the user's answer in 1–2 sentences before moving to the next. Skip a topic if clearly not applicable.

Topic #1 (Users & jobs) is the foundation — the rest of the discovery flows from it. *Do not skip or compress it.* If the user pushes you toward stack or persistence first, redirect: "I'd like to hear who uses this and what jobs they're doing first — those choices should serve users, not the other way around."

1. **Users & jobs.** Who uses this system, and what 2–4 jobs are they hiring it to do? For each job: what triggers it (the user's situation right before they reach for the system), and what would "done well" look like from their perspective? If there are multiple distinct user roles, list jobs per role. *Stay until the answer is concrete — vague answers like "manage data" or "configure things" produce specs that are about themselves. Push for verbs and outcomes.*
2. **What is the system?** In 2–3 sentences, what does it do? (You already heard *who* and *what jobs* in topic 1; this question now answers itself in terms of the jobs above.)
3. **Spec target.** What is the maturity target of *this* spec (not the eventual product)? Options:
   - **Research prototype** — exploring feasibility; spec captures intent + open questions, minimal rigor, broken edges OK.
   - **MVP** — smallest useful cut; only core modules, only core layers, deferrals explicit.
   - **Feature-complete** — all planned functionality; full module set; edge cases and acceptance criteria rigorous.
   - **Production-hardened** — feature-complete plus cross-cutting concerns: observability, auth, feature flags, i18n, versioning, migrations.

   The answer **gates subsequent phases**:
   - *Research / MVP* → skip or soft-ask topic #9 below (observability, feature flags, i18n rarely apply); aim for 3–5 modules in Phase 3; shorter acceptance criteria lists.
   - *Feature-complete* → ask all topics; aim for 5–10 modules.
   - *Production-hardened* → ask all topics with extra probing on observability, auth, and migrations; expect a dedicated cross-cutting layer for each; 8–15 modules is plausible.

   Also note that a project can have multiple specs over its lifetime (MVP spec → feature-complete spec → hardening spec). If the user signals a future spec, add it as an item in `<index>`'s "Open questions" or a "Future scope" section.
4. **Primary nouns.** What entities (things the user creates, reads, updates, deletes at runtime) live in the system? *Cross-check against topic 1 — every primary noun should map to at least one job; nouns without a job are usually scope creep.*
5. **Stack & runtime.** Language, framework, deployment target (desktop app, web, CLI, library, service).
6. **Persistence.** Database, files on disk, in-memory only, external API — and is there a preferred technology?
7. **Interface surfaces.** How do users (and other agents) interact? UI, HTTP API, CLI, MCP tools, library exports — possibly several.
8. **Agent/LLM involvement.** Is there an LLM agent in the loop? If yes, what does it do (read state, mutate state, converse, stream)?
9. **Cross-cutting concerns.** Auth, i18n, versioning, events/hooks, observability, feature flags, background jobs. *(Skip or compress for Research / MVP targets.)*
10. **Scope boundary.** What is explicitly *out of scope* for this spec? (Prevents scope creep later.) Encourage the user to name concrete things that are tempting but deferred — easier to enforce later.

At the end of Phase 1, restate what you heard as a **project brief**. The brief opens with a *Users & jobs heard:* paragraph — 3–5 bullets capturing whom the spec serves and the jobs they're hiring it to do (distilled from topic 1). The spec target follows on its own line (e.g. *"Target: MVP"*), then the rest of the brief (system, primary nouns, stack, etc.) in 5–10 more lines. Subsequent phases — layer proposal, module identification, module fill-in — will be checked against the *Users & jobs heard* bullets: every layer should serve at least one job (transitively, through its modules), and every module should serve at least one job directly. Ask the user to correct the brief. Do not proceed until they confirm.

## Phase 2 — Layer proposal

Based on the brief, propose a concrete set of layers specific to this project. Example shapes:
- A CLI + library: `L1 Persistence`, `L2 CLI`, `L3 Library API`.
- A web service with an agent in the loop: `L1 DB`, `L2 HTTP API`, `L3 UI`, `L4 Cross-entity Framework`. *(The agent — chat, MCP tool host, prompt/context handling — is typically a **module** in this shape, e.g. `M05 Chat & Agent`, not a layer. Make agent a layer only if multiple feature modules each ship their own agent-facing tools and share conventions for tool registration / streaming / error model.)*
- An agent platform where every feature exposes agent tools: `L1 DB`, `L2 Agent Toolset Conventions`, `L3 HTTP API`, `L4 UI`.
- A static content generator: `L1 Sources`, `L2 Transform`, `L3 Output`.

**Do not propose `L2 Domain` (or `L Domain`, `Business Logic`, etc.).** Every module's domain — its operations, validations, lifecycle, edge cases — is the module's substance, not a layer (see SKILL.md §2 anti-pattern). If multiple modules share a specific cross-cutting *convention* (error envelope shape, audit columns, validation framework), name the layer after that convention precisely (`L2 Error model`, `L2 Audit conventions`) rather than the catch-all "Domain".

Present as a table:

| # | Layer | Purpose (1 line) |
|---|-------|------------------|
| L1 | … | … |

Then ask:
> Confirm this layer set, or suggest additions / renames / removals. Layers should be few enough to keep in your head (3–7) and generic enough that any module can declare which ones it touches.

Iterate until the user confirms.

## Phase 3 — Module identification

From the entities + features, propose modules. For each, list which layers it touches. Present as a table:

| # | Module | Complexity | Layers | Scope (1 line) | File |
|---|--------|-----------|--------|----------------|------|
| M01 | … | simple/medium/complex | L1, L2, L5 | … | `modules/M01-….md` |

Guidance:
- Each **entity type** from Phase 1 is a candidate module — sometimes one entity per module, sometimes several related entities (versioning, history, lookup tables) cluster into one domain slice. Decide per cluster, guided by user job rather than table count.
- Non-entity features can also be modules (config, agent, sync) — see SKILL.md §2 "Vertical slices — modules".
- Bootstrap/project-config is usually the first module (`M01`).
- Modules can skip layers they don't touch (e.g. a pure-UI module might not touch L1).
- Aim for 3–10 modules. If you're heading toward 15+, suggest merging related ones or deferring scope.

Ask the user to confirm, reorder, add, or remove. Iterate until confirmed.

## Phase 4 — Skeleton generation

Now, and only now, write files. Create in this order:
1. `<index>` (copy from `templates/index.md`) with the concepts, the confirmed layer table, the confirmed module table, and a *relations placeholder* section.
2. One empty `layers/LX-<slug>.md` per layer (copy from `templates/layer.md`). Fill in *only* the title and purpose line; leave other sections as section headers with a one-line TODO.
3. One empty `modules/MXX-<slug>.md` per module (copy from `templates/module.md`). Keep the per-layer section headers only for layers the module actually touches; delete the rest.
4. Do **not** create per-module subdirectories up front. They are introduced lazily in Phase 5 only when a specific module's file outgrows the budget — at that point `modules/MXX-<slug>.md` is converted into `modules/MXX-<slug>/` with the slice extracted to `LY-<slug>.md` inside.

After writing, list the created files back to the user and ask: *"Skeleton is in place. Ready to fill modules in order M01 → MNN, or a different order?"*

## Phase 5 — Module-by-module fill-in

For each module (in the chosen order), fill its file in two parts:

1. **Module's own substance** (its domain — *not* a layer): `Purpose`, `Edge cases`, `Acceptance criteria`. Ask the user about the module's operations, validations, lifecycle, and edge cases here. This is the module file's heart and does not belong to any layer section.
2. **Per-layer sections** — for each layer the module touches, ask a layer-scoped question and write the section following that layer's `## Module slice schema`. For example, for a module that touches L1 (persistence) and L3 (HTTP API):
   - *"M03 persistence (L1): what columns does the entity have? Any unique constraints? Any relations?"* → write the L1 section per the layer's schema (or, if it dominates the module file, split M03 into `modules/M03-<slug>/` and move the slice to `modules/M03-<slug>/L1-<slug>.md`).
   - *"M03 HTTP API (L3): what endpoints expose this entity?"* → write the L3 section per the layer's schema.

Do not ask "what does this module do at the domain level" as a separate per-layer question — that's already covered by the module's `Purpose` and `Edge cases`. If the user starts describing operations and validations, capture them in the module's own substance, not in a "domain layer" section.

After finishing a module, summarize what you captured and ask the user to confirm before moving to the next.

## Phase 6 — Layer fill-in

After all modules are written, fill each `layers/LX-<slug>.md`. Layer files are **radically thin** — only three things:

- The layer's role in the system (1–2 orientational sentences).
- **Module slice schema** — the only substantive section. The form in which each consumer module declares its slice (headings, fields, fenced schema, embeds, references to project entities). **Bake every per-module rule into the schema as a field-level requirement** — naming ("table name in snake_case"), validation ("retries: positive int"), gating ("required if optional binary present, omitted otherwise"), allowed values, embed shape. No separate `## Conventions` / `## Patterns` / `## Contracts` sections. When the project models entities and the layer's slice is enumerable, prefer entities embedded via XML tags (e.g. `<tagged_list type="<entity-type>" tags="MNN"/>`) — modules stay short, listings stay live, drift becomes impossible.
- **Implementor module slot** — name the module that implements this layer, or write `external — <name>` when the implementor lives outside our spec (DB engine, HTTP framework, SDK), or `none — pure description convention`. See SKILL.md §2 for when each applies.

If a per-module rule won't fit inside the schema, that's a signal — see SKILL.md §2 ("Where cross-cutting content lives") for how to resolve it. Reflect on the layer instead of adding a prose bucket to the layer file.

**Implementor modules — second pass.** For every layer that names an *internal* implementor module, go to that module's file and expand its section for the layer to cover everything implementation-side: cross-cutting conventions (naming, error handling, structure), patterns consumers copy, contracts ("what consumers can rely on" / "what consumers must provide"), runtime registry, hooks, and shared utilities. The layer file does not duplicate any of this. Skip layers whose implementor is `external — <name>` or `none` — there is no in-spec module to expand.

Apply the layer-purity rule (see SKILL.md §6) as you go: every line in a layer file must stay true if any single module is removed. If a sentence only makes sense because of M03, it belongs in M03, not here.

After all layers are written, update `<index>`:
- Fill in the *Key relations / dependencies* diagram (which modules depend on which, which modules register into which framework layers).
- Add a final top-of-file paragraph summarizing the system.

Announce completion and offer: *"Spec skeleton and contents are complete. Want me to (a) do a coverage review, (b) generate a one-page summary for onboarding, or (c) stop here?"*
