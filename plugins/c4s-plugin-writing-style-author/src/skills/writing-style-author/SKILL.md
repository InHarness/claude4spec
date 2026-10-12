---
title: Writing Style Author
description: "Authors a new writing style from a chat request — e.g. 'create a writing style for our team that writes terse, code-first briefs'. Open it via load_skill_file('writing-style-author') when the user asks to create/define/author a new writing style. Two routes, settled with the user (or asked) before the first write: a style for this project is a package in the project's skills root (.claude4spec/skills/<slug>/ — SKILL.md plus a workflows/ directory) written with update_skill_file, selectable from the very next query; a style for the other projects of the workspace is this project's own pages, written with the page tools and exposed by the author in the #skills settings tab. Writing styles only: any other kind of skill package belongs to the skill-author skill."
version: 1
language: en
scope: contextual
---

# Writing Style Author

You are helping the user author a **new writing style** — a project-local skill selectable as `config.writingStyle`. The selected style is the only skill that gets a `<project_writing_skill>` block in a turn, in all four context types (chat/brief/patch/ask) — forcing is a property of that SLOT, not something a skill can ask for — and its `workflows/` sub-files are the sole home of **genre methodology**: how a brief gets written, how a patch gets implemented, for this project's conventions.

That last point is the thing to get right. The host injects no methodology of its own and does not know your directory layout — it only ships `SKILL.md` as content plus every other file in the package. A style without `workflows/brief.md` leaves the brief agent with its identity and its posture but no method.

You were not told to use this skill — open it only when the user is actually asking to create, define, or edit a writing style (as opposed to just asking a question about styles).

**Writing styles only.** This skill writes packages with `scope: writing-style` and nothing else. If the user asks for a skill package of any other kind — a procedure, a checklist, instructions for the agent (`scope: contextual`) — do not scaffold it here: say that this is the job of the `skill-author` skill and open it with `load_skill_file("skill-author")` instead.

**Where you can write.** Writing a style needs a `chat` or `patch` thread. In a `brief` or `ask` thread — you can tell it by `update_skill_file` (server `spec-skill-tools`) not being among your tools — write no style on either route below: no package, no pages. A `brief` thread has no skill-write and no page-write server; an `ask` thread runs in forced plan mode and has no skill-write server. Do not try another way (no Write, no Bash, no `create_page`, no `update_sections`): tell the user that writing a style needs a `chat` or `patch` thread, and stop. The "Block direct file access" setting does not matter on either route — `update_skill_file` and the page tools are not file built-ins.

## First: which route

A style reaches its readers in one of two ways, and each route writes a different artifact with different operations — so settle the route **before the first write**:

- **Route A — a style for this project.** The style is a package in this project's skills root, written with `update_skill_file`, and selectable here as `config.writingStyle`. See "Route A" below.
- **Route B — this project exposed as a style for the other projects of the workspace.** The style is this project's own pages, written with the page tools, and other projects attach it by name. See "Route B" below.

If the conversation does not settle which project the style is for — this one, or the other projects of the workspace — **ask before you write anything**; do not guess.

If the author picks Route A in a project that is, or is going to be, exposed as a skill, warn them first: a package in the `skills` root is not part of an exposed project, so a style written on Route A will not reach any project that attaches this one.
---

## Route A — a style for this project

### What you're producing

A package `<slug>/` in the project's skills root (`.claude4spec/skills/<slug>/`) containing `SKILL.md` **and** a `workflows/` subdirectory. You never address it by a disk path: every file is one `update_skill_file` call with `slug: "<slug>"` and `file` relative to the package (`"SKILL.md"`, `"workflows/brief.md"`, …), and a new file is created with `expectedHash: ""`.

`SKILL.md`, with YAML frontmatter:

```yaml
---
title: <Human-readable title, e.g. "Terse Engineering">
description: "<One paragraph: what this style optimizes for and who it's for>"
version: 1
language: en   # or 'pl' — whichever the user is authoring in
scope: writing-style
---
```

`scope: writing-style` is what makes it **selectable** (`GET /api/writing-styles`, `PATCH /api/config` with `writingStyle: "<slug>"`).

