/**
 * M33: lower a runtime plugin's authoring shape (`EntityContribution`) into the
 * internal `BackendModule` the host already understands. This keeps
 * `mountBackend` / `MountContext` / `ProjectPluginHost` 100% unchanged — the
 * manifest is purely an authoring envelope, reconciled here.
 *
 * M13: backend mounting is now declarative by default. `lowerEntityContribution`
 * narrows the authoring `backend.{service,routes,mcpServer}` slots (typed
 * `unknown` in the shared/dep-free `EntityContribution`) into their typed
 * `BackendModule` counterparts; `synthesizeMount` (below) is the single choke
 * point — called uniformly by `PluginRegistryImpl.registerEntityModule` for
 * BOTH externally-loaded plugins (via this file) AND in-repo entities (whose
 * `plugin.ts` builds a `BackendModule` directly, bypassing `EntityContribution`)
 * — that turns those slots into an equivalent imperative `mount`. An explicit
 * `backend.mount` (full-power escape hatch) always takes precedence and is
 * passed through untouched.
 */

import type { Router } from 'express';
import type { Database } from 'better-sqlite3';
import type {
  EntityContribution,
  PluginSkillContribution,
  WritingStyleContribution,
} from '../../../shared/plugin-host/manifest.js';
import type { SerializationContribution } from '../../serialization/types.js';
import type { McpServerFactory } from '../../../shared/plugin-host/mcp.js';
import type { BackendModule, MountContext, PluginMountFn, ProjectPluginHost } from './types.js';
import type { EntityStore } from '../../services/entity-store.js';
import { declaresRefs, rewriteRefsForRename } from '../../db/ref-rewrite.js';


/** Thrown when a contribution is structurally invalid. Caught per-package by the loader. */
export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

/**
 * Validate one skill contribution (M37, 0.2.19 — generalised from
 * `validateWritingStyle`). Mirrors the SKILL.md frontmatter checks in
 * skill-registry so a plugin skill is held to the same shape as a file-authored
 * one, `scope` included. Throws `PluginManifestError` (caught per-package by the
 * loader) on any structural problem.
 */
export function validateSkillContribution(c: PluginSkillContribution): PluginSkillContribution {
  if (!c || typeof c !== 'object') {
    throw new PluginManifestError('skill contribution must be an object');
  }
  if (typeof c.slug !== 'string' || c.slug.length === 0) {
    throw new PluginManifestError('skill — slug must be a non-empty string');
  }
  if (typeof c.title !== 'string' || c.title.length === 0) {
    throw new PluginManifestError(`skill "${c.slug}" — title must be a non-empty string`);
  }
  if (typeof c.description !== 'string' || c.description.length === 0) {
    throw new PluginManifestError(`skill "${c.slug}" — description must be a non-empty string`);
  }
  if (typeof c.version !== 'number' || !Number.isInteger(c.version) || c.version < 1) {
    throw new PluginManifestError(`skill "${c.slug}" — version must be a positive integer`);
  }
  if (c.language !== 'en' && c.language !== 'pl') {
    throw new PluginManifestError(`skill "${c.slug}" — language must be 'en' or 'pl'`);
  }
  if (c.scope !== 'writing-style' && c.scope !== 'contextual') {
    throw new PluginManifestError(`skill "${c.slug}" — scope must be 'writing-style' or 'contextual'`);
  }
  if (typeof c.content !== 'string') {
    throw new PluginManifestError(`skill "${c.slug}" — content must be a string`);
  }
  return c;
}

/**
 * M15 sugar: a `writingStyles` entry is a skill contribution with `scope`
 * implied. Lowering it here — rather than at the registry — is what makes the two
 * manifest slots produce a byte-identical entry, which is the whole claim of
 * "`writingStyles` is sugar over `skills`".
 */
export function validateWritingStyle(c: WritingStyleContribution): PluginSkillContribution {
  return validateSkillContribution({ ...c, scope: 'writing-style' });
}

const MANIFEST_FIELDS = [
  'type',
  'data',
  'slugPattern',
  'payloadVersion',
  'label',
  'labelPlural',
  'displayOrder',
  'pathPrefix',
] as const;

/**
 * Slots removed in Host API 2.0.0, each with the successor to name in the error.
 *
 * A manifest still carrying one of these is REJECTED rather than tolerated. It
 * was authored against 1.x, so its DDL, its slug function and its snapshot are
 * all describing a contract the host no longer honours — loading it would
 * produce a type whose table is never created and whose slugs are never
 * generated. The semver gate catches the well-behaved case (a declared
 * `hostApiVersion` range); this catches the manifest that lies about its range,
 * and gives the author the same migration line `plugins doctor` prints.
 */
