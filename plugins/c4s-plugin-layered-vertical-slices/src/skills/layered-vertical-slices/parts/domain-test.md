## The module's `Domain` section

A module's **main file** carries **at most one** `## Domain`, and it is the file's **third** H2 — directly after `## Zależności`, with no layer number and no suffix in the heading. It is a section **of the module, not a layer**: no file in `layers/`, no `## Module slice schema`, no `Implementor module:` slot. Its rules travel with the workflows, exactly as `Cel`'s do. A module whose whole substance is the how-mode of the layer it implements simply has no such section, and **there is no `n/d` variant** — a module with nothing of its own omits the section entirely rather than leaving a heading with a placeholder under it. The mirror case is equally correct: a module touching no layer at all has a purpose, a `Domain` and acceptance criteria.

**What belongs here — the residual test, settled against this project's layer table.** Layers decide what a module says in its layer sections: each layer file fixes, in its `## Module slice schema`, the fields a module answers, and a sentence answering such a field belongs in that layer's section and nowhere else. Three further sections have a fixed subject of their own: `Cel` (what for), edge cases (situation → behaviour), acceptance criteria (what is observable). `Domain` carries the rest — the substance of the module **no layer of this project asks about**: its own model, the rules its operations obey, the processes it owns from beginning to end, what it deliberately does not do.

The test is **relative, and it changes over time**: in a project with no layer for the command line, the behaviour of commands is `Domain` substance; the day such a layer is introduced, those same paragraphs become its slice and move.

Settling a paragraph is **three questions, in this order**:

1. **Does any layer of this project ask for it?** An answer to a field of a layer's slice schema goes into that layer's section.
2. **Does this module own the fact?** Would the sentence still stand here if every other module vanished. Someone else's insides are one sentence and a pointer; a rule is written once, at its owner.
3. **Specification or implementation?** Function names, paths and library calls are settled by the no-code rule.

Whatever passes all three and is neither a purpose, nor an edge case, nor a criterion is `Domain`.

The substance takes four shapes in practice — a description, not a closed list, and not headings to copy out: the **model** (concepts, identity, states); **invariants and decisions**, each with its reason, negative scope included; the **lifecycle** the module owns end to end, one line per step, a step owned by someone else being a sentence and a pointer; the **boundary** — what the module deliberately does not do.

