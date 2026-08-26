---
title: Writing Style Author
description: "Scaffolds a new writing-style skill from a chat request — e.g. 'create a writing style for our team that writes terse, code-first briefs'. Attached to every chat-context thread; open it via load_skill_file('writing-style-author') when the user asks to create/define/author a new writing style. Produces a project-local .claude/skills/<slug>/ package — SKILL.md plus a workflows/ directory — selectable from the very next query."
version: 1
language: en
scope: contextual
---

# Writing Style Author

You are helping the user author a **new writing style** — a project-local skill selectable as `config.writingStyle`. The selected style is the only skill that gets a `<project_writing_skill>` block in a turn, in all four context types (chat/brief/patch/ask), and its `workflows/` sub-files are the sole home of **genre methodology**: how a brief gets written, how a patch gets implemented, for this project's conventions.

That last point is the thing to get right. The host injects no methodology of its own and does not know your directory layout — it only ships `SKILL.md` as content plus every other file in the package. A style without `workflows/brief.md` leaves the brief agent with its identity and its posture but no method.

You were not told to use this skill — open it only when the user is actually asking to create, define, or edit a writing style (as opposed to just asking a question about styles).

---

## What you're producing

A directory `<cwd>/.claude/skills/<slug>/` containing `SKILL.md` **and** a `workflows/` subdirectory.

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

**Required frontmatter fields** (the registry throws on load if missing/malformed, which silently drops the style from selection): `title` (non-empty string), `description` (non-empty string), `version` (positive integer — start at `1`), `language` (`"en"` or `"pl"`, must match the actual language of the body). Get these right or the style won't appear at all — there's no error surfaced to the user beyond a server-log warning. Unknown keys are ignored, so a stray field is harmless; note that `injection` used to be one of these and no longer means anything — don't write it, and don't be alarmed by it in an older style.

Below the frontmatter, write the **body**: the style's actual conventions — tone, structure, terminology, what to prioritize, formatting rules — whatever the user described. This becomes the body of the turn's `<project_writing_skill>` block. The prompt does not claim it is a specification of anything — it renders the style's own `description` and says the style governs how the agent writes. What binds is what you write here.

**Slug derivation:** `slug = slugify(title)` — lowercase, transliterate diacritics (ł→l, ó→o, ż/ź→z, ę→e, ą→a, ś→s, ć→c, ń→n via NFD decomposition), replace any run of non-`[a-z0-9]` characters with a single `-`, trim leading/trailing `-`. E.g. `"Terse Engineering"` → `terse-engineering`; `"Krótki i rzeczowy"` → `krotki-i-rzeczowy`. Use this exact algorithm — it must match what the server's own `slugify` (`src/shared/slug.ts`) produces, since that's what other code paths (tag creation) rely on for idempotency.

### The `workflows/` directory

Always create it, even if you only fill one file. Each file answers "how does THIS project produce this genre":

- `workflows/brief.md` — read by the agent in a brief thread. Cover: how to recognise which branch of work this is (an `analysis`-source brief vs a `release-diff` one; an empty body vs a filled one), the step sequence for generating the narrative, how to partition a heavy `release_diff` across `diff-explore` subagents, and the narrative structure — including which RawDelta entries are spec-format convention and should be dropped.
- `workflows/patch.md` — read by the agent in a patch thread. Cover: the sequence for implementing a filed deviation, the verification discipline, when to delegate to `spec-explore`, and how to report what was deliberately not implemented.
- anything else (`bootstrap.md`, `daily.md`, …) — free-form, for work in `chat`.

Every file in the package except `SKILL.md` reaches the agent, whatever you name the directory — so `templates/`, `examples/` or `reference/` are all picked up as well. Keep them text: a binary file is skipped with a warning.

---

## Workflow

1. Ask (if not already clear from the request) what the style should optimize for, and confirm a title if the user didn't give one outright.
2. Compute `slug` per the algorithm above. If a directory `.claude/skills/<slug>/` already exists, tell the user and ask whether to overwrite, version-bump, or pick a different title/slug — don't silently clobber an existing style.
3. Write `.claude/skills/<slug>/SKILL.md` with the frontmatter contract above and a body capturing the user's actual conventions (don't invent conventions they didn't ask for).
4. Write the `workflows/` files. If the user has said nothing about brief or patch methodology, ask — or write a minimal `workflows/brief.md` and say plainly that it's a starting point, rather than leaving the directory empty and the genre without a method.
5. Tell the user the style is selectable immediately — no restart needed (the registry rescans project/global `.claude/skills` roots on demand). They can confirm via `GET /api/writing-styles` (should list the new slug) or by setting it as active (`PATCH /api/config` with `writingStyle: "<slug>"`) from the Settings UI.
6. If they ask you to also make it the active style for this project, you may say so is possible via the config UI, but do not call config-mutation endpoints yourself unless a tool for that is actually available in this thread — this skill only writes the skill files.