const REMOVED_SLOTS: ReadonlyArray<[string, string]> = [
  ['slugFrom', 'slugPattern'],
  ['table', 'data.schema (the projection is generated)'],
  ['composition', 'data.schema (the descriptor is derived)'],
];
const REMOVED_BACKEND_SLOTS: ReadonlyArray<[string, string]> = [
  ['migrations', 'data.schema (the projection is generated)'],
  ['auxTables', "data.schema (declare the collection that owns the table)"],
  // Rejected rather than ignored, for the same reason as the serializer slots
  // below: a manifest that migrated its projection and left this hook behind
  // reads as migrated. Dropping it silently would leave that plugin's references
  // rotting on every rename — and if the reference is not expressible as a `ref`
  // flag, the author needs to hear that now rather than from stale data later.
  ['onEntityRenamed', "data.schema (flag the field `ref: '<type>'`)"],
];

/**
 * Slots a 1.x serializer carried that Host API 2.0.0 derives instead.
 *
 * Rejected, not ignored: a package still shipping `snapshot` believes it owns
 * its file format, and loading it would leave the host generating a DIFFERENT
 * snapshot than the one the plugin was written to read back. Silence there costs
 * data; an error costs one line of migration.
 */
const REMOVED_SERIALIZER_SLOTS: ReadonlyArray<[string, string]> = [
  ['type', 'the manifest already declares it'],
  ['version', 'payloadVersion (an integer, enforced by the upgrade chain)'],
  ['inlineMention', 'views.inline_mention'],
  ['singleElement', 'views.single_element'],
  ['elementListItem', 'views.element_list_item'],
  ['taggedListItem', 'views.tagged_list_item'],
  // `detail` is spelled the same in 1.x and inside `views`, which is exactly why
  // it has to be listed: a half-migrated manifest that moved the other four and
  // left this one at the top level is the case that reads as "migrated" and
  // silently loses `_references`, resolved refs and `_brokenRefs` on every
  // detail read.
  ['detail', 'views.detail'],
  ['schema', 'nothing — schemas are derived from data.schema'],
  // Removed in tier B PR2. A manifest that still carries either one is not
  // merely out of date: its snapshot would be IGNORED while the host generated a
  // different payload from the declaration, so the type would keep compiling,
  // keep registering, and quietly write files in a shape its own code disagrees
  // with. Rejecting the slot is the only version of this that a plugin author
  // finds out about.
  ['snapshot', 'nothing — snapshot is generated from data.schema'],
  ['restore', 'nothing — restore is generated from data.schema'],
];

/**
 * The L9 half of registration, exported because it must run for EVERY module,
 * not only for one lowered from an `EntityContribution`.
 *
 * In-repo entities build a `BackendModule` by hand and never pass through
 * `assertContribution`, so the checks below were reaching exactly the plugins
 * least likely to need them and skipping the four types shipped in this repo.
 * `PluginRegistryImpl.registerEntityModule` is the choke point both origins do
 * share, and it calls this.
 */
export function assertSerializationContribution(
  type: string,
  serializer: Record<string, unknown>,
  payloadVersion: number,
): void {
  for (const [slot, successor] of REMOVED_SERIALIZER_SLOTS) {
    if (serializer[slot] != null) {
      throw new PluginManifestError(
        `entity "${type}" — \`serializer.${slot}\` was removed in Host API 2.0.0; use \`${successor}\``,
      );
    }
  }
  /**
   * The manifest slot is the AUTHORITY and the only thing any consumer reads;
   * the contribution's copy is an optional echo, kept because the brief declares
   * the field there. Optional rather than required on purpose — a number every
   * author must write twice is a number that will eventually be written twice
   * differently, and nothing outside this check would notice.
   */
  if (serializer.payloadVersion != null && serializer.payloadVersion !== payloadVersion) {
    throw new PluginManifestError(
      `entity "${type}" — serializer.payloadVersion (${String(serializer.payloadVersion)}) ` +
        `disagrees with the manifest's payloadVersion (${payloadVersion})`,
    );
  }
  const upgrades = serializer.payloadUpgrades;
  if (upgrades != null && (!Array.isArray(upgrades) || upgrades.some((u) => typeof u !== 'function'))) {
    throw new PluginManifestError(`entity "${type}" — payloadUpgrades must be an array of functions`);
  }
  /**
   * One step per version transition, no more and no less — and checked whether
   * or not the slot is present.
   *
   * It used to be gated on `upgrades != null`, which made the ABSENT chain the
   * one shape that slipped through: a type bumping to `payloadVersion: 2` with
   * no `payloadUpgrades` at all registered cleanly. What followed was silent and
   * unrecoverable. `upgradePayload` warns about the missing step, `continue`s,
   * and still reports `upgraded: true`, so the indexer rewrites every file of
   * that type STAMPED v2 while its content is still v1. Ship the real migration
   * a release later and the marker now says the work is done: the chain
   * short-circuits and the v1 payloads are stranded for good.
   *
   * Absent is therefore just a chain of length zero, and only legal at version 1.
   */
  const declared = Array.isArray(upgrades) ? upgrades.length : 0;
  if (declared !== payloadVersion - 1) {
    throw new PluginManifestError(
      `entity "${type}" — payloadUpgrades must have exactly ${payloadVersion - 1} step(s) for ` +
        `payloadVersion ${payloadVersion}, got ${declared}` +
        (upgrades == null ? ' (the slot is absent — a bump needs a migration)' : ''),
    );
  }
}

