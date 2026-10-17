/**
 * `audit_ui_kit_components` — the rules the schema cannot express
 * (c4s-plugin-host-ui-kit-components `6o1rfh21`). Pure: it reads records and
 * reports violations, it never writes, so the same state gives the same answer.
 *
 * React-free and host-free so that it can be tested on plain records; the MCP
 * server (`mcp.ts`) feeds it from the bound read operations.
 */

import { DomainError } from '@c4s/plugin-runtime';

export const AUDIT_RULES = [
  'fetched-by-presentational',
  'connected-without-fetch',
  'duplicate-sole-anatomy',
  'duplicate-type-definition',
] as const;
export type AuditRule = (typeof AUDIT_RULES)[number];

/** What the audit reads off a record. */
export interface AuditRecord {
  slug: string;
  binding?: unknown;
  dataSources?: unknown;
  soleAnatomyOf?: unknown;
  types?: unknown;
}

export interface AuditViolation {
  rule: AuditRule;
  slugs: string[];
  message: string;
}

export interface AuditResult {
  checked: number;
  violations: AuditViolation[];
}

export interface AuditInput {
  slugs?: string[];
  rules?: string[];
}

const usages = (r: AuditRecord): string[] =>
  Array.isArray(r.dataSources)
    ? r.dataSources.map((d) => (d as { usage?: unknown }).usage).filter((u): u is string => typeof u === 'string')
    : [];

const typeNames = (r: AuditRecord): string[] =>
  Array.isArray(r.types)
    ? [...new Set(r.types.map((t) => (t as { name?: unknown }).name).filter((n): n is string => typeof n === 'string'))]
    : [];

/**
 * Run the audit over `all` (every record of the type).
 *
 * `slugs` narrows the checked records; cross-record rules compare the named
 * records against ALL records of the type. `rules` narrows the rules. An
 * unknown slug or rule refuses the whole call — no partial result.
 */
export function auditUiKitComponents(all: readonly AuditRecord[], input: AuditInput = {}): AuditResult {
  const known = new Set(all.map((r) => r.slug));
  if (input.slugs) {
    const missing = input.slugs.filter((s) => !known.has(s));
    if (missing.length > 0) {
      throw new DomainError('NOT_FOUND', `no ui-kit-component record for slug(s): ${missing.join(', ')}`);
    }
  }
  if (input.rules) {
    const unknown = input.rules.filter((r) => !(AUDIT_RULES as readonly string[]).includes(r));
    if (unknown.length > 0) {
      throw new DomainError(
        'VALIDATION',
        `unknown audit rule(s): ${unknown.join(', ')} — available: ${AUDIT_RULES.join(', ')}`,
      );
    }
  }

  const rules = new Set<AuditRule>((input.rules as AuditRule[] | undefined) ?? AUDIT_RULES);
  const scope = input.slugs ? new Set(input.slugs) : known;
  const checked = all.filter((r) => scope.has(r.slug));
  const violations: AuditViolation[] = [];

  for (const r of checked) {
    if (rules.has('fetched-by-presentational') && r.binding === 'presentational' && usages(r).includes('fetchedByComponent')) {
      violations.push({
        rule: 'fetched-by-presentational',
        slugs: [r.slug],
        message: `'${r.slug}' is presentational but has a dataSources entry with usage fetchedByComponent.`,
      });
    }
    if (rules.has('connected-without-fetch') && r.binding === 'connected' && !usages(r).includes('fetchedByComponent')) {
      violations.push({
        rule: 'connected-without-fetch',
        slugs: [r.slug],
        message: `'${r.slug}' is connected but names no consumed L11 surface (no dataSources entry with usage fetchedByComponent).`,
      });
    }
  }

  /** Cross-record: group ALL records by a key, report every group of 2+ touching the checked scope. */
  const duplicates = (rule: AuditRule, keysOf: (r: AuditRecord) => string[], describe: (key: string, slugs: string[]) => string) => {
    const byKey = new Map<string, string[]>();
    for (const r of all) {
      for (const key of keysOf(r)) byKey.set(key, [...(byKey.get(key) ?? []), r.slug]);
    }
    for (const [key, slugs] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (slugs.length < 2 || !slugs.some((s) => scope.has(s))) continue;
      const sorted = [...slugs].sort();
      violations.push({ rule, slugs: sorted, message: describe(key, sorted) });
    }
  };

  if (rules.has('duplicate-sole-anatomy')) {
    duplicates(
      'duplicate-sole-anatomy',
      (r) => (typeof r.soleAnatomyOf === 'string' && r.soleAnatomyOf !== '' ? [r.soleAnatomyOf] : []),
      (key, slugs) => `Anatomy pattern '${key}' is declared as sole anatomy by ${slugs.length} records: ${slugs.join(', ')}.`,
    );
  }
  if (rules.has('duplicate-type-definition')) {
    duplicates(
      'duplicate-type-definition',
      typeNames,
      (key, slugs) => `Type '${key}' is defined in the types of ${slugs.length} records: ${slugs.join(', ')}.`,
    );
  }

  return { checked: checked.length, violations };
}
