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
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { resolvePageContent } from '../serialization/resolve-page.js';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';
import { commaList, positiveInt } from './query-params.js';

function optionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

export function metaRouter(discovery: DiscoveryCore, host: ProjectPluginHost): Router {
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
      // 0.2.13 (tier C) — `?types=` narrows the sweep to a subset, which the
      // core has always taken (`ResolveIdentityInput.types`) and this route
      // dropped. The `cli` rendering has spelled it `--types` since 0.2.6, so
      // without it the two channels answered differently for the same call.
      const types = commaList(req.query.types);
      res.json(
        discovery.resolveIdentity({
          query: query ?? '',
          ...(types ? { types } : {}),
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

  /**
   * 0.2.13 (tier C) — `c4s resolve`, and NOT a catalog operation.
   *
   * Everything else in this file renders an operation. This does not, and the
   * distinction is worth keeping visible: resolving is a TRANSPORT-SIDE
   * COMPOSITION over `get_entities`/`list_entities` — it reads a markdown file
   * and pastes the entities its tags name back over the tags. `resolve-page.ts`
   * says why that must never become a tool: an agent reading a specification
   * wants the EDGE a tag is, not a payload written over it. Adding it to the
   * catalog would put that payload in every channel.
   *
   * It is a POST with the content in the body because the file is on the
   * CALLER'S disk. `c4s resolve <file.md>` is run against a working copy the
   * server may not be able to see — a path in a query string would resolve
   * against the wrong filesystem, silently, whenever the two differ.
   *
   * The composition still executes in the server process, which is the point of
   * the change: the CLI used to build a discovery core of its own to do this,
   * and that was the last operation it executed locally.
   */
  router.post('/resolve-page', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { content?: unknown };
      if (typeof body.content !== 'string') {
        throw new DomainError('VALIDATION', 'content must be a string (the markdown to resolve)');
      }
      const { resolved, inlineContent } = resolvePageContent(body.content, {
        discovery,
        activeTypes: host.listEntities().map((m) => m.type),
        availableTypes: host.listAvailable().map((m) => m.type),
      });
      res.json({ content: body.content, inlineContent, resolved });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