function assertContribution(c: EntityContribution): void {
  if (!c || typeof c !== 'object') {
    throw new PluginManifestError('entity contribution must be an object');
  }
  const record = c as unknown as Record<string, unknown>;
  for (const f of MANIFEST_FIELDS) {
    if (record[f] == null) {
      throw new PluginManifestError(`entity "${c.type ?? '?'}" missing required field "${f}"`);
    }
  }
  for (const [slot, successor] of REMOVED_SLOTS) {
    if (record[slot] != null) {
      throw new PluginManifestError(
        `entity "${c.type}" — \`${slot}\` was removed in Host API 2.0.0; declare \`${successor}\` instead`,
      );
    }
  }
  const backendRecord = record.backend as Record<string, unknown> | undefined;
  for (const [slot, successor] of REMOVED_BACKEND_SLOTS) {
    if (backendRecord?.[slot] != null) {
      throw new PluginManifestError(
        `entity "${c.type}" — \`backend.${slot}\` was removed in Host API 2.0.0; declare ` +
          `\`${successor}\` instead`,
      );
    }
  }
  if (c.serializer == null) {
    throw new PluginManifestError(`entity "${c.type}" — serializer is required`);
  }
  assertSerializationContribution(c.type, c.serializer as Record<string, unknown>, c.payloadVersion);
  if (c.systemPrompt == null) {
    throw new PluginManifestError(`entity "${c.type}" — systemPrompt is required`);
  }
  const backend = c.backend;
  if (backend != null && typeof backend !== 'object') {
    throw new PluginManifestError(`entity "${c.type}" — backend must be an object`);
  }
}

/**
 * Convert one `EntityContribution` (shared authoring shape with `unknown`
 * server payloads) into a fully-typed `BackendModule`. Narrows the declarative
 * slots into their typed counterparts but does NOT synthesize `mount` —
 * `PluginRegistryImpl.registerEntityModule` applies `synthesizeMount`
 * uniformly to every module regardless of origin (see module docstring).
 */
export function lowerEntityContribution(c: EntityContribution): BackendModule {
  assertContribution(c);

  const backend = c.backend;
  let backendSlot: BackendModule['backend'];

  if (backend) {
    const mount = backend.mount as PluginMountFn | undefined;
    if (mount && typeof mount !== 'function') {
      throw new PluginManifestError(`entity "${c.type}" — backend.mount must be a function`);
    }

    backendSlot = {
      mount,
      service: backend.service as ((ctx: MountContext) => unknown) | undefined,
      routes: backend.routes as { router: (service: unknown, ctx: MountContext) => Router } | undefined,
      mcpServer: backend.mcpServer as
        | ((service: unknown, ctx: MountContext) => McpServerFactory)
        | undefined,
      // No `auxTables`: `REMOVED_BACKEND_SLOTS` above throws on it, so a
      // contribution carrying one never reaches this line. The slot survives on
      // the server-side `BackendModule` for in-repo modules built by hand — it
      // is only the AUTHORING surface that stopped offering it.
    };
  }

  return {
    type: c.type,
    label: c.label,
    labelPlural: c.labelPlural,
    displayOrder: c.displayOrder,
    data: c.data,
    slugPattern: c.slugPattern,
    ...(c.slugConflict ? { slugConflict: c.slugConflict } : {}),
    payloadVersion: c.payloadVersion,
    pathPrefix: c.pathPrefix,
    dependsOn: c.dependsOn,
    serializer: c.serializer as SerializationContribution<unknown>,
    systemPrompt: c.systemPrompt,
    backend: backendSlot,
  };
}

