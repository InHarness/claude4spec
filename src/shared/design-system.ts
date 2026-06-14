/**
 * Pure, deterministic design-system token logic shared by the server (L2 service
 * + L9 serializer) and the client (L5 live preview). No DB / no I/O — the single
 * implementation of `resolve()` and `lintTokens()` referenced by the brief.
 */

import {
  COMPOSITE_TOKEN_TYPES,
  UNRESOLVED_TOKEN,
  type DesignMode,
  type DesignSystem,
  type DesignSystemListItem,
  type DesignToken,
  type ResolvedTokenValue,
  type TokenGroup,
  type TokenValue,
} from './entities.js';

// ─── parsing (tolerant of raw JSON strings or already-parsed arrays) ─────────

function coerceArray(raw: string | unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseValue(value: unknown): TokenValue {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    ) as Record<string, string>;
  }
  return '';
}

function parseToken(t: unknown): DesignToken {
  const o = (t ?? {}) as Record<string, unknown>;
  const out: DesignToken = {
    name: String(o.name ?? ''),
    type: String(o.type ?? 'string'),
    value: parseValue(o.value),
  };
  if (typeof o.description === 'string') out.description = o.description;
  return out;
}

export function parseGroups(raw: string | unknown): TokenGroup[] {
  return coerceArray(raw)
    .filter((g): g is Record<string, unknown> => g !== null && typeof g === 'object')
    .map((g) => ({
      name: String(g.name ?? ''),
      tier: g.tier === 'semantic' ? 'semantic' : 'primitive',
      tokens: Array.isArray(g.tokens) ? g.tokens.map(parseToken) : [],
    }));
}

export function parseModes(raw: string | unknown): DesignMode[] {
  return coerceArray(raw)
    .filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object')
    .map((m) => ({
      name: String(m.name ?? ''),
      overrides: Array.isArray(m.overrides)
        ? m.overrides
            .filter((o): o is Record<string, unknown> => o !== null && typeof o === 'object')
            .map((o) => ({ token: String(o.token ?? ''), value: parseValue(o.value) }))
        : [],
    }));
}

export function toListItem(ds: DesignSystem): DesignSystemListItem {
  return {
    slug: ds.slug,
    name: ds.name,
    description: ds.description,
    groupCount: ds.groups.length,
    tokenCount: ds.groups.reduce((acc, g) => acc + (g.tokens?.length ?? 0), 0),
    modeCount: ds.modes.length,
    tags: ds.tags,
  };
}

// ─── resolve() ───────────────────────────────────────────────────────────────

const ALIAS_RE = /^\{([^}]+)\}$/;

