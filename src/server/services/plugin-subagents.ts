/* ─────────────────── M05/M33: policy for plugin-contributed subagents ───────────────────
 * A plugin may contribute programmatic subagents through `contributes.subagents[]`. The
 * raw contributions ride the plugin record and the project-local overlay untouched (see
 * `ProjectPluginHost.listSubagents()`); EVERYTHING that turns them into something safe to
 * hand the runtime lives here, and is applied per turn by `subagentsFor()`.
 *
 * Why the guards are heavier than the ones the internal-skill resolver needs: the shape is
 * borrowed from `resolveForContext` — a union of a hardcoded source and a plugin fan-out,
 * resolved per turn by a pull consumer — but the PRICE OF A HIT differs. A place in the
 * skill listing costs a line of prompt; a delegation to a subagent costs a WHOLE TURN with
 * its own model, and the routing that picks it reads plugin-supplied `description` prose
 * that cannot be switched off.
 *
 * This module deliberately does NOT import the skill registry: `skill-registry.ts` imports
 * `CONTEXT_TYPE_REGISTRY` from `chat-context.ts`, so a dependency the other way would close
 * a cycle. Slug existence arrives as the injected `hasSkillSlug` predicate instead, supplied
 * at the one call site that already holds the registry.
 */

import type { SubagentDefinition } from '@inharness-ai/agent-adapters';
import type { ChatContextType } from '../../shared/entities.js';
import type { PluginSubagentContribution } from '../../shared/plugin-host/manifest.js';

/** Names owned by the host. A contribution claiming one is dropped, in EITHER layer —
 *  base pool or project-local overlay. This is the single asymmetry that survives between
 *  the two layers; everything else about them is equal. */
export const RESERVED_SUBAGENT_NAMES: ReadonlySet<string> = new Set(['spec-explore', 'diff-explore']);

/**
 * Round-trip CEILING — a loop-cutter, not a work budget.
 *
 * Set at 3× the highest budget any contribution in this project declares, so that a
 * declaration equal to the highest real need is not clamped by a number chosen to catch
 * runaways. A contribution PROPOSES `maxTurns`; the host clamps rather than rejecting,
 * because a number too large is a misjudgement, not a permission escalation. A value equal
 * to exactly this ceiling passes through untouched.
 *
 * `maxTurns` counts ROUND-TRIPS, not time. At this ceiling the binding limit on a long
 * review is therefore the run's WALL-CLOCK TIMEOUT — inherited from the parent run, there
 * being no per-subagent timeout — rather than the turn counter. Both exhaustions look the
 * same from the caller's side: silence. Both are covered by the same duty on the subagent
 * to report INCREMENTALLY rather than holding a verdict to the end.
 */
export const MAX_SUBAGENT_TURNS = 120;

/**
 * The budget a contribution that declares nothing is given. OMISSION IS LEGAL — an
 * envelope saying nothing about `maxTurns` is declaring "I have no opinion", not shipping a
 * packaging defect, so it draws no warning and no diagnostic entry.
 *
 * Sized for the two classes of work that legitimately have no opinion: exploratory runs,
 * which settle in a dozen-odd round-trips and leave this with room to spare; and reviewing
 * runs, whose read volume scales with the SIZE OF THE CHANGE rather than the difficulty of
 * the question — which is why a reviewer is expected to declare its own number explicitly
 * instead of leaning on this one.
 */
export const DEFAULT_SUBAGENT_TURNS = 40;

/** Closed enum. `model` reaches the SDK verbatim, BYPASSING the model catalogue, so an
 *  alias the catalogue knows but the SDK does not is forwarded unchanged and rejected
 *  mid-turn. An arbitrary literal is therefore a turn-failure vector, which is why an
 *  out-of-enum value rejects the entry at fan-out instead of being coerced. */
export const ALLOWED_SUBAGENT_MODELS: ReadonlySet<string> = new Set(['sonnet', 'haiku']);

/** Closed enum, for the same reason as `model` above and enforced the same way: `effort` is
 *  forwarded to the SDK verbatim by the adapter (`...a.effort ? { effort: a.effort } : {}`),
 *  the manifest is plain JSON so the TypeScript union buys nothing at the plugin boundary,
 *  and an out-of-enum literal fails the turn from the inside. */
