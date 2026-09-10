import { createAdapter, extractText } from '@inharness-ai/agent-adapters';
import { DEFAULT_CONTENT_OPERATION } from '@c4s/plugin-runtime';
import type { AcMountContext, HostRegistryView, ReadOps } from '../../../host-kit/host-types.js';
import { AC_TYPE } from '../../../identity.js';
import { readActiveAcs, SLUGS_PER_CALL } from './read-acs.js';

export interface AcAnalysisOptions {
  /** Limit to ACs carrying this tag slug. Omit for no tag filter. */
  scope_tag?: string;
  /** Limit to a single AC by slug. Omit to analyse all active ACs. */
  ac_slug?: string;
}

export interface AcAnalysisIssue {
  ac_slug: string;
  issue_type: string;
  details: string;
  affected_entity?: { type: string; slug: string };
  confidence: number;
  suggested_correction?: string;
}

export type AcSkippedReason =
  | 'no_verifies'
  | 'all_verifies_broken'
  | 'ac_plugin_inactive';

export interface AcSkippedEntry {
  ac_slug?: string;
  reason: AcSkippedReason;
}

export interface AcAnalysisResult {
  issues: AcAnalysisIssue[];
  analyzed_count: number;
  skipped_count: number;
  skipped_reasons: AcSkippedEntry[];
}

/**
 * 0.2.80 — what the audit needs from the mount context, and nothing wider.
 *
 * The in-core version took `reader: RawEntityReader` plus `discovery: () =>
 * DiscoveryCore`: the whole read catalogue and a door to raw projection rows.
 * An envelope gets neither. What is left is the four bound read operations, the
 * registry view, the project root, and the host-resolved turn scope.
 */
export type AcAnalysisDeps = AcMountContext;

/**
 * L2 service for the LLM-based AC semantic audit (brief 0.1.45 §1). Owns the
 * logic that used to live inline in the `ac-tools` MCP server: for each active
 * AC it loads `title` + `verifies[]` + the linked entity snapshots, builds a
 * single prompt, and calls the `claude-code` adapter. Read-only, on-demand,
 * non-deterministic.
 *
 * Distinct from the deterministic referential-integrity check (M19
 * `check_consistency` rule 9), which only asks whether a `verifies[]` ref
 * exists — never whether the AC text matches the entity shape.
 */
export class AcAnalysisService {
  /** `describe_types` is per-type and stable for a run; one call each, not one per ref. */
  private readonly contentFieldsByType = new Map<string, string[]>();

  constructor(private readonly deps: AcAnalysisDeps) {}

