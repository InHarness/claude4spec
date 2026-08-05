/**
 * The `url` ↔ `params[]` linter — item 59, moved to where its output is shown.
 *
 * It was a WRITE-path concern only by accident: `uiViewsRouter` ran it on create
 * and patch and returned `warnings[]` alongside the entity, so the same UI View
 * was "clean" when you loaded the page and "warned" the moment you saved it
 * without changing anything. Nothing here reads the database or blocks the
 * write — it is presentation-time advice about the payload in front of you, and
 * the generated `/api/ui-views` router (which has no per-type hook to run it in)
 * makes that structural rather than merely tidier.
 *
 * Shared, not client-only, so the MCP-side validator can call the identical
 * rules rather than a second copy that drifts.
 */

import type { UiViewParam, UiViewParamLocation } from '../../entities.js';

const VALID_LOCATIONS: ReadonlyArray<UiViewParamLocation> = ['path', 'query', 'hash'];

const PATH_PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;

export function computeWarnings(
  url: string | null,
  params: UiViewParam[]
): string[] {
  const warnings: string[] = [];

  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (!p.name) {
      warnings.push(`params[${i}]: missing 'name'`);
    }
    if (!(VALID_LOCATIONS as readonly string[]).includes(p.in as string)) {
      warnings.push(`params[${i}] '${p.name ?? '?'}': invalid 'in' value '${p.in}' (expected path|query|hash)`);
    }
  }

  const seen = new Set<string>();
  for (const p of params) {
    const key = `${p.in}::${p.name}`;
    if (seen.has(key)) {
      warnings.push(`Duplicate param (name='${p.name}', in='${p.in}')`);
    }
    seen.add(key);
  }

  const urlPathParams = new Set<string>();
  if (url) {
    const matches = url.matchAll(PATH_PARAM_RE);
    for (const m of matches) urlPathParams.add(m[1]!);
  }

  const declaredPathParams = new Set(
    params.filter((p) => p.in === 'path' && p.name).map((p) => p.name)
  );

  for (const name of urlPathParams) {
    if (!declaredPathParams.has(name)) {
      warnings.push(`path param ":${name}" in URL not declared in params[]`);
    }
  }
  for (const name of declaredPathParams) {
    if (url && !urlPathParams.has(name)) {
      warnings.push(`path param '${name}' declared but not present in URL`);
    }
  }

  if (url === null && declaredPathParams.size > 0) {
    warnings.push(`path params declared but URL is null (modal/drawer should not have path params)`);
  }

  return warnings;
}
