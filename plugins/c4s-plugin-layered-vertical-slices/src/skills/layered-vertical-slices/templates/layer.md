<!--
Template for a layer file (`layers/LX-<slug>.md`) in a layered-vertical-slices spec.
Copy this file, rename it, and replace placeholders.

A layer file is **radically thin**: Purpose + Role + Module slice schema. Nothing else.
For the rules driving that — what belongs in the slice schema vs. the implementor module,
how to handle external/no implementor — see SKILL.md §2 (concepts), §5 (templates), §6 (quality rules).
-->

# LX — <Layer Name>

> <1–2 sentence purpose statement.>

## Role in the system

<1–2 sentences, purely orientational: where this layer sits, what it enables, what it explicitly is NOT responsible for. Do not turn this into a conventions dump.>

## Module slice schema

<This is the only substantive section of a layer file. Define here the *shape* a consumer module's section for this layer takes — and bake every per-module rule (naming, validation, allowed values, gating, embed shape, required fields) into the schema as a requirement.>

**Each module that touches this layer fills its `## <Layer name> (LX)` section with:**

```
<Concrete schema. Pick a form that fits your project — pick one or mix:
 - prose with required headings,
 - a fenced block (Zod / TypeScript type / SQL / table-of-fields),
 - an embed of project entities,
 - a table the module fills,
 - or any combination.

 Encode rules as schema requirements, not separate prose. Examples:
 - "tables in snake_case" → field `Table name (snake_case)`
 - "action gated by optional binary" → field `Gate (binary present? required field; absent? omit)`
 - "validation: positive int" → field `Retries: positive int (default 3)`>
```

*Recommended shape when the project models entities:* declare the slice as an entity type and embed the live list via `<tagged_list type="<entity-type>" tags="MNN"/>`. Module prose then explains *why*; the canonical list stays in entities, drift becomes impossible. Skip this shape if the project has no entity machinery or the slice doesn't warrant it.

> **Implementor module:** `MNN — <name>` *(or "external — <name>" when the implementor lives outside our spec, e.g. PostgreSQL, Express; or "none — pure description convention")*

*If an implementor module is named*: it owns the **runtime, framework conventions, registry, hooks, and the "what consumers can rely on" half of the contract** for this layer — document them in its file's section for this layer (how-mode), not here.