  async analyze(opts: AcAnalysisOptions = {}): Promise<AcAnalysisResult> {
    // Inactive guard: if the AC plugin is not active there is nothing to audit.
    // (Structurally unreachable while this service is only reachable through the
    // ac-tools MCP server, which mounts only when AC is active — kept for spec
    // fidelity and future direct callers.)
    if (this.deps.host.getEntity(AC_TYPE) === null) {
      return {
        issues: [],
        analyzed_count: 0,
        skipped_count: 0,
        skipped_reasons: [{ reason: 'ac_plugin_inactive' }],
      };
    }

    const ops: ReadOps = this.deps;
    const host: HostRegistryView = this.deps.host;
    let targets = readActiveAcs(ops);
    if (opts.ac_slug) {
      targets = targets.filter((a) => a.slug === opts.ac_slug);
    }
    if (opts.scope_tag) {
      targets = targets.filter((a) => a.tags.includes(opts.scope_tag as string));
    }

    if (targets.length === 0) {
      return { issues: [], analyzed_count: 0, skipped_count: 0, skipped_reasons: [] };
    }

    const skipped_reasons: AcSkippedEntry[] = [];
    const dossier: Array<{
      slug: string;
      title: string;
      kind: string;
      linked: Array<Record<string, unknown>>;
    }> = [];

    /**
     * Every referenced entity, read ONCE, batched by type.
     *
     * 0.2.24 established that the dossier is built from the M39 READ RECORD
     * rather than the raw projection row: `entity.data` is the projection's own
     * shape — column-ish key names, and nothing from a collection that lives in
     * its own table — so an AC verifying an endpoint was judged against a
     * payload with no `linkedDtos` in it, and the model was asked whether the
     * criterion matched a shape the criterion could not see.
     *
     * 0.2.80 keeps the record and drops the round trip per ref. The audit is a
     * BULK operation: a few hundred criteria averaging two refs each is a few
     * hundred calls, most of them for entities several ACs verify in common, and
     * every one of them re-runs `requireActiveType`/`validateSelect`/the budget
     * pass. Grouping by type and de-duplicating by key is the same information
     * in about a call per type.
     */
    const resolved = this.readReferenced(ops, host, targets);

    for (const ac of targets) {
      if (ac.verifies.length === 0) {
        skipped_reasons.push({ ac_slug: ac.slug, reason: 'no_verifies' });
        continue;
      }
      const linked = ac.verifies.map((v) => {
        // 0.2.11: "unknown type" is a question for the registry, not for a
        // seven-literal predicate — which classified every plugin type as
        // unknown and so made an AC verifying one look unverifiable.
        if (!host.getEntity(v.type)) {
          return { type: v.type, slug: v.slug, status: 'unknown-type' as const };
        }
        const data = resolved.get(`${v.type}\u0000${v.slug}`);
        if (!data) {
          return { type: v.type, slug: v.slug, status: 'missing' as const };
        }
        return { type: v.type, slug: v.slug, status: 'active' as const, data };
      });
      // An AC whose every verify is missing/unknown-type has nothing to compare
      // the text against — the broken refs are M19's concern (rule 9), not ours.
      const hasResolvable = linked.some((l) => l.status === 'active');
      if (!hasResolvable) {
        skipped_reasons.push({ ac_slug: ac.slug, reason: 'all_verifies_broken' });
        continue;
      }
      dossier.push({ slug: ac.slug, title: ac.title, kind: ac.kind, linked });
    }

    if (dossier.length === 0) {
      return {
        issues: [],
        analyzed_count: 0,
        skipped_count: skipped_reasons.length,
        skipped_reasons,
      };
    }

    const prompt = buildPrompt(dossier);
    /**
     * 0.2.8 (A19): this turn used to run with NO path scope at all. Without
     * `allowedPaths`/`disallowedPaths` the library's gate (`allowed.length ||
     * disallowed.length`) never engages, which also means
     * `permissionMode: 'bypassPermissions'` — so this turn, reachable as the MCP
     * tool `analyze_ac_against_entities` from ANY turn including a read-only
     * `ask` one, could hand-edit the C4S artifact dirs.
     *
     * 0.2.80: the scope is no longer BUILT here, it is asked for. The two
     * resolvers behind `agentScope` read the project's `config.json` and
     * `.claude/settings.json`, and this envelope must not re-derive them — an
     * envelope that drifted from the chat turn, or simply forgot the call, would
     * re-introduce exactly the regression above from outside the host. It is
     * resolved PER CALL, so config edits still hot-reload; `roots` is fixed at
     * mount, the same as the chat turn's boot-time `deps.roots`.
     *
     * `planMode: true` is passed to the resolver as well as to the turn: the
     * library unions the plan-mode preset with the groups it returns, so a
     * caller that ran plan-mode without saying so here would have the union
     * computed against the wrong baseline.
     *
     * Side effect worth knowing: requesting a path scope makes the library set
     * `settingSources: ['project','local']`, so the project's
     * `.claude/settings.json` loads into this audit turn too. That matches every
     * chat turn, and the turn is still strictly more restricted than before.
     */
    const scope = this.deps.agentScope({ planMode: true });
    const adapter = createAdapter('claude-code');
    const stream = adapter.execute({
      prompt,
      systemPrompt:
        'You output only a single JSON object on one line. No commentary, no code fences.',
      // Not the turn default (`opus-5`): the audit is a bulk one-shot classifier
      // emitting a JSON verdict, so it keeps the mid tier. The alias it used to
      // name left the catalog in 0.2.17 — this is that alias's successor, which
      // is why it is pinned here rather than deferred to the default.
      model: 'sonnet-5',
      cwd: this.deps.cwd,
      maxTurns: 1,
      // The audit reads ACs and entities through the host and returns a JSON verdict — it
      // never needs to write, so it also runs plan-mode (read-only built-in toolset).
      planMode: true,
      /**
       * Spread whole. `AgentTurnScope` is shaped to be exactly the execute
       * params it fills — the cast is on `disallowedToolGroups` alone, whose
       * member union lives in the vendor package and is deliberately declared
       * as `string[]` on the published surface so the Host API's `.d.ts` does
       * not force every plugin author to depend on the vendor's type.
       */
      ...scope,
      disallowedToolGroups: scope.disallowedToolGroups as never,
    });
    const text = await extractText(stream);
    const issues = parseIssuesJson(text);

    return {
      issues,
      analyzed_count: dossier.length,
      skipped_count: skipped_reasons.length,
      skipped_reasons,
    };
  }

