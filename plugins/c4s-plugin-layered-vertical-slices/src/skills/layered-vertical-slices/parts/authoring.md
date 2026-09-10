## Authoring rules — what a file must satisfy

Numbered from the same catalogue as the placement rules; a symptom marks what can be checked on the text alone.

1. **Index stays in sync with files.** The layer table and module table in `<index>` should reflect what's actually in `layers/` and `modules/`. When you add or rename, update the table in the same edit. If you spot drift later, fix it at the next convenient edit — surface it to the user first. *Symptom:* a row in the module table with no file, or a module file with no row; a layer some module touches missing from the layer table; an edge shown by a `## Zależności` embed that the index's relations diagram does not draw.

4. **Ask, don't assume.** When the user's answer is ambiguous, stop and ask one short clarification. Do not invent column names, endpoint paths, or business rules. **Special case — user-need rationale:** if the *why* behind a module or change is unclear, that is a hard stop. Name your gap and ask before authoring. Do not infer the user-need from technical context alone.

5. **Bounded scope per file.** If a module file heads past ~250 lines, propose splitting one or more layer slices out into a per-module subdirectory: convert `modules/MXX-<slug>.md` into `modules/MXX-<slug>/`, with the module's own substance in `MXX-<slug>.md` and each extracted layer slice in `LY-<slug>.md` (filename matches the corresponding `layers/LY-<slug>.md`). *Symptom:* a module file past ~250 lines, or one layer slice past ~30 lines dominating it, still in a single file.

6. **No code, no tests, no build config.** You are writing specification. If the user asks for code, stay in-role: "This prompt is scoped to the spec — I can describe behavior; a separate implementation pass writes the code."

   **Scope.** The canonical *shape* of a contract — a manifest, a schema, a convention — is not implementation. If the project models it as an entity type and the content clears that type's promotion threshold, record it as an entity rather than as a raw fenced block. What this rule forbids is implementation code, tests and build configuration written into spec prose. *Symptom:* a fenced block of implementation code, a test, or build configuration in a module or layer file.

7. **Version-safe numbering.** Module *and layer* numbers are stable. If a module or layer is deleted mid-design, leave the number retired rather than renumbering survivors. Layers are appended in introduction order — do not reshuffle when a deeper-concern layer is added later. Mark in `<index>`: `M04 — (retired)` or `L3 — (retired)`. *Symptom:* a number reused after a deletion; survivors renumbered; a removed module or layer simply absent from `<index>` instead of marked retired.

8. **Acceptance criteria are observable.** Every module file, and `<index>` at the project level, carries a `## Acceptance criteria` section, and each criterion in it must be something a reader could verify by using the system, not a vague goal. The form this style prescribes is an inline `- [ ]` checklist of such criteria. **Variant — only if this project models acceptance criteria as entities** (an `ac` entity type is registered here): the criteria may live as `ac` entities instead — created via the project's MCP tools, tagged by module (e.g. `mNN`, with edge cases under a sibling tag like `mNN-edge`), `kind` set to `requirement` or `edge-case`, and `verifies` linking the entities they check — with the section embedding them as `<tagged_list type="ac" tags="mNN"/>` plus a sentence of prose explaining *why*, not *which*. Nothing in this style requires that type to exist; where it does not, the checklist is the whole of the section. The same observability bar applies to both forms. *Symptom:* a criterion no reader could verify by using the system; where the project does embed AC entities, an embed written with the prose spelling (`tags="MXX"`), which selects a tag nothing carries and renders empty with no error.

## The module's `Cel` section

Every module's **main file** — `modules/MXX-<slug>.md`, or `modules/MXX-<slug>/MXX-<slug>.md` once split — opens with exactly one `## Cel`, the file's **first** H2, with nothing between the H1 and it: content placed there gets no anchor of its own and is invisible to the section index and to the cross-cutting sweep that reads every module's purpose. A split module's layer subpages carry a slice, not a purpose, and have no `## Cel` — they are the files the sweep's path filter discards.

**Composition.** One sentence naming the **user job** — who does what, to what end. Then **2–4 sentences** on how the module realizes that job and what it explicitly does **not** do. **Budget: 1200 characters for the whole section** — a `Cel` that needs more is describing substance that belongs in the layer sections below it.

**Self-sufficiency prohibition.** `Cel` carries **no entity embeds, no `section_ref`, and no module or layer identifiers — including its own**. Every relational boundary already has a home — a module on the other side → `## Zależności` (rule 3a); a layer → that layer's own section (rule 3) — so naming one here gives a fact two homes. The prohibition *narrows* the host's referential convention rather than fulfilling it: inside `Cel` an entity is named neither by an embed tag nor by untagged prose. Negative scope is allowed — "introduces no tables of its own", "exposes no tool" — because it needs no foreign identifier.

### Rules decidable on the section text alone

Each item below can be settled by reading the section, with no judgement about the subject matter, and each has a **named violation symptom** — the thing you will actually observe when it is broken:

1. **Exactly one `## Cel`, and it is the first H2.** *Symptom:* a second `## Cel` later in the file, or another H2 (`## Zależności`, a layer section) standing ahead of it.
2. **No content between the H1 and it.** *Symptom:* a blockquote, paragraph, table or list sitting under the H1 with no heading of its own — an unanchored block.
3. **No entity embeds and no `section_ref`.** *Symptom:* an XML embed tag (`<tagged_list …/>`, `<inline_mention …/>`, `<single_element …/>`) or a `section_ref` inside the section body.
4. **No module or layer identifiers.** *Symptom:* a token matching `M\d+` or `L\d+` in the section body — the module's own number included.
5. **Prose only.** *Symptom:* a `-`/`*`/`1.` list item, a `|` table row, or a `>` blockquote inside the section.
6. **Within the character budget.** *Symptom:* the section body exceeds 1200 characters.

**Item 7 is qualitative only, and the specification does not pretend otherwise.** Written as a yes/no question: *does the opening sentence name a user job?* No machine settles it. The negative test that catches the common failure is tautology — a sentence of the form "X handles X" ("M03 manages endpoints", "the workspace module manages workspaces") names the module's subject, not anyone's job, and fails the question however fluently it reads.
