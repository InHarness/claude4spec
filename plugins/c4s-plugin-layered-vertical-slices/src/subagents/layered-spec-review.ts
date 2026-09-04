import type { PluginSubagentContribution } from '@c4s/plugin-runtime';

/**
 * The style's own reviewer — the second half of the authorial capability.
 *
 * The explorer LOCATES; this one JUDGES. That asymmetry is the whole reason it
 * exists: until now the author of a change was also its only reader, and a
 * writing style whose rules nobody re-reads against the saved text is a style
 * only in the moment of writing.
 *
 * The pair is HETEROGENEOUS, which makes it a different routing problem from the
 * host's own `spec-explore`/`diff-explore`. Those two do the same job in two
 * contexts and are separated by `contextTypes`; these two do different jobs in
 * the SAME turn, so nothing separates them but their `description` fields. The
 * explorer's says where; this one's says whether. Overlap the two and the model
 * picks between them at random.
 *
 * `promptBody` deliberately carries NO style rules. The rules live in `SKILL.md`,
 * this envelope publishes that file, and the reviewer reads it through
 * `load_skill_file` at the moment it judges. Copying them here would produce a
 * second copy that drifts from the first — and the reviewer would then enforce a
 * style the project no longer writes in, which is worse than no reviewer.
 *
 * `contextTypes: ['chat']` is written out although it is the default. It is a
 * claim, not a formality: the only thing that calls this subagent is a closing
 * step in `workflows/daily.md`, and that workflow is the `chat` one. Covering
 * `patch` would take a twin step in `workflows/patch.md`, which this does not
 * add.
 *
 * Nothing gates it on the style being ACTIVE — contributions are filtered on
 * `contextTypes` and name, never on `config.writingStyle`. In a project written
 * some other way it is mounted and never called, because its one trigger lives
 * inside this style's own workflow. That is a correct state, not dead code.
 */
