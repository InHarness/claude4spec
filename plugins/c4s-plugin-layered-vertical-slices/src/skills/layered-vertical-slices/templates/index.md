<!--
Template for the index file of a layered-vertical-slices spec.
Copy this file, rename it (default `index.md`, or `SKILL.md` if the spec is also a Claude Code skill), and replace placeholders.
See SKILL.md §5 and §6 for guidance.
-->

# Specification: <Project Name>

<2–4 sentences describing what the project is and who uses it.>

> **Spec target:** <Research prototype | MVP | Feature-complete | Production-hardened>.
> <1 sentence on what this scope includes and what it explicitly defers to a later spec.>

## Core principle

<One sentence that captures the architectural soul of the system. E.g.:
"Markdown is the source of truth for content; SQLite is the source of truth for entities; XML tags are the bridge.">

## High-level architecture

<Optional: an ASCII diagram or a brief prose description of the main components and data flow. Skip if the system is simple.>

## Key concepts

<3–5 foundational truths the system is designed around — stated from the project's worldview, not as a tour of how this spec organizes them. Each concept names *what is true about the system as designed* (a principle, an invariant, a stance the project takes); it is not a description of how the concept is later realized across modules, layers, files, or anchors.

Write so a reader can grasp the concept before opening any module or layer file. Do not cross-reference MXX / LY / filenames / anchors here — those belong in the modules table, layer table, and key-relations diagram below. If a concept can only be explained by pointing at where it lives in the spec, it isn't a key concept yet; it's spec mechanics — drop it or rephrase it as the underlying principle.>

### <Concept 1>
<1 paragraph: state the principle/invariant, then a concrete intuition for what it means in practice — without naming spec internals (no MXX, no LY, no file paths).>

### <Concept 2>
<1 paragraph.>

## Jobs this spec serves

*Optional — recommended for Feature-complete and Production-hardened targets; usually skipped for Research prototype and MVP. Distilled from Phase 1 topic 1 ("Users & jobs"). Modules are checked against this table — every module should serve at least one job; jobs without modules are gaps.*

| Job | Primary user | Modules involved | Success looks like |
| --- | --- | --- | --- |
| J1 | … | M01, M03 | … |
| J2 | … | M02 | … |

## Layers

Conventions shared across modules live in `layers/`:

| Layer | File | Purpose |
| --- | --- | --- |
| **L1 — <name>** | `layers/L1-<slug>.md` | <1 line> |
| **L2 — <name>** | `layers/L2-<slug>.md` | <1 line> |
| … | … | … |

## Modules

Each module is a vertical slice through the layers. Modules skip layers they don't touch.

| # | Module | Complexity | Layers | Scope | File |
| --- | --- | --- | --- | --- | --- |
| M01 | **<name>** | simple | L1, L2 | <1 line> | `modules/M01-<slug>.md` |
| M02 | **<name>** | medium | L1, L2, L4, L5 | <1 line> | `modules/M02-<slug>.md` |
| … | … | … | … | … | … |

### Key relations

<ASCII or prose diagram showing module → layer registrations, module ↔ module relations, and what-feeds-what. Example lines:

M03 Endpoint     -- registers in --> L6 References  (rendering, tags)
M03 Endpoint     <-- relation -->   M04 DTO         (request/response)
M05 Agent        -- consumes --> M03, M04 MCP tools
M01 Project      -- infrastructure --> all modules
>

## [Optional] <Layer-specific index>
<Only if at least one module has been split into a per-module subdirectory. Cross-list extracted slices for one layer across modules — e.g. "DB schemas" listing every `modules/*/L1-<slug>.md`, "Agent tools" listing every `modules/*/L4-<slug>.md`.>

| File | Module / Layer | Description |
| --- | --- | --- |
| `modules/M01-<slug>/L1-<slug>.md` | M01 / L1 | … |

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | … |
| Persistence | … |
| … | … |

## Acceptance criteria

<!-- Preferred when the project models AC entities: embed the high-level, project-wide criteria as
     `ac` entities — either by a shared tag (`<tagged_list type="ac" tags="<project-tag>"/>`) or a
     curated set (`<element_list type="ac" slugs="ac-...,ac-..."/>`). -->
<tagged_list type="ac" tags="<project-tag>"/>

<!-- Fallback — only when the project does not model AC as entities. Inline observable checklist:
- [ ] <high-level outcome 1>
- [ ] <high-level outcome 2>
- [ ] …
-->

## Open questions

1. <question — mark resolved with ~~strikethrough~~ + short note when answered>