export function aliasTarget(value: string): string | null {
  const m = ALIAS_RE.exec(value.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * Resolve every token to its concrete value:
 *   1. recursive `{token}` alias expansion with cycle detection → `unresolved`
 *      (never throws),
 *   2. active-mode overrides applied over base (Base = no overrides); unknown
 *      override token ignored,
 *   3. name → resolvedValue (object for composite tokens).
 */
export function resolve(
  groups: TokenGroup[],
  modes: DesignMode[],
  activeMode?: string
): Record<string, ResolvedTokenValue> {
  const base = new Map<string, TokenValue>();
  for (const g of groups ?? []) {
    for (const t of g.tokens ?? []) {
      if (t && typeof t.name === 'string' && t.name) base.set(t.name, t.value);
    }
  }

  if (activeMode) {
    const mode = (modes ?? []).find((m) => m.name === activeMode);
    if (mode) {
      for (const ov of mode.overrides ?? []) {
        if (base.has(ov.token)) base.set(ov.token, ov.value);
      }
    }
  }

  const resolveValue = (value: TokenValue, seen: Set<string>): ResolvedTokenValue => {
    if (typeof value === 'string') {
      const target = aliasTarget(value);
      if (target === null) return value; // literal
      if (seen.has(target) || !base.has(target)) return UNRESOLVED_TOKEN;
      const next = new Set(seen);
      next.add(target);
      return resolveValue(base.get(target)!, next);
    }
    const out: Record<string, string> = {};
    for (const [k, fieldVal] of Object.entries(value ?? {})) {
      const r = resolveValue(typeof fieldVal === 'string' ? fieldVal : '', seen);
      out[k] = typeof r === 'string' ? r : UNRESOLVED_TOKEN;
    }
    return out;
  };

  const result: Record<string, ResolvedTokenValue> = {};
  for (const [name, value] of base) {
    result[name] = resolveValue(value, new Set([name]));
  }
  return result;
}

// ─── lintTokens() — warnings only; never blocks a write ──────────────────────

function isComposite(type: string): boolean {
  return (COMPOSITE_TOKEN_TYPES as readonly string[]).includes(type);
}

function aliasTargetOf(t: DesignToken | undefined): string | null {
  if (!t || typeof t.value !== 'string') return null;
  return aliasTarget(t.value);
}

function detectCycles(base: Map<string, DesignToken>): string[] {
  const out: string[] = [];
  const reported = new Set<string>();
  for (const start of base.keys()) {
    const seen: string[] = [];
    const seenSet = new Set<string>();
    let cur: string | null = start;
    while (cur && base.has(cur)) {
      if (seenSet.has(cur)) {
        const idx = seen.indexOf(cur);
        const cycle = seen.slice(idx).concat(cur);
        const key = [...new Set(cycle)].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          out.push(`Alias cycle: ${cycle.join(' → ')}`);
        }
        break;
      }
      seenSet.add(cur);
      seen.push(cur);
      cur = aliasTargetOf(base.get(cur));
    }
  }
  return out;
}

export function lintTokens(groups: TokenGroup[], modes: DesignMode[]): string[] {
  const warnings: string[] = [];
  const base = new Map<string, DesignToken>();
  const seenNames = new Set<string>();

  for (const g of groups ?? []) {
    for (const t of g.tokens ?? []) {
      if (!t || typeof t.name !== 'string' || !t.name) continue;
      if (seenNames.has(t.name)) warnings.push(`Duplicate token name '${t.name}'`);
      seenNames.add(t.name);
      base.set(t.name, t);
    }
  }

  for (const g of groups ?? []) {
    for (const t of g.tokens ?? []) {
      if (!t || typeof t.name !== 'string' || !t.name) continue;
      const composite = isComposite(t.type);

      if (t.value !== null && typeof t.value === 'object' && !composite) {
        warnings.push(
          `Token '${t.name}': object value requires a composite type (typography|shadow), got '${t.type}'`
        );
      }
      if (typeof t.value === 'string' && composite) {
        warnings.push(
          `Token '${t.name}': type '${t.type}' expects a composite object value, got a string`
        );
      }

      const aliasRefs: string[] = [];
      if (typeof t.value === 'string') {
        const target = aliasTarget(t.value);
        if (target) aliasRefs.push(target);
        else if (g.tier === 'semantic') {
          warnings.push(`note: semantic token '${t.name}' uses a literal value instead of an alias`);
        }
      } else if (t.value && typeof t.value === 'object') {
        for (const fv of Object.values(t.value)) {
          if (typeof fv === 'string') {
            const target = aliasTarget(fv);
            if (target) aliasRefs.push(target);
          }
        }
      }
      for (const ref of aliasRefs) {
        if (!base.has(ref)) {
          warnings.push(`Token '${t.name}': alias '{${ref}}' points to a non-existent token`);
        }
      }
    }
  }

  warnings.push(...detectCycles(base));

  for (const m of modes ?? []) {
    for (const ov of m.overrides ?? []) {
      if (!base.has(ov.token)) {
        warnings.push(`Mode '${m.name}': override targets non-existent token '${ov.token}'`);
      }
    }
  }

  return [...new Set(warnings)];
}