export const layeredSpecReview: PluginSubagentContribution = {
  name: 'spec-review',
  description:
    'Reviewer of a change JUST SAVED to a specification organised as LAYERED VERTICAL SLICES. It does not search for things — it judges written text: delegate to it after an edit to have the saved change confronted with the rules of the style itself (layer purity, module-slice schemas, addressing, retirement over deletion) and to get back the DEVIATIONS, each with the address it occurs at and what the rule requires instead. Use it when the question is whether a change conforms, never when the question is where something lives — an explorer answers that one. Do NOT use it if this specification is not organised as `MXX-slug` modules with `LY-slug` layers: it would be measuring the text against rules it does not follow.',
  promptBody: `You are reviewing a change that has ALREADY been saved to a specification written in the LAYERED VERTICAL SLICES style. You judge; you do not fix, and you do not decide what happens next.

## Get the rules before you use them

The rules are NOT in this prompt, on purpose: they live in the style package and they move. Open them at the start of every review with \`load_skill_file\` — \`SKILL.md\` for the conventions you judge against, and the \`workflows/\` or \`templates/\` file for the genre at hand when a rule's application is not obvious from \`SKILL.md\` alone. A rule you recall rather than read is a rule you may be enforcing in a version the project has moved past.

## Get the change

Your delegation names the SCOPE — the addresses just edited. That scope, not the diff, is what you review.

Fetch the diff to see what those edits did: \`release_diff\` with \`toIdOrName: "current"\` and the newest release as \`fromIdOrName\` (\`release_list\` names it). That \`after\` side is live, so read it once and judge what you read — a second call after further edits is a different change.

Releases are cut by hand and rarely, so that delta is almost never one edit: it holds everything saved since the last one. Intersect it with the scope you were handed and judge the intersection. What the delta shows OUTSIDE the scope was saved by an earlier turn and is not this change — it is pre-existing, and the rule below applies to it. If you were handed no scope at all, say so and review the whole delta, but open with the fact that you could not tell this change from its predecessors.

Then read the surrounding text. A diff shows what moved; most rules in this style are about what a page now IS — whether a layer section stayed inside its module, whether a module still lists every layer it touches, whether an address resolves. Pull the affected pages and sections and judge them whole.

## Report deviations

Per deviation, three things and nothing else: the ADDRESS it sits at (\`MXX-slug/LY-slug\`, page path plus anchor), the RULE it breaks in the words of \`SKILL.md\`, and WHAT THE TEXT WOULD HAVE TO SAY instead. Order them by how much a later reader is misled. Say plainly when a change conforms — one line, no ceremony.

Judge the change, not the specification: a rule broken by text this change did not touch is pre-existing and belongs at the end, marked as such, if it belongs in the report at all.

## Three reports that are NOT "no deviations found"

Say which of these you are giving whenever one applies. Each is a statement about your INPUT, and collapsing any of them into a clean bill of health tells the author their work was checked when it was not:

- **No input.** The project has no release at all, so \`release_diff\` has no left-hand side and there is nothing to compare against. Report that you could not review, and why. Never report it as a clean result.
- **Empty delta.** There is a release and the delta against the current state is empty: nothing changed. Say exactly that — not "no deviations", which claims you weighed something.
- **Partial review.** The delta did not fit and you came down the degradation ladder — narrower \`entityTypes\`, then a smaller window, then \`summaryOnly: true\`. Then you judged a SUBSET, and you must open the report with what you did not look at. If you got all the way down to the identity map you judged almost nothing: say so first, and let the author choose a narrower scope. A quiet partial review is worse than no review.

  Your turn budget ends the same way. When it is nearly spent, stop reading and report what you judged as a partial review, naming the pages you never opened.

## Report INCREMENTALLY — a verdict held to the end is lost whole

The host tells you your turn budget as a number, and running out of it does not cut your report short: it returns NOTHING. There is no partial answer, no error, no trace — the caller gets silence, which is the one outcome none of the shapes above covers and the one it cannot tell apart from a clean review.

So do not accumulate. Surface the FIRST deviation as soon as you have judged it, while budget remains, and keep adding as you go, rather than reading everything and composing a verdict at the end. A finding stated early survives exhaustion; the same finding held for the closing paragraph does not survive at all.

The same applies when you are running short: stop reading, say what you judged and what you never opened. A partial review that arrives beats a complete one that does not.`,
  /**
   * The style's change-and-review workflow is the `chat` one, and it is the only
   * caller.
   */
  contextTypes: ['chat'],
  /**
   * A SELECTION over the host's delegable set, not a grant. Page/section reads to
   * judge the text as it now stands, `load_skill_file` for the rules it judges by,
   * and the read-only third of `release-tools` for the change itself. Every one of
   * these is already mounted in a `chat` turn, so the contribution widens nothing.
   */
  tools: [
    'mcp__reference-tools__list_pages',
    'mcp__reference-tools__search_pages',
    'mcp__reference-tools__get_page_outline',
    'mcp__reference-tools__get_sections',
    'mcp__reference-tools__get_page',
    'mcp__skill-tools__load_skill_file',
    'mcp__release-tools__release_diff',
    'mcp__release-tools__release_list',
    'mcp__release-tools__release_show',
  ],
  /** The rules it judges by, published by this same envelope. */
  attachInternalSkills: ['layered-vertical-slices'],
  model: 'sonnet',
  effort: 'medium',
  /**
   * Forty, and the argument is MEASURED rather than formal.
   *
   * A review spanning 23 sections across 8 files and 2 roots cost 29 tool calls and was
   * cut off at turn 15, before it had reached a verdict — so 15 is an observed lower bound
   * on insufficiency, not an estimate. Finishing the diff read at that volume takes on the
   * order of another 15-20 round-trips, plus turns spent reporting incrementally; 40 leaves
   * margin for a delta larger than the one measured.
   *
   * Declared EXPLICITLY even though it currently equals the host's default. The equality is
   * a coincidence and the two numbers will drift apart: the default is sized for
   * contributions that have no opinion, and this one is a measurement. More to the point,
   * this is the one contribution whose exhaustion reaches the caller as EMPTINESS rather
   * than as a report, so it has to be cut for the worst case — and leaning silently on a
   * default would be the wrong kind of silence here.
   */
  maxTurns: 40,
};
