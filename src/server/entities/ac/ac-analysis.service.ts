import { createAdapter, extractText } from '@inharness-ai/agent-adapters';
import type { Database } from 'better-sqlite3';
import type { AcService } from './services.js';
import type { PluginHost } from '../../core/plugin-host/types.js';
import {
  RawEntityReader,
  isRawEntityType,
  type RawEntityType,
} from '../../domain/raw-entity-reader.js';

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

export interface AcAnalysisDeps {
  acService: AcService;
  db: Database;
  cwd: string;
  host: PluginHost;
}

/**
 * L2 service for the LLM-based AC semantic audit (brief 0.1.45 §1). Owns the
 * logic that used to live inline in the `ac-tools` MCP server: for each active
 * AC it loads `text` + `verifies[]` + the linked entity snapshots, builds a
 * single prompt, and calls the `claude-code` adapter. Read-only, on-demand,
 * non-deterministic.
 *
 * Distinct from the deterministic referential-integrity check (M19
 * `check_consistency` rule 9), which only asks whether a `verifies[]` ref
 * exists — never whether the AC text matches the entity shape.
 */
export class AcAnalysisService {
  constructor(private readonly deps: AcAnalysisDeps) {}

  async analyze(opts: AcAnalysisOptions = {}): Promise<AcAnalysisResult> {
    // Inactive guard: if the AC plugin is not active there is nothing to audit.
    // (Structurally unreachable while this service is only reachable through the
    // ac-tools MCP server, which mounts only when AC is active — kept for spec
    // fidelity and future direct callers.)
    if (this.deps.host.getEntity('ac') === null) {
      return {
        issues: [],
        analyzed_count: 0,
        skipped_count: 0,
        skipped_reasons: [{ reason: 'ac_plugin_inactive' }],
      };
    }

    const allActive = this.deps.acService.list({ status: 'active' });
    let targets = allActive;
    if (opts.ac_slug) {
      targets = targets.filter((a) => a.slug === opts.ac_slug);
    }
    if (opts.scope_tag) {
      targets = targets.filter((a) => a.tags.includes(opts.scope_tag as string));
    }

    if (targets.length === 0) {
      return { issues: [], analyzed_count: 0, skipped_count: 0, skipped_reasons: [] };
    }

    const reader = new RawEntityReader(this.deps.db);
    const skipped_reasons: AcSkippedEntry[] = [];
    const dossier: Array<{
      slug: string;
      text: string;
      kind: string;
      linked: Array<Record<string, unknown>>;
    }> = [];

    for (const ac of targets) {
      if (ac.verifies.length === 0) {
        skipped_reasons.push({ ac_slug: ac.slug, reason: 'no_verifies' });
        continue;
      }
      const linked = ac.verifies.map((v) => {
        if (!isRawEntityType(v.type)) {
          return { type: v.type, slug: v.slug, status: 'unknown-type' as const };
        }
        const entity = reader.getEntity(v.type as RawEntityType, v.slug);
        if (!entity) {
          return { type: v.type, slug: v.slug, status: 'missing' as const };
        }
        return { type: v.type, slug: v.slug, status: 'active' as const, data: entity.data };
      });
      // An AC whose every verify is missing/unknown-type has nothing to compare
      // the text against — the broken refs are M19's concern (rule 9), not ours.
      const hasResolvable = linked.some((l) => l.status === 'active');
      if (!hasResolvable) {
        skipped_reasons.push({ ac_slug: ac.slug, reason: 'all_verifies_broken' });
        continue;
      }
      dossier.push({ slug: ac.slug, text: ac.text, kind: ac.kind, linked });
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
    const adapter = createAdapter('claude-code');
    const stream = adapter.execute({
      prompt,
      systemPrompt:
        'You output only a single JSON object on one line. No commentary, no code fences.',
      model: 'sonnet-4.6',
      cwd: this.deps.cwd,
      maxTurns: 1,
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
}

function buildPrompt(dossier: unknown): string {
  return [
    'You are a specification consistency auditor.',
    '',
    'For each Acceptance Criterion (AC) below, decide whether its `text` is semantically consistent with the linked entities (their fields, params, shape).',
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
