---
title: Layered Vertical Slices
description: "Layered, vertical-slice specifications: modules crossed with layers, a read → plan → apply workflow for work on an existing spec, and bootstrap, brief and patch workflows that carry the rules of their own steps."
version: 2
language: en
---

# Layered Vertical Slices

A specification in this style is a grid. A **module** (`modules/MNN-<slug>`) is a vertical
slice: one user job and everything specific to it. A **layer** (`layers/LY-<slug>`) is a
convention modules share: its file holds no module content, only — in `## Module slice
schema` — the headings and fields a module answers for that layer. `<index>` is the root
page that lists both.

A module file reads `## Cel` → `## Zależności` → `## Domain` → one section per layer it
touches → edge cases → acceptance criteria. Each layer section is that layer's schema
filled in: its headings, in the module's own file, answered for this module.

Users speak in intent, complaints and edits: work out the need first, then place it on
the grid.

## Route

Load a workflow with `load_skill_file` before you act, and take every rule from it, never
from memory. The thread type is in `<interaction_context type="…">`.

| The thread | Workflow |
| --- | --- |
| `type="brief"` | `workflows/brief.md` |
| `type="patch"` | `workflows/patch.md` |
| no `<index>` yet | `workflows/bootstrap.md` |
| anything else | `workflows/read.md` first, once per thread. A question ends there. Then `workflows/plan.md` when the turn must place a change — plan mode, an idea, a complaint — or `workflows/apply.md` when it changes the spec — an approved plan, an edit whose place is stated. |
