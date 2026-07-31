/**
 * 0.2.4 — the composition descriptor is validated AT REGISTRATION, not at first
 * `DELETE`.
 *
 * The rule this enforces is temporal, not just structural. A descriptor is a
 * licence to issue `DELETE` against named tables during a rebuild; discovering
 * at that moment that the licence was malformed is discovering it inside a
 * transaction, at boot, with the index already half-cleared. Every check below
 * therefore runs while the manifest is still being lowered, where the only
 * consequence of rejection is that the plugin does not load.
 *
 * It also promotes a runtime warn-and-skip into a hard failure:
 * `EntityIndexerService.safeTable` guarded the identifier shape at DML time
 * because table names arrive from a plugin manifest and are interpolated into
 * `db.exec` (which runs multiple statements). That guard stays as an assert,
 * but after this it should be unreachable.
 */

import { BASELINE_TABLES, COLLISION_EXEMPT_TABLES } from '../../db/baseline-tables.js';
import {
  HOST_SHARED_TABLES,
  attachResolvedComposition,
  defaultSharedScope,
  resolveComposition,
  typeTablePrefix,
  type ResolvedComposition,
} from '../../../shared/plugin-host/composition.js';
import { PluginManifestError } from './manifest-adapter.js';
import type { BackendModule } from './types.js';

/** A bare SQL identifier — the shape safe to interpolate into DDL/DML. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A scope predicate is interpolated into DML, so it is ALLOWLISTED, not
 * blacklisted. Comparison, boolean connectives, quoted literals and
 * parenthesised groups are enough to isolate one type's rows; anything richer
 * would be a broader SQL-execution hole than the `table` hole 0.2.2 closed, and
 * `countStat.sqlQuery` is being removed in this same release precisely to shut
 * that surface.
 *
 * `-` is in the set because type slugs are kebab-case, so the default predicate
 * is `entity_type = 'ui-view'`. A lone hyphen is inert in SQL; the dangerous
 * form is the comment introducer `--`, which is rejected separately below
 * rather than by omitting the character.
 */
const PREDICATE_ALLOWED_RE = /^[A-Za-z0-9_\- '"=<>().,]+$/;

function fail(module: BackendModule, message: string): never {
  throw new PluginManifestError(`entity type "${module.type}" — composition: ${message}`);
}

function checkIdentifier(module: BackendModule, value: unknown, what: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
    fail(module, `${what} must be a bare SQL identifier, got ${JSON.stringify(value)}`);
  }
  return value;
}

function checkPredicate(module: BackendModule, table: string, predicate: unknown): void {
  if (typeof predicate !== 'string' || predicate.trim() === '') {
    fail(
      module,
      `shared table "${table}" must declare a non-empty scopePredicate — without one the host ` +
        `cannot clear this type's rows without clearing every other type's`,
    );
  }
  if (!PREDICATE_ALLOWED_RE.test(predicate) || predicate.includes('--') || predicate.includes('/*')) {
    fail(
      module,
      `scopePredicate for shared table "${table}" contains characters outside the allowed set ` +
        `(comparison, AND, quoted literals, parentheses): ${JSON.stringify(predicate)}`,
    );
  }
  /**
   * The character allowlist bounds what SQL the predicate can express; it says
   * nothing about what the predicate SELECTS. `1=1`, `entity_type <> 'ac'` and
   * `entity_slug IN (SELECT slug FROM ac)` all pass it while matching every
   * other type's rows — so a rule whose entire purpose is "this type may only
   * clear its own rows" would be satisfiable by a predicate that clears
   * everyone's. The predicate must therefore be ANCHORED on the declaring
   * type's own identity, and may only narrow from there with `AND`.
   */
  const canonical = defaultSharedScope(module.type);
  const normalized = predicate.replace(/\s+/g, ' ').trim();
  if (normalized !== canonical && !normalized.startsWith(`${canonical} AND `)) {
    fail(
      module,
      `scopePredicate for shared table "${table}" must be \`${canonical}\`, optionally narrowed ` +
        `with \` AND …\` — a predicate that does not anchor on this type can clear other types' ` +
        `rows, which is the exact outcome requiring a predicate exists to prevent. ` +
        `Got: ${JSON.stringify(predicate)}`,
    );
  }
}

/**
 * Prefix check, boundary-aware. A bare `startsWith('ac')` would authorize
 * `account_anything` — a small bug opening a large hole, since the prefix rule
 * is what stops one type from declaring another's tables.
 */
function checkPrefix(module: BackendModule, table: string, what: string): void {
  const prefix = typeTablePrefix(module.type);
  if (table !== prefix && !table.startsWith(`${prefix}_`)) {
    fail(
      module,
      `${what} "${table}" must be named "${prefix}" or start with "${prefix}_" — a type may only ` +
        `declare its own tables`,
    );
  }
}

/**
 * Owned tables (main + derived) may not be baseline tables or another type's.
 *
 * Note the asymmetry with shared tables, and why it is not an oversight: the
 * brief asks for both "every table carries the type prefix" and "declaring a
 * baseline table rejects the manifest", but the one real shared table,
 * `entity_tag`, is a baseline table with no type prefix. Both rules therefore
 * bind OWNED tables only; shared tables get the inverse rule — they must come
 * from the host's own set, and must carry a predicate.
 */
