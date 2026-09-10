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

**Form.** Content lives exclusively under `###` headings whose names the module chooses — the headings are free, the kinds are not; `###` is the unit and `####` does not occur. At most one paragraph stands directly under the H2, saying what the subsections are. Embeds are **allowed** here, unlike in `Cel`: a subsection may embed an entity that carries a shape it reasons about — what it may not do is carry that shape itself, where the project models shapes elsewhere.

### Rules decidable on the `Domain` section text alone

Each item can be settled by reading the section, with no judgement about the subject matter, and each names the violation symptom — the thing you will actually observe when it is broken:

1. **At most one `## Domain`, and it is the third H2.** *Symptom:* `## Domain (L2)`, a suffix in the heading, or the section standing anywhere but directly after `## Zależności`.
2. **No `n/d` variant.** *Symptom:* a placeholder body under the heading, or `n/d` in the heading itself.
3. **Content only under `###`.** *Symptom:* a `####` heading inside the section; more than one paragraph standing directly under the H2.
4. **No layer identifier in a subsection heading.** *Symptom:* a `###` carrying an `L\d+` token.
5. **Short fences.** *Symptom:* a fenced block longer than 10 lines.
6. **Within the budgets.** *Symptom:* a subsection past 3500 characters, or the whole section past 12000.

**Item 7 is settled against the layer table rather than against the text**, and it sits deliberately outside the six above: *does some layer's slice schema ask for this sentence?* Two readers holding the same layer table reach the same answer, but the reviewer has to read the layer files — no regex does it. The negative test that catches the usual failure: **a lifecycle step listing another module's verbs** — someone else's lifecycle written down a second time, failing question two however fluently it reads.

**The budgets are a detector, not prose hygiene.** When the `Domain` sections of several modules carry content of the same kind in the same shape — each enumerating commands, each enumerating failure codes, each describing a file format — that is a convention shared by modules, which is a layer in the sense of the core concepts. Propose it as one, together with its `## Module slice schema`: the paragraphs leave every `Domain`, and the residual test starts answering differently. The budgets exist so that this moment is visible, not to shorten prose.
