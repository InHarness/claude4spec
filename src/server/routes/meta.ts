/**
 * L4 — the `rest` rendering of four M39 core operations.
 *
 * 0.2.13 abandoned the premise that "endpoints serve the UI (React), not the
 * agent — the agent uses MCP". REST is now ONE surface with TWO consumers; where
 * their projections differ, the `view` parameter (L9) carries the difference,
 * not a second route family.
 *
 * Three of these four (`check_consistency`, `search_entities`, `resolve_identity`)
 * had no REST rendering at all before this release — `check_consistency` was
 * deliberately "MCP only". That is what made the M39 parity claim aspirational;
 * with these it is checkable.
 *
 * Every handler here is thin ON PURPOSE. It parses query parameters, calls the
 * owning core function, and returns what it got. It contributes NO error
 * taxonomy of its own: the core already throws `DiscoveryError` with the right
 * code AND the `hint` naming the call that would have worked, and
 * `routes/errors.ts` maps both. A handler that re-phrased either would be the
 * start of the next drift.
 *
 * `/_meta/*` is shared with `pluginHostRouter`, which owns the activation and
 * plugin diagnostics under the same prefix (`/_meta/entities`, `/_meta/plugins`,
 * `/_meta/plugin-settings`, `/_meta/plugin-commands`). The paths are disjoint, so
 * both routers mount happily. Worth keeping straight: `/_meta/entities` reports
 * the ACTIVATION partition (active/inactive/unknown), while `/_meta/types` below
 * introspects SCHEMAS. Neither is a substitute for the other.
 */

import { Router } from 'express';
import type { DiscoveryCore } from '../discovery/types.js';
import { errorHandler } from './errors.js';

/** `?limit=12` → 12; absent, empty, non-numeric or non-positive → undefined (let the core default). */
function positiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function optionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

export function metaRouter(discovery: DiscoveryCore): Router {
  const router = Router();

  /**
   * The entry point to a specification: page roots with their properties
   * (`sectionIndexed`, `referenceValidated`, `pageCount`), the active entity
   * types with counts and `payloadVersion`, the tag count, and the claude4spec
   * version. One call that answers "what is in here".
   */
  router.get('/overview', async (_req, res, next) => {
    try {
      res.json(await discovery.overview());
    } catch (err) {
      next(err);
    }
  });

  /**
   * Schemas of the active entity types. `?type=` is singular on the wire and
   * plural (`types[]`) in the core — the wire spelling matches how it is asked
   * ("describe THIS type"), and the core keeps the batch shape it needs.
   *
   * A type deactivated through `config.entities` answers `INVALID_TYPE` with the
   * active list attached — never a fallback to a generic schema, which would
   * make a deactivated type look half-alive. The core enforces that
   * (`ops/meta.ts`), not this handler.
   */
  router.get('/types', (req, res, next) => {
    try {
      const type = optionalString(req.query.type);
      const view = optionalString(req.query.view);
      res.json(
        discovery.describeTypes({
          ...(type ? { types: [type] } : {}),
          ...(view ? { view: view as never } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * Candidates for a name/slug fragment ACROSS every active type, as a
   * discriminated union — a cross-type facade over the per-type indexes, so the
   * caller does not have to know the type before asking. Pagination, sort
   * determinism and `searchedFields` come from the core.
   */
  router.get('/identities', (req, res, next) => {
    try {
      const query = optionalString(req.query.q);
      res.json(
        discovery.resolveIdentity({
          query: query ?? '',
          ...(positiveInt(req.query.limit) !== undefined ? { limit: positiveInt(req.query.limit) } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * The M19 consistency report. Read-only — it fixes nothing.
   *
   * `summary` always carries FULL counts, independently of `limit`, so a
   * truncated findings list stays visibly truncated. A report that contradicts
   * its own summary is worse than no filter at all; the core guarantees this by
   * counting before it filters or cuts.
   */
  router.get('/consistency', async (req, res, next) => {
    try {
      const severity = optionalString(req.query.severity);
      const rule = optionalString(req.query.rule);
      res.json(
        await discovery.checkConsistency({
          ...(severity === 'error' || severity === 'warning' ? { severity } : {}),
          ...(rule ? { rule } : {}),
          ...(positiveInt(req.query.limit) !== undefined ? { limit: positiveInt(req.query.limit) } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