function checkOwnedTable(
  module: BackendModule,
  table: string,
  what: string,
  peerOwned: Map<string, string>,
  legacy: boolean,
): void {
  checkIdentifier(module, table, what);
  if (HOST_SHARED_TABLES.has(table)) {
    fail(
      module,
      `${what} "${table}" is a host-owned shared table — declare it under sharedTables with a ` +
        `scopePredicate instead of claiming ownership of it`,
    );
  }
  if (BASELINE_TABLES.has(table) && !COLLISION_EXEMPT_TABLES.has(table)) {
    fail(module, `${what} "${table}" belongs to the core baseline schema and cannot be claimed`);
  }
  /**
   * The prefix and cross-type rules bind DECLARED descriptors only.
   *
   * Both are 0.2.4 conventions, and applying them to the descriptor synthesized
   * from a legacy `table` + `auxTables` pair would retroactively outlaw manifest
   * shapes that have always loaded: a type whose table simply is not named after
   * it (`use-case` → `usecase`), and — the common one — a junction listed in
   * `auxTables` from BOTH ends, which is how a legacy two-sided relation says
   * "clear this too". Neither was ever checked before, and a plugin author gets
   * no warning from the semver gate, since the descriptor is additive within
   * HOST_API 1.0.0. Rejecting those at registration would take every entity type
   * in the plugin offline and make its already-indexed rows unreadable.
   *
   * The checks above this line are NOT conventions and do bind legacy modules:
   * an identifier that is not an identifier reaches `db.exec`, and a claim on
   * `entity_tag` or a core baseline table destroys other types' data.
   */
  if (legacy) return;
  checkPrefix(module, table, what);
  const owner = peerOwned.get(table);
  if (owner && owner !== module.type) {
    fail(module, `${what} "${table}" is already declared by entity type "${owner}"`);
  }
}

/** Tables owned by already-registered modules → the type that owns each. */
function ownedByPeers(peers: Iterable<BackendModule>, selfType: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const peer of peers) {
    if (peer.type === selfType) continue; // re-registration of the same type is a replace
    const resolved = resolveComposition(peer);
    out.set(resolved.mainTable, peer.type);
    for (const derived of resolved.derivedTables) out.set(derived.table, peer.type);
  }
  return out;
}

/**
 * Validate a module's descriptor and return the resolved value.
 *
 * `peers` are the modules already committed to the registry, so cross-type
 * collisions are caught at DECLARATION time. That is the twin of the DDL check
 * in `plugin-migrate.ts`, and it covers the case the DDL check structurally
 * cannot see: a plugin that ships no migrations at all but declares a
 * descriptor pointing at somebody else's table.
 */
export function validateComposition(
  module: BackendModule,
  peers: Iterable<BackendModule>,
): ResolvedComposition {
  const resolved = resolveComposition(module);
  const peerOwned = ownedByPeers(peers, module.type);

  checkOwnedTable(module, resolved.mainTable, 'mainTable', peerOwned, resolved.legacy);
  checkIdentifier(module, resolved.identityColumn, 'identityColumn');

  /**
   * The descriptor is the source of truth for the consumers that were migrated
   * in 0.2.4; `module.table` is still the source for the ones that were not
   * (the M29 indexer, and every service's own SQL). Until that slot is deleted,
   * the two must AGREE — a descriptor naming a different table than the one the
   * writers use splits reads from writes: the rebuild fills one table while
   * every read resolves the other, so the type answers empty to the agent while
   * the UI lists rows. It also reopens the checks above, which only ever see
   * `resolved.mainTable`: a manifest with a compliant descriptor and a hostile
   * `table` would pass validation and still reach `DELETE FROM <hostile>`.
   */
  if (module.composition && resolved.mainTable !== module.table) {
    fail(
      module,
      `mainTable "${resolved.mainTable}" does not match the module's \`table\` ` +
        `"${module.table}". While \`table\` remains (deprecated in 0.2.4, removed once every ` +
        `consumer reads the descriptor) the two are the same table and must be written the same`,
    );
  }

  // Which derived tables were DECLARED, as opposed to merged in from the legacy
  // `backend.auxTables` slot. Only a declared one is required to name its
  // binding column — an auxTables entry resolves to a null binding by design,
  // on a declared and a synthesized descriptor alike.
  const declaredDerived = new Set((module.composition?.derivedTables ?? []).map((d) => d.table));
  const seen = new Set<string>([resolved.mainTable]);
  for (const derived of resolved.derivedTables) {
    checkOwnedTable(module, derived.table, 'derivedTables[].table', peerOwned, resolved.legacy);
    if (seen.has(derived.table)) {
      fail(module, `table "${derived.table}" is declared twice`);
    }
    seen.add(derived.table);
    if (derived.bindingColumn !== null) {
      checkIdentifier(module, derived.bindingColumn, `derivedTables["${derived.table}"].bindingColumn`);
    } else if (declaredDerived.has(derived.table)) {
      fail(module, `derivedTables["${derived.table}"] must declare a bindingColumn`);
    }
  }

  for (const shared of resolved.sharedTables) {
    checkIdentifier(module, shared.table, 'sharedTables[].table');
    if (!HOST_SHARED_TABLES.has(shared.table)) {
      fail(
        module,
        `sharedTables[].table "${shared.table}" is not a host-owned shared table ` +
          `(known: ${[...HOST_SHARED_TABLES].join(', ')}) — a table only this type writes belongs ` +
          `under derivedTables`,
      );
    }
    checkPredicate(module, shared.table, shared.scopePredicate);
  }

  return resolved;
}

/**
 * Validate and cache the descriptor on the module. Idempotent and called from
 * both choke points (`validateAndLower` and `registerEntityModule`), mirroring
 * `synthesizeMount`, so in-repo modules and plugin-contributed ones are held to
 * exactly the same bar.
 */
export function attachComposition(module: BackendModule, peers: Iterable<BackendModule>): BackendModule {
  return attachResolvedComposition(module, validateComposition(module, peers));
}