export const ALLOWED_SUBAGENT_EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

/**
 * Primitives no subagent may hold — host-built or contributed. A closed list, NOT a
 * read/write taxonomy.
 *
 * `mcp__transagent-tools__runTransagent` is spelled out rather than imported from
 * `../mcp/transagent-tools.js`: that module pulls in zod, the plugin runtime and the
 * dispatcher for the sake of one string. `plugin-subagents.test.ts` imports both and
 * asserts they agree, which is the drift guard without the runtime edge.
 *
 * `Skill` is banned because its job is already done by `mcp__skill-tools__load_skill_file`,
 * which both built-ins now carry — so the ban describes the state of things rather than an
 * intention. `Agent`/`Task` are banned because the library's deny-group propagation does
 * not reach the agentic family (the groups are four, all built-in-file/shell/web), so
 * without this line a contributed subagent could nest.
 */
export const NON_DELEGABLE_TOOLS: readonly string[] = [
  'Agent',
  'Task',
  'Skill',
  'mcp__transagent-tools__runTransagent',
];

export type SubagentWarn = (message: string) => void;

/* `subagentsFor()` runs on EVERY turn, so a warning emitted straight to the console would
 * re-fire for the life of the process on a contribution nobody is going to fix today. Keyed
 * by message so each distinct problem is still said once. */
const warnedOnce = new Set<string>();
const defaultWarn: SubagentWarn = (message) => {
  if (warnedOnce.has(message)) return;
  warnedOnce.add(message);
  console.warn(message);
};

/** Test-only: drop the once-per-process warning memo. */
export function __resetSubagentWarnings(): void {
  warnedOnce.clear();
}

/**
 * Is this a MUTATING MCP tool, by the VERBS appearing anywhere in its TOOL segment?
 *
 * A BLACKLIST on mutating prefixes — deliberately not a `get_`/`list_` whitelist, and the
 * distinction is not cosmetic. This sanitizer runs over EVERY definition including the two
 * built-ins, and a whitelist would strip `release_diff`, `search_pages`, `get_sections`'s
 * siblings `find_references` and `check_consistency`, `describe_entity_type` and
 * `load_skill_file` — every one of which an explorer depends on to do its job. The
 * `/^(get|list)_/` filter in `entityReadMcpTools` is a different job: DISCOVERY over an
 * open-ended set nobody has enumerated, where a false negative merely omits a tool.
 *
 * The split takes `slice(2).join('__')` so a tool whose own name contains `__` survives,
 * and it tests the tool segment rather than the whole string so a SERVER called
 * `link-tools` does not make its read tools look mutating.
 *
 * The verb may sit in ANY `_`-separated position, not just the first. A prefix-only test
 * reads well and catches almost nothing this repo actually ships: `release_create`,
 * `release_update`, `tag_entity`, `untag_entity`, `mark_plan_applied`, `file_patch` and
 * `update_brief` all name the noun first or the verb second, and every one of them writes.
 * A subagent granted one of those would be told by `hostFrame()` that it cannot mutate
 * while holding a tool that does — the frame lying to the model being strictly worse than
 * no frame. Matching per segment keeps the read surface intact: no segment of
 * `check_consistency`, `describe_entity_type`, `find_references`, `resolve_identity`,
 * `search_pages`, `release_diff`, `release_show`, `overview` or `load_skill_file` is a verb
 * on this list.
 */
const MUTATING_VERBS = new Set([
  'create', 'update', 'delete', 'link', 'unlink', 'remove', 'add', 'set', 'write',
  'apply', 'applied', 'mark', 'tag', 'untag', 'patch', 'move', 'rename', 'archive',
]);

export function isMutatingMcpTool(tool: string): boolean {
  if (!tool.startsWith('mcp__')) return false;
  const parts = tool.split('__');
  if (parts.length < 3) return false;
  const toolSegment = parts.slice(2).join('__');
  return toolSegment.split('_').some((segment) => MUTATING_VERBS.has(segment));
}

/**
 * Strip everything a subagent must not hold from ONE definition. Applied to the built-ins
 * too, which is the point: the rules "no `Skill`" and "no `runTransagent` in
 * `SubagentDefinition.tools`" used to be upheld by code review, and are now upheld by code.
 *
 * NEVER THROWS. A removed or unrecognised entry is dropped with a warning and the turn
 * starts without that tool; the alternative — failing the run — would let a plugin's typo
 * take down a turn it has no business affecting.
 */
