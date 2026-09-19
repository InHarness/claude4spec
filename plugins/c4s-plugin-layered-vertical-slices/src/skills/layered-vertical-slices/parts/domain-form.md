## The module's `Domain` section — form

**Form.** Content lives exclusively under headings whose names the module chooses — the headings are free, the kinds are not. They start at `###` and nest as deep as the content needs, down to `######`. At most one paragraph stands directly under the H2, saying what the subsections are. Embeds are **allowed** here, unlike in `Cel`: a subsection may embed an entity that carries a shape it reasons about — what it may not do is carry that shape itself, where the project models shapes elsewhere.

### Rules decidable on the `Domain` section text alone

Each item can be settled by reading the section, with no judgement about the subject matter, and each names the violation symptom — the thing you will actually observe when it is broken:

1. **At most one `## Domain`, and it is the third H2.** *Symptom:* `## Domain (L2)`, a suffix in the heading, or the section standing anywhere but directly after `## Zależności`.
2. **No `n/d` variant.** *Symptom:* a placeholder body under the heading, or `n/d` in the heading itself.
3. **Content only under subsection headings.** *Symptom:* more than one paragraph standing directly under the H2.
4. **No layer identifier in a subsection heading.** *Symptom:* a `###` carrying an `L\d+` token.
5. **No fences.** A fenced block here is a shape written out by hand, however short — three lines are worth rewriting too: as prose, as a list, or as an embed of the entity that carries the shape. *Symptom:* a fenced block anywhere in the section, of any length.
6. **Within the budget.** The budget is per heading, not per section: the text standing directly under one heading, its own subsections excluded, stays within 2500 characters. Past that, the heading needs subsections one level down. The section as a whole has no budget. *Symptom:* the text directly under one heading, its subsections excluded, past 2500 characters.

**Item 7 is settled against the layer table rather than against the text**, and it sits deliberately outside the six above: *does some layer's slice schema ask for this sentence?* Two readers holding the same layer table reach the same answer, but the reviewer has to read the layer files — no regex does it. The negative test that catches the usual failure: **a lifecycle step listing another module's verbs** — someone else's lifecycle written down a second time, failing question two however fluently it reads.

**The budget asks for structure; repetition is the detector, not prose hygiene.** Text past the budget is not to be shortened; it is to be divided, so each heading names one thing. What the division then shows is the signal worth watching: when the `Domain` sections of several modules carry content of the same kind in the same shape — each enumerating commands, each enumerating failure codes, each describing a file format — that is a convention shared by modules, which is a layer in the sense of the core concepts. Propose it as one, together with its `## Module slice schema`: the paragraphs leave every `Domain`, and the residual test starts answering differently. The headings exist so that this moment is visible, not to shorten prose.