  /**
   * Put the CONTENT back into a projected record, in place.
   *
   * A read record answers a content-bearing field with a descriptor —
   * `sourceHas` / `sourceBytes` / `sourceOperation` — and never with the value,
   * whether or not the caller named the field in `select`. That is right for a
   * catalog listing and wrong for this: the audit's whole question is whether an
   * AC's text matches the entity, and for a `diagram` the entity essentially IS
   * its `source`. Handing the model `{sourceHas: true, sourceBytes: 412}` asks it
   * to judge a body it was not shown — worse than the raw row this replaced.
   *
   * So the descriptor is followed to the operation it names, exactly as an
   * external caller would follow it. Only the default single-value operation is
   * resolved; a field that issues its content through a windowed collection op
   * keeps its descriptor, because there is no one value to inline.
   */
  /**
   * Read every entity the target ACs reference, batched by type.
   *
   * Keyed by `type\u0000slug` — a NUL joiner rather than a `/`, because a slug
   * pattern is a plugin's to choose and a separator that can appear in a key is
   * how two different references collapse into one.
   *
   * A type the registry does not know is skipped rather than requested: the op
   * throws `INVALID_TYPE` for it, and one unresolvable `verifies[]` entry must
   * not fail the whole audit. Those refs are classified by the caller, which is
   * where the three-way verdict lives.
   */
  private readReferenced(
    ops: ReadOps,
    host: HostRegistryView,
    targets: Array<{ verifies: Array<{ type: string; slug: string }> }>,
  ): Map<string, Record<string, unknown>> {
    const wanted = new Map<string, Set<string>>();
    for (const ac of targets) {
      for (const v of ac.verifies) {
        if (!host.getEntity(v.type)) continue;
        (wanted.get(v.type) ?? wanted.set(v.type, new Set()).get(v.type)!).add(v.slug);
      }
    }

    const out = new Map<string, Record<string, unknown>>();
    for (const [type, slugSet] of wanted) {
      const slugs = [...slugSet];
      for (let i = 0; i < slugs.length; i += SLUGS_PER_CALL) {
        let results: Array<{ slug: string; entity: unknown }>;
        try {
          results = ops.getEntities({ type, slugs: slugs.slice(i, i + SLUGS_PER_CALL) })
            .results as Array<{ slug: string; entity: unknown }>;
        } catch {
          // The type answered `getEntity` a moment ago and will not answer now —
          // a deactivation racing the audit. Its refs read as `missing`, which is
          // the same answer the per-ref call gave.
          continue;
        }
        for (const r of results) {
          if (!r.entity) continue;
          const data = { ...(r.entity as Record<string, unknown>) };
          this.attachContent(ops, type, r.slug, data);
          out.set(`${type}\u0000${r.slug}`, data);
        }
      }
    }
    return out;
  }

  private attachContent(
    ops: ReadOps,
    type: string,
    slug: string,
    data: Record<string, unknown>,
  ): void {
    let fields = this.contentFieldsByType.get(type);
    if (!fields) {
      const described = describeOrNull(ops, type);
      fields = (described?.contentFields ?? [])
        .filter((f) => f.operation === DEFAULT_CONTENT_OPERATION)
        .map((f) => f.field);
      this.contentFieldsByType.set(type, fields);
    }
    for (const field of fields) {
      if (data[`${field}Has`] === false) continue;
      try {
        data[field] = ops.getFieldContent({ type, slug, field }).content;
      } catch {
        // A field the core cannot issue leaves its descriptor standing. The
        // audit degrades to what the record already said; it does not fail.
      }
    }
  }
}

/**
 * `describeTypes` for ONE type, or `null` if it will not answer.
 *
 * It THROWS `INVALID_TYPE` where the in-core version's `host.getEntity(t)`
 * returned null — for an unregistered type and for a deactivated one alike. A
 * missed catch here would turn one `verifies[]` entry pointing at a type this
 * project does not have into a 500 for the entire audit, which is the opposite
 * of what an audit over other people's types should do.
 */
function describeOrNull(ops: ReadOps, type: string) {
  try {
    return ops.describeTypes({ types: [type] }).types[0] ?? null;
  } catch {
    return null;
  }
}

function buildPrompt(dossier: unknown): string {
  return [
    'You are a specification consistency auditor.',
    '',
    'For each Acceptance Criterion (AC) below, decide whether its `title` — which carries the criterion itself, not a label for it — is semantically consistent with the linked entities (their fields, params, shape).',
    '',
    'Return ONLY a JSON object on a single line, no prose, matching:',
    '{"issues":[{"ac_slug":string,"issue_type":string,"details":string,"affected_entity"?:{"type":string,"slug":string},"confidence":number,"suggested_correction"?:string}]}',
    '',
    'Rules:',
    '- If an AC has no issues, do not emit a row for it.',
    '- `confidence` is between 0 and 1.',
    '- `issue_type` is a short kebab-case label (e.g. "field-mismatch", "verb-mismatch", "missing-coverage", "stale-shape").',
    '- Skip ACs whose linked entities are missing or unknown-type (those are caught by check_consistency rule 9).',
    '',
    'Dossier:',
    JSON.stringify(dossier),
  ].join('\n');
}

export function parseIssuesJson(text: string): AcAnalysisIssue[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  const slice = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const rawIssues = (parsed as Record<string, unknown>).issues;
  if (!Array.isArray(rawIssues)) return [];
  const out: AcAnalysisIssue[] = [];
  for (const raw of rawIssues) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.ac_slug !== 'string' || typeof r.issue_type !== 'string') continue;
    const details = typeof r.details === 'string' ? r.details : '';
    const confidence = typeof r.confidence === 'number' ? r.confidence : 0;
    const issue: AcAnalysisIssue = {
      ac_slug: r.ac_slug,
      issue_type: r.issue_type,
      details,
      confidence,
    };
    if (r.affected_entity && typeof r.affected_entity === 'object') {
      const ae = r.affected_entity as Record<string, unknown>;
      if (typeof ae.type === 'string' && typeof ae.slug === 'string') {
        issue.affected_entity = { type: ae.type, slug: ae.slug };
      }
    }
    if (typeof r.suggested_correction === 'string') {
      issue.suggested_correction = r.suggested_correction;
    }
    out.push(issue);
  }
  return out;
}