export function sanitizeSubagentDefinition(
  def: SubagentDefinition,
  warn: SubagentWarn = defaultWarn,
): SubagentDefinition {
  if (!def.tools) return def;
  const kept: string[] = [];
  for (const tool of def.tools) {
    // The manifest is plain JSON, so `tools: [null]` type-checks nowhere and arrives here
    // intact. `isMutatingMcpTool(null)` would throw out of `subagentsFor()` and take the
    // whole turn with it — the one outcome this module promises never to cause.
    if (typeof tool !== 'string' || tool.trim() === '') {
      warn(`[subagents] "${def.name}": dropping a non-string entry from its toolset`);
      continue;
    }
    if (NON_DELEGABLE_TOOLS.includes(tool)) {
      warn(`[subagents] "${def.name}": dropping non-delegable tool "${tool}" from its toolset`);
      continue;
    }
    if (isMutatingMcpTool(tool)) {
      warn(`[subagents] "${def.name}": dropping mutating MCP tool "${tool}" — subagents report, they do not write`);
      continue;
    }
    kept.push(tool);
  }
  return { ...def, tools: kept };
}

/**
 * The turn budget, stated to the subagent as a number.
 *
 * A prompt may oblige a subagent to "stop reading and report before the budget runs out";
 * without the number that is an obligation imposed without the information needed to meet
 * it. So the host states it — once per definition, for EVERY definition in a run, the two
 * built-in explorers included.
 *
 * Detecting exhaustion itself stays where it was: with the incremental-reporting duty
 * below, the model's own count of its round-trips, and the run's wall-clock timeout.
 */
export function turnBudgetSection(turns: number): string {
  return `Your turn budget for this run: ${turns} round-trips.

- That number is EFFECTIVE, not proposed. It is what the host settled on after clamping or
  defaulting whatever your definition asked for, so it is the number you actually have.
- It is a CONSTANT, not a countdown. This prompt is composed once, at dispatch, and there is
  no channel to update it mid-run: you see the same number on your first turn and on your
  Nth. Counting your own round-trips against it is your job.
- A run cut off by exhaustion returns NOTHING to the parent — not a partial report, not an
  error, silence. So report INCREMENTALLY: surface the first finding while budget remains
  rather than holding a verdict to the end, because a verdict held to the end is lost whole.`;
}

/**
 * Give a definition the host's turn budget: set `maxTurns` to it and tell the model.
 *
 * Used for the BUILT-INS, which never pass through `hostFrame()` — a contributed definition
 * gets the same section inside the frame instead. Setting the field is not decoration, and
 * the reason is the opposite of the obvious one: nothing downstream supplies a budget of its
 * own. `agent-adapters` forwards `maxTurns` only when it is non-null and the SDK's
 * `AgentDefinition` has no default, so a definition that omits the field runs UNBOUNDED. The
 * frame would then state a ceiling the run does not actually have — a promise in the wrong
 * direction, but still the host telling the model something untrue.
 *
 * That also means this is where the built-ins ACQUIRE a bound they did not have before
 * 0.2.68. The trade is deliberate: a stated budget the model can ration against is worth
 * more than an unbounded run whose only real limit is the wall clock.
 */
export function withTurnBudget(def: SubagentDefinition, turns: number): SubagentDefinition {
  return { ...def, maxTurns: turns, prompt: `${def.prompt}\n\n${turnBudgetSection(turns)}` };
}

