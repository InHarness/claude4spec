## Module or layer

Own entity, own table, own identity, instances the user creates at runtime, or one coherent bundle of behaviour owned by a single user job → **module**. A rule or convention shared by several modules → **layer**, named after the convention — `L2 Error model`, never a catch-all.

"Domain" is a module **section**, not a layer, and it never carries a layer number: a layer made of it would collapse to one paragraph per module, each dying with its module. That substance has a home — the module file's own `## Domain` — so nothing is left homeless by refusing the layer.

An agent (chat, MCP tool host, prompt assembly) is a module by default; it is a layer only when several feature modules each export agent-facing tools under shared conventions.

A framework-shaped layer has one implementor and N consumers. The implementor is named in the layer file's `Implementor module:` slot; an external one — a database engine, an HTTP framework, an SDK — gets no invented module, and the slot reads `external — <name>`.
