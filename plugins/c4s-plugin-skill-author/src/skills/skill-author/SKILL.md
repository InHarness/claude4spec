---
title: Skill Author
description: "Writes the project's own skills — procedures, checklists and conventions for the agent — as packages in the project's skills root. Open it via load_skill_file('skill-author') when the user asks to create, define or change a project skill (instructions for the agent, not a writing style). Writes only with update_skill_file, so it works with direct file access blocked."
version: 1
language: en
scope: contextual
contextTypes: [chat, patch]
---

# Skill Author

You are helping the user write a **project skill**: instructions for an agent — a procedure, a checklist, a set of conventions — kept in this project and offered to the agent in later turns. A skill is not a page of the specification and not a writing style. The specification describes the product; a skill tells an agent how to do a piece of work.

You were not told to use this skill. Open it only when the user actually asks to create, define or change a project skill, not when they merely ask what skills exist.

---

## The one rule about writing

Write every file of a skill package with **`update_skill_file`** (server `spec-skill-tools`). Nothing else:

- not the built-in file tools (Write, Edit, Bash) — they may be blocked in this project, and even where they are not, a file written past the tool skips the hash guard and the header check;
- not the page tools (`create_page`, `update_page`, …) — the skills root is not a page root, and a page tool knows nothing about a package.

Because the write goes through an MCP tool and not through the file system, it works the same with direct file access blocked (`agent.disableDirectFilesystemAccess`). If `update_skill_file` is not available in this turn, say so and stop — do not fall back to another way of writing.

Read with **`load_skill_file(slug, file?)`**. Its answer carries the file's `hash`; that hash is what the next write passes as `expectedHash`.

---

## What a package is

A package is a first-level directory of the project's `skills` root. Its **slug is the directory name** — kebab-case, one segment, no `/`, not starting with `.`.

```
<slug>/
  SKILL.md            ← header + entry instruction (required)
  workflows/…md       ← optional subfiles the entry instruction points to
  checklists/…md
```

`SKILL.md` starts with a YAML header:

```yaml
---
title: <Human-readable name>
description: "<One or two sentences: WHEN the agent should open this skill, and what it gets>"
version: 1
language: en          # or pl — the language the instruction is written in
scope: contextual     # REQUIRED for an agent skill; omitting it makes the package a writing style
contextTypes: [chat]  # optional; subset of chat, brief, patch, ask; omitted = all four
---
```

- `description` must be non-empty — `update_skill_file` refuses a `SKILL.md` without it. It is the only thing the agent sees in the listing, so it is a trigger, not a summary: name the situation in which the skill applies.
- `scope: contextual` is what makes it a skill on the listing. Leave it out and the package becomes a selectable writing style instead.
- `contextTypes` narrows where the skill is listed. Choose it deliberately: a skill about reviewing patches belongs in `patch`; a skill about answering questions may belong in `ask`. Leaving it out lists the skill everywhere.

A package whose header is broken stays editable but does not reach the listing until it is fixed.

---

## How to write the instruction

Write for an agent that has never seen this project's habits. That is a different style from the specification:

1. **Imperative, second person.** "Read the release diff first. Then …" — not "The release diff is read first."
2. **Procedure before background.** Start with the steps; put the reasons in a short paragraph after them, only where a step would otherwise look arbitrary.
3. **Checklists for checks.** Anything the agent must verify before finishing goes into a numbered list it can tick off.
4. **Name the stop conditions.** Say when the agent must stop and ask the user instead of guessing.
5. **One entry, subfiles for depth.** Keep `SKILL.md` short enough to read in one go; move long procedures into subfiles and point to them by package-relative path (`workflows/review.md`).

Do **not** refer to sections or pages of the specification by anchor or by path: package files have no anchors, and a page is not a subfile of the package, so such a reference stays plain text that leads nowhere. Entity tags are allowed — they belong to the project's reference graph.

---

## Procedure

1. **Agree on the skill.** Ask what work it covers, in which kinds of turn it should be offered (`contextTypes`), and its language. Propose a slug.
2. **Check the slug.** Look at `<available_skills>` and call `load_skill_file(<slug>)`. If a skill with that slug exists, either edit it (with the user's consent) or choose another slug. A skill that comes from an exposed project is read-only here — propose the change to its owner instead.
3. **Create `SKILL.md`.** `update_skill_file({ slug, file: "SKILL.md", content, expectedHash: "" })`. `""` means "this file must not exist yet".
4. **Add subfiles**, one call each, also with `expectedHash: ""`.
5. **Edit later** by reading first: `load_skill_file(slug, file)` → take its `hash` → `update_skill_file({ slug, file, textEdits: [{ find, replaceWith }], expectedHash: hash })`. Use `content` instead of `textEdits` only to replace the whole file. Pass exactly one of the two.
6. **On a conflict** (`PAGE_CONFLICT`), someone changed the file since you read it: read it again, re-apply your change to the new text, and write with the new hash. Never overwrite blindly.
7. **Report** the slug, the files written and the `contextTypes`. A new package is on the listing from the next thread on — no restart.

---

## Checklist before you finish

1. Every file was written with `update_skill_file`, none with a file or page tool.
2. `SKILL.md` has `title`, a non-empty `description` that says when to open it, `version: 1`, `language`, and `scope: contextual`.
3. `contextTypes` is either deliberately set or deliberately left out — and you told the user which.
4. Every subfile the entry instruction mentions exists, at the package-relative path it names.
5. No anchor or page path of the specification appears in the package.