/**
 * The host's prompt frame. `SubagentDefinition.prompt` REPLACES the parent's system prompt
 * rather than extending it, so a subagent sees none of the blocks the host injects into the
 * parent — not the spec language, not the active writing style, not the entity/anchor
 * conventions. Everything a contributed subagent must not be free to omit therefore has to
 * be re-stated here, ahead of the plugin's own body.
 *
 * This duplicates what the tool sanitizer already enforces, on purpose and in two layers:
 * the prompt is the layer the model actually reads. Structurally it is the host's answer to
 * the transagent's `interactionRules`, and a plugin can neither skip nor rewrite it.
 *
 * 0.2.57 — the truncation protocol joined it, and the reason is the division of labour this
 * whole frame rests on: how to react to `truncated: true` is a property of the READ CHANNEL,
 * not of anyone's writing style. A plugin author contributes ORIENTATION — what the material
 * is and how it is organised — and should not have to rediscover, or worse re-invent, the
 * budget behaviour of tools the host owns. The host states the mechanics once per definition;
 * the body below states the orientation.
 *
 * The built-in explorers keep their own copy of the same protocol: they do not pass through
 * this frame at all (only `sanitizeSubagentDefinition` touches them), so the duplication is
 * two audiences rather than one rule written twice. The TURN BUDGET is the exception — it
 * reaches them too, through `withTurnBudget()` below, because the number has to be true for
 * every definition in the run and a built-in has no body of its own to state it in.
 */
export function hostFrame(contextType: ChatContextType, turnBudget: number): string {
  return `You are a read-only explorer subagent working on behalf of a parent agent inside a claude4spec specification project (context: ${contextType}).

The specification is written in its own language — follow the language of the material you read, and report in it.

Hard rules, set by the host and not negotiable by the plugin that defined you:
- NEVER mutate anything. You report; you never write. No create/update/delete/link operation is available to you, and you must not ask the parent to perform one on your behalf as a way around this.
- Report POINTERS, not dumps: file paths, section anchors and entity slugs, plus the few facts the parent must inline. You exist to keep the parent's context small — returning the bulk you read defeats the only reason you were spawned.
- You may not spawn another agent or delegate further (no Agent/Task), and you may not call runTransagent. Delegation is the parent's decision, not yours.
- You may not use the native Skill tool. When you need a skill's body, read it through \`mcp__skill-tools__load_skill_file\` — the same channel the parent uses.
- Stay inside the entry point you were given. Do not reach for the primitives of another interaction context.

Truncation protocol — how the read channels tell you they could not fit everything:
- An item that came back with \`truncated: true\` is INCOMPLETE, and only that marker distinguishes "did not fit" from "there is nothing there". Never report a truncated result as if it were whole.
- Such an item usually carries \`edges\` instead of a body — the outgoing references of the whole item, including the part you did not receive. Read them: they are the map to what you are missing.
- One case keeps a partial body: a single item too large for the entire budget comes back clipped, with the prose it did fit. Keep that prefix and use it; re-fetching returns the same bytes.
- Do NOT repeat the same call. The budget is spent in input order, deterministically, so it will be cut at exactly the same place. Narrow instead — fewer items, or the few addresses from \`edges\` that actually lead where the parent asked.
- An item with no \`edges\` was not truncated. Its references are in the content you already hold.

${turnBudgetSection(turnBudget)}

Your specific assignment follows.`;
}

export interface ResolveSubagentsOptions {
  contextType: ChatContextType;
  /** Raw contributions in DISCOVERY ORDER — base pool first, then project-local overlay. */
  contributions: readonly PluginSubagentContribution[];
  /** Does this slug exist in the internal skill registry? Injected to avoid an import cycle. */
  hasSkillSlug: (slug: string) => boolean;
  /** Names already claimed by host built-ins for this turn. */
  taken: ReadonlySet<string>;
  warn?: SubagentWarn;
}

/**
 * Validate, dedupe, frame and sanitize the plugin fan-out for ONE turn.
 *
 * Rejection is PER ENTRY and never takes down the package or the turn. That matters more
 * than it looks: the library's `validateSubagents` requires names to be unique within a
 * single call and throws BEFORE the run starts, so one duplicate escaping this function
 * would kill the whole turn rather than just its own contribution. Hence dedupe happens
 * here, ahead of dispatch, and NO PATH IN THIS FUNCTION THROWS.
 */