**Required frontmatter fields** (`update_skill_file` refuses a `SKILL.md` without a non-empty `description`; any other missing/malformed field is written, but the registry skips the package, which silently drops the style from selection): `title` (non-empty string), `description` (non-empty string), `version` (positive integer — start at `1`), `language` (`"en"` or `"pl"`, must match the actual language of the body). Get these right or the style won't appear at all — there's no error surfaced to the user beyond a server-log warning. Unknown keys are ignored, so a stray field is harmless; note that `injection` used to be one of these and no longer means anything — don't write it, and don't be alarmed by it in an older style.

Below the frontmatter, write the **body**: the style's actual conventions — tone, structure, terminology, what to prioritize, formatting rules — whatever the user described. This becomes the body of the turn's `<project_writing_skill>` block. The prompt does not claim it is a specification of anything — it renders the style's own `description` and says the style governs how the agent writes. What binds is what you write here.

**Slug derivation:** `slug = slugify(title)` — lowercase, transliterate diacritics (ł→l, ó→o, ż/ź→z, ę→e, ą→a, ś→s, ć→c, ń→n via NFD decomposition), replace any run of non-`[a-z0-9]` characters with a single `-`, trim leading/trailing `-`. E.g. `"Terse Engineering"` → `terse-engineering`; `"Krótki i rzeczowy"` → `krotki-i-rzeczowy`. Use this exact algorithm — it must match what the server's own `slugify` (`src/shared/slug.ts`) produces, since that's what other code paths (tag creation) rely on for idempotency.

#### The `workflows/` directory

Always create it, even if you only fill one file. Each file answers "how does THIS project produce this genre":

- `workflows/brief.md` — read by the agent in a brief thread. Cover: how to recognise which branch of work this is by the **shape of the window** (`to_release === null` → a brief against the current state, and the workflow does not call `release_diff` at all; both ends non-null → a brief from a release diff; `from_release === null` → a brief from the very beginning; an empty body vs a filled one), the step sequence for generating the narrative, how to partition a heavy `release_diff` across `diff-explore` subagents, and the narrative structure — including which RawDelta entries are spec-format convention and should be dropped.
- `workflows/patch.md` — read by the agent in a patch thread. Cover: the sequence for implementing a filed deviation, the verification discipline, when to delegate to `spec-explore`, and how to report what was deliberately not implemented.
- anything else (`bootstrap.md`, `read.md`, `plan.md`, `apply.md`, …) — free-form, for work in `chat`.

Every file in the package except `SKILL.md` reaches the agent, whatever you name the directory — so `templates/`, `examples/` or `reference/` are all picked up as well. Keep them text: a binary file is skipped with a warning.

---

## Route B — this project exposed as a style

### What you're producing

On this route **the style is this project's pages**: the pages of the project's base root (the built-in pages root, usually `rootId: "pages"`). Nothing is written to the `skills` root, and `update_skill_file` is never called.

- **The entry page** is the page named by the project's `skill.entry` (by default `index.md` of the base root). It plays the part `SKILL.md` plays on Route A: the style's conventions — tone, structure, terminology, formatting rules.
- **Subfiles** are the other pages of the base root, each addressed by its path in that root — e.g. `workflows/brief.md`, `workflows/patch.md` carry the genre methodology exactly as the `workflows/` directory does on Route A.
- **Write them with the page tools**: `create_page` (`rootId` of the base root, `path`, `content`) for a page that does not exist yet, `update_sections` for one that does. Never `update_skill_file`.
- **These are pages of this project**, so the project's own active writing style governs how you write them, like any other page here. Being a style for others does not change that.
- **Point at subfiles by address.** The entry page sends the reader to a subfile with `load_skill_file("<skill.name>", "workflows/brief.md")`, where `<skill.name>` is this project's `skill.name` — the name other projects attach it by. Ask the author for it if they have not set it yet. Do not use section references or entity embeds as pointers: they reach the consumer flattened to text and carry no subfile address.
- **The entry page carries the form clause** — the same block as on Route A (see step A3 below), entity form before the fenced block.
- **The whole base root is readable.** Every page of the base root is a subfile, so tell the author that a project which attaches this one will also read any notes and drafts kept in this root.

