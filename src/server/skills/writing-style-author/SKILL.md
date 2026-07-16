---
title: Writing Style Author
description: "Scaffolds a new writing-style skill from a chat request — e.g. 'create a writing style for our team that writes terse, code-first briefs'. TRIGGER attached (available, not forced) to every chat-context thread; open it via Skill('writing-style-author') when the user asks to create/define/author a new writing style. Produces a project-local .claude/skills/<slug>/SKILL.md selectable from the very next query."
version: 1
language: en
scope: contextual
injection: available
---

# Writing Style Author

You are helping the user author a **new writing style** — a project-local skill selectable as `config.writingStyle`, whose content is force-injected (`<project_skill>`) into every chat/patch/brief turn once selected, and whose optional `workflows/brief.md` shapes how brief-authoring interprets a release diff for this project's conventions.

This skill is **available, not forced** — you were not told to use it; open it only when the user is actually asking to create, define, or edit a writing style (as opposed to just asking a question about styles).

---

## What you're producing

A directory `<cwd>/.claude/skills/<slug>/SKILL.md` with YAML frontmatter:

```yaml
---
title: <Human-readable title, e.g. "Terse Engineering">
description: "<One paragraph: what this style optimizes for and who it's for>"
version: 1
language: en   # or 'pl' — whichever the user is authoring in
scope: writing-style
---
```

`scope: writing-style` is what makes it **selectable** (`GET /api/writing-styles`, `PATCH /api/config` with `writingStyle: "<slug>"`). Omit `injection` entirely — it only matters for `contextual` skills like this one; a writing style is always force-injected once selected, regardless of that field.

**Required frontmatter fields** (the registry throws on load if missing/malformed, which silently drops the style from selection): `title` (non-empty string), `description` (non-empty string), `version` (positive integer — start at `1`), `language` (`"en"` or `"pl"`, must match the actual language of the body). Get these right or the style won't appear at all — there's no error surfaced to the user beyond a server-log warning.

Below the frontmatter, write the **body**: the style's actual conventions — tone, structure, terminology, what to prioritize, formatting rules — whatever the user described. This becomes `<project_skill>` content; every agent turn using this style is bound by it as "the BINDING project specification."

**Slug derivation:** `slug = slugify(title)` — lowercase, transliterate diacritics (ł→l, ó→o, ż/ź→z, ę→e, ą→a, ś→s, ć→c, ń→n via NFD decomposition), replace any run of non-`[a-z0-9]` characters with a single `-`, trim leading/trailing `-`. E.g. `"Terse Engineering"` → `terse-engineering`; `"Krótki i rzeczowy"` → `krotki-i-rzeczowy`. Use this exact algorithm — it must match what the server's own `slugify` (`src/shared/slug.ts`) produces, since that's what other code paths (tag creation) rely on for idempotency.

**Optional: `workflows/brief.md`.** If the user also wants this style to shape brief generation specifically, create `<cwd>/.claude/skills/<slug>/workflows/brief.md` — read by the `brief-author` skill's genre workflow when this style is active during a brief thread. Cover: what counts as feature substance vs. spec-format convention to drop, how to inline this style's entity types, the "For implementers" structure for this style. Optional `templates/` and `examples/` subdirectories are also picked up and exposed to the model as reference files.

---

## Workflow

1. Ask (if not already clear from the request) what the style should optimize for, and confirm a title if the user didn't give one outright.
2. Compute `slug` per the algorithm above. If a directory `.claude/skills/<slug>/` already exists, tell the user and ask whether to overwrite, version-bump, or pick a different title/slug — don't silently clobber an existing style.
3. Write `.claude/skills/<slug>/SKILL.md` with the frontmatter contract above and a body capturing the user's actual conventions (don't invent conventions they didn't ask for).
4. Tell the user the style is selectable immediately — no restart needed (the registry rescans project/global `.claude/skills` roots on demand). They can confirm via `GET /api/writing-styles` (should list the new slug) or by setting it as active (`PATCH /api/config` with `writingStyle: "<slug>"`) from the Settings UI.
5. If they ask you to also make it the active style for this project, you may say so is possible via the config UI, but do not call config-mutation endpoints yourself unless a tool for that is actually available in this thread — this skill only writes the skill file.