export function resolvePluginSubagents(opts: ResolveSubagentsOptions): SubagentDefinition[] {
  const { contextType, contributions, hasSkillSlug, taken, warn = defaultWarn } = opts;
  const out: SubagentDefinition[] = [];
  const seen = new Set<string>();

  for (const c of contributions) {
    if (!c || typeof c !== 'object') continue;
    const { name, description, promptBody } = c;
    if (
      typeof name !== 'string' || name.trim() === '' ||
      typeof description !== 'string' || description.trim() === '' ||
      typeof promptBody !== 'string' || promptBody.trim() === '' ||
      !Array.isArray(c.tools)
    ) {
      warn(`[subagents] skipping a malformed contribution${typeof name === 'string' ? ` ("${name}")` : ''}: name, description, promptBody and tools[] are all required`);
      continue;
    }

    // The SELECTOR, not an error: omission means ['chat'], never "everywhere". A malformed
    // value is neither — `.includes` on a non-array throws, so it is rejected loudly rather
    // than silently widened to every context.
    if (c.contextTypes !== undefined && !Array.isArray(c.contextTypes)) {
      warn(`[subagents] subagent "${name}" declares a non-array contextTypes; skipping this contribution`);
      continue;
    }
    const contextTypes = c.contextTypes ?? ['chat'];
    if (!contextTypes.includes(contextType)) continue;

    if (RESERVED_SUBAGENT_NAMES.has(name) || taken.has(name)) {
      warn(`[subagents] plugin subagent "${name}" collides with a built-in name; the host's own definition wins and this contribution is skipped`);
      continue;
    }
    if (seen.has(name)) {
      warn(`[subagents] subagent name "${name}" is contributed more than once; keeping the first by discovery order and skipping this one`);
      continue;
    }

    // Rejected, not coerced: the value would reach the SDK verbatim and fail the turn from
    // the inside, which is strictly worse than never registering the entry.
    if (c.model !== undefined && !ALLOWED_SUBAGENT_MODELS.has(c.model)) {
      warn(`[subagents] subagent "${name}" declares model "${c.model}", which is outside the allowed set (${[...ALLOWED_SUBAGENT_MODELS].join(', ')}); skipping this contribution`);
      continue;
    }
    if (c.effort !== undefined && !ALLOWED_SUBAGENT_EFFORTS.has(c.effort)) {
      warn(`[subagents] subagent "${name}" declares effort "${c.effort}", which is outside the allowed set (${[...ALLOWED_SUBAGENT_EFFORTS].join(', ')}); skipping this contribution`);
      continue;
    }

    // An unknown slug costs the slug, not the entry.
    let skills: string[] | undefined;
    if (Array.isArray(c.attachInternalSkills) && c.attachInternalSkills.length > 0) {
      skills = c.attachInternalSkills.filter((slug) => {
        if (typeof slug !== 'string' || slug.trim() === '') return false;
        if (hasSkillSlug(slug)) return true;
        warn(`[subagents] subagent "${name}" attaches unknown internal skill "${slug}"; dropping the slug and registering the rest`);
        return false;
      });
      if (skills.length === 0) skills = undefined;
    }

    // Always resolves to a number, and the two ways of getting there are not the same event.
    // ABSENCE is a legal declaration ("no opinion"): it takes the host default silently, with
    // no warning and no diagnostic entry. A field that is PRESENT but unusable — a string, a
    // zero, a negative, a NaN — is a packaging defect like any other malformed field in this
    // resolver, so it warns and then takes the same default. A proposal above the ceiling is
    // CLAMPED, never rejected. The value below is the EFFECTIVE one, and it is what the frame
    // states to the model.
    let maxTurns = DEFAULT_SUBAGENT_TURNS;
    if (c.maxTurns !== undefined) {
      if (typeof c.maxTurns === 'number' && Number.isInteger(c.maxTurns) && c.maxTurns > 0) {
        maxTurns = Math.min(c.maxTurns, MAX_SUBAGENT_TURNS);
      } else {
        warn(
          `[subagents] subagent "${name}" declares an unusable maxTurns (${JSON.stringify(c.maxTurns)}); using the host default of ${DEFAULT_SUBAGENT_TURNS}`,
        );
      }
    }

    seen.add(name);
    out.push(
      sanitizeSubagentDefinition(
        {
          name,
          description,
          prompt: `${hostFrame(contextType, maxTurns)}\n\n${promptBody}`,
          tools: c.tools,
          ...(c.model ? { model: c.model } : {}),
          ...(c.effort ? { effort: c.effort } : {}),
          ...(skills ? { skills } : {}),
          maxTurns,
        },
        warn,
      ),
    );
  }

  return out;
}