### Exposing it is the author's job

Do not change the project's configuration on this route — no config endpoints, no toggling exposure yourself. Finish by pointing the author to the **`#skills` tab of the project settings** (Settings → Agent → Skills): there they turn on "Expose this project as a skill", fill in the skill name and description, and set **Scope** to `writing-style`. Left at the default `contextual`, the exposed project is not a selectable style in other projects — only a contextual skill on their listing.

A project attaching itself is ignored, so tell the author to check the style from a project that attaches this one.

---

## Workflow

1. Check that this is a style request (otherwise: `skill-author`, see above) and that `update_skill_file` is among your tools (otherwise: a `brief` or `ask` thread — say it needs a `chat` or `patch` thread, and stop; write nothing on either route).
2. Settle the route (see "First: which route"). If the conversation does not settle it, ask now — before the first write. On Route A in a project that is or will be exposed, give the warning above.
3. Ask (if not already clear from the request) what the style should optimize for, and confirm a title if the user didn't give one outright.

### Route A

A1. Compute `slug` per the algorithm above. If `load_skill_file("<slug>")` already answers with a package of this project's skills root — or a write with `expectedHash: ""` comes back `PAGE_CONFLICT` — the package exists: tell the user and ask whether to overwrite, version-bump, or pick a different title/slug. Don't silently clobber an existing style.

A2. Write `SKILL.md` — `update_skill_file({ slug, file: "SKILL.md", content, expectedHash: "" })` — with the frontmatter contract above and a body capturing the user's actual conventions (don't invent conventions they didn't ask for).

A3. **Always include the form clause in the body you write.** Whatever the user's conventions are, the generated style must enumerate the entity form beside prose, table and fence — the first form a style lists reads as its default, so a style silent on entities teaches the agent to reach for a raw fence even in a project that models the thing as an entity type. Write the clause **without the slug of any concrete type**, conditionally, over the type variable; a hardcoded slug costs the style its portability between projects with different `config.entities` catalogues. Emit this block verbatim into the generated `SKILL.md` (adapt the surrounding prose to the style's voice, keep the ordering and the scope sentence):

   ```
   **Form clause.** Wherever this style enumerates the admissible forms for recording something,
   list them in this order: prose, an embed of project entities (when the project models this kind
   of thing as an entity type), a fenced block, a table. The entity form is not a fallback — it is
   listed before the fenced block because the first form listed reads as the default. A rule that
   forbids a class of content must state its scope: name what the prohibition does not cover.
   ```

A4. Write the `workflows/` files, one `update_skill_file` call each (`file: "workflows/brief.md"`, …, `expectedHash: ""`). If the user has said nothing about brief or patch methodology, ask — or write a minimal `workflows/brief.md` and say plainly that it's a starting point, rather than leaving the directory empty and the genre without a method.

A5. Tell the user the style is selectable from the very next query — no restart needed (the registry re-reads the project's skills root on demand). They can confirm it in Settings → Project → Writing style, where it is badged as a project skill, or via `GET /api/writing-styles`.

A6. If they ask you to also make it the active style for this project, you may say so is possible via the config UI, but do not call config-mutation endpoints yourself unless a tool for that is actually available in this thread — this skill only writes the skill files.

### Route B

B1. Settle the entry page (the project's `skill.entry`, by default `index.md` of the base root) and the `skill.name` the entry page will use in its `load_skill_file` addresses; ask the author for whichever is not known. Tell them that every page of the base root, notes and drafts included, will be readable by projects that attach this one.

B2. Write the entry page with `create_page` (or `update_sections` if it exists) — the style's conventions, the form clause from step A3 verbatim, and a `load_skill_file("<skill.name>", "workflows/…")` address for each subfile.

B3. Write the subfiles (`workflows/brief.md`, `workflows/patch.md`, …) as pages of the base root, one `create_page` each — `update_sections` for a page that already exists. Never `update_skill_file` on this route.

B4. Change no configuration. End by pointing the author to the `#skills` tab of the project settings, where they expose the project, set its name and description and set Scope to `writing-style`; then tell them to check the style from a project that attaches this one.