/**
 * M13 — the single lowering choke point: turn a module's declarative backend
 * slots (`service`/`routes`/`mcpServer`) into an equivalent imperative
 * `mount`, iff no explicit `mount` was already supplied (the escape hatch
 * always wins, unchanged). Called by `PluginRegistryImpl.registerEntityModule`
 * for every module — both in-repo entities (hand-built `BackendModule`, no
 * `EntityContribution` involved) and externally-loaded plugins (already run
 * through `lowerEntityContribution` first).
 *
 * Idempotent / side-effect-free at registration time: it only builds a new
 * `mount` closure, never calls it. Throws `PluginManifestError` if
 * `routes.router` is present but not a function (the pre-M13 bare-Router
 * sugar), which would otherwise fail confusingly at first mount, deep inside a
 * project's request path.
 *
 * 2.0.0 tier K — the `mcpServer requires service` check is GONE. It encoded the
 * old shape where a custom MCP server was a thin wrapper over that type's CRUD
 * service; now that CRUD is the host's, a type can perfectly well contribute a
 * non-CRUD tool and no service at all (`diagram`'s `validate_diagram` checks a
 * raw string and touches no database). The service argument is simply
 * `undefined` for such a type, which its own factory already ignores.
 *
 * 2.0.0 (A.8) — rename propagation left this function too. It was never a
 * backend slot: it is derived from `data.schema`, so gating it on the presence
 * of a synthesized `mount` meant a hand-written `mount` module got it only via a
 * composed-closure special case. `registerRefRewriteListeners` below registers
 * it for every module by one path.
 */
export function synthesizeMount(module: BackendModule): BackendModule {
  const backend = module.backend;

  // The escape hatch wins for everything it owns.
  if (backend?.mount) return module;

  const { service, routes, mcpServer } = backend ?? {};
  if (!service && !routes && !mcpServer) return module;

  if (routes && typeof routes.router !== 'function') {
    // M13 breaking change: backend.routes.router is now ALWAYS a factory
    // `(service, ctx) => Router` — a manifest still written against the old
    // pre-M13 "bare Router" sugar (`backend.routes = someRouterInstance`)
    // would otherwise only fail later, deep inside mountBackend, as a raw
    // "routes.router is not a function" TypeError that fails the whole
    // project load. Fail fast here with a readable, attributable error.
    throw new PluginManifestError(
      `entity "${module.type}" — backend.routes.router must be a function (service, ctx) => Router; ` +
        `a bare express Router is no longer accepted (breaking change from the pre-M13 "routes" sugar)`,
    );
  }

  const mount: PluginMountFn = (ctx: MountContext): void => {
    // 2.0.0 tier K: whatever the slot builds is a DOMAIN HELPER, opaque to the
    // host. It is handed straight back to the two factories that asked for it —
    // the type's own `routes`/`mcpServer` — which are the only code that knows
    // what it is.
    let instance: unknown;
    if (service) {
      instance = service(ctx);
      ctx.registerEntityService(module.type, instance);
    }
    if (routes) {
      ctx.app.use(module.pathPrefix, routes.router(instance, ctx));
    }
    if (mcpServer) {
      // 0.1.133: the slot returns the MCP server HANDLE directly (not a thunk).
      // Per-turn freshness is host-owned — wrap the slot factory in a thunk so
      // `buildMcpServers()` re-invokes it each turn for a fresh, connectable
      // server (an MCP instance can't be re-`connect`ed across turns).
      // Thunk auto-unwrapping (pre-0.1.133 contract) and shape validation both
      // live in `ProjectPluginHostImpl.buildMcpServers()` — the single choke
      // point every registered factory passes through, including the ones a
      // plugin's own `mount()` registers without going through this adapter.
      const svc = instance;
      ctx.registerMcpServer(`${module.type}-tools`, () => mcpServer(svc, ctx));
    }
  };

  return { ...module, backend: { ...backend, mount } };
}

/**
 * The generated replacement for `backend.onEntityRenamed` (removed in 2.0.0).
 *
 * Repoint whatever the declaration says references the renamed type, then
 * re-persist the files whose data actually changed. A file that will not write
 * must not abort the rename — the index is already correct by then, and the three
 * hooks this replaces swallowed the same failure.
 *
 * 2.0.0 (A.8) — called once by `ProjectContext` over every registered module,
 * rather than from inside each type's synthesized `mount`. Item 24 says a `ref`
 * flag earns propagation "with no per-type code on either side"; registering it
 * from the lowering step made that true only for modules that HAD slots to lower,
 * and a hand-written `mount` needed a composed closure to get the same thing.
 * Here there is one path and one condition — the declaration.
 */
export function registerRefRewriteListeners(host: ProjectPluginHost, db: Database, store: EntityStore): void {
  for (const module of host.listEntities()) {
    if (!declaresRefs(module)) continue;
    host.registerRenameListener(({ type, oldSlug, newSlug }) => {
      for (const slug of rewriteRefsForRename(db, module, type, oldSlug, newSlug)) {
        try {
          store.persist(module.type, slug);
        } catch (err) {
          console.warn(
            `[plugin-host] ${module.type}/${slug}: re-persist after ${type} rename ` +
              `${oldSlug} -> ${newSlug} failed: ${String(err)}`,
          );
        }
      }
    });
  }
}
