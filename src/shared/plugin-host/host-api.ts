/**
 * M33 — Host API versioning surface: the per-major changelog and the
 * migration descriptors a plugin author needs when their package was built
 * against an incompatible major.
 *
 * Versioning rule (mirrored in the manifest doc): additive same-major slots =
 * minor bump; a breaking slot-shape change = major bump WITH a descriptor here
 * and a deprecation window (a slot deprecated in major N may be removed only in
 * N+1). `incompatible` (major mismatch) is distinct from `skipped` (an `engines`
 * miss — an environment problem with no migration path).
 *
 * The surface now also covers the `stable` Host UI Kit components (M34/L12); a
 * breaking prop-shape change there is a major bump with a `ui-prop-reshape`
 * descriptor (see {@link VERSIONED_UI_KIT_COMPONENTS}).
 *
 * Since 0.1.133 the surface also covers the MCP builder FACADE (the opaque
 * `McpServerFactory` handle + the `createMcpServer` / `mcpTool` signatures
 * re-exported from `@c4s/plugin-runtime`). Crucially, a version bump of the
 * vendor `@inharness-ai/agent-adapters` hidden BEHIND that facade is NOT a
 * surface change and does NOT bump `hostApiVersion` while the facade shape
 * holds — only a change to the facade shape itself qualifies as a major.
 */

import { HOST_API_VERSION, parseMajor } from './manifest.js';
import { UI_KIT_STABLE_COMPONENTS } from './ui-kit-surface.js';

/**
 * The component prop contracts counted into the versioned `hostApiVersion`
 * surface from the Host UI Kit (M34/L12): the `stable` (Core) tier ONLY. A
 * breaking prop-shape change to one of these is a major bump carrying a
 * `ui-prop-reshape` descriptor below (AC3). `experimental` kit components are
 * exposed by `@c4s/plugin-runtime/ui` but excluded here — their props may change
 * without a major and they are NOT gated at plugin load (AC4). Promoting an
 * `experimental` component to `stable` adds it to {@link UI_KIT_STABLE_COMPONENTS}
 * and thereby to this surface (AC5).
 */
export const VERSIONED_UI_KIT_COMPONENTS = UI_KIT_STABLE_COMPONENTS;

/** One versioned change to the Host API contract between two adjacent majors. */
export interface HostApiMigration {
  fromMajor: number;
  toMajor: number;
  /** The affected slot / surface, e.g. "onUnregister" or a `stable` kit component. */
  slot: string;
  /**
   * `ui-prop-reshape` — a breaking prop-shape change to a `stable` Host UI Kit
   * component (M34/L12). The others cover the manifest/contributes/editor
   * surfaces.
   */
  kind: 'slot-required' | 'slot-removed' | 'field-rename' | 'contributes-reshape' | 'ui-prop-reshape';
  /** Human-readable migration instruction. */
  summary: string;
}

/** Migration path attached to an `incompatible` package record. */
export interface PluginMigrationInfo {
  /** The Host API version to target after migrating. */
  targetHostApiVersion: string;
  /** Versioned descriptors of the shape changes between the plugin's major and the host's. */
  migrations: HostApiMigration[];
  /** Whether a compat-shim exists for the deprecated slot(s). */
  shimAvailable: boolean;
}

/**
 * The Host API changelog, one entry per breaking change at a major boundary.
 *
 * There is ONE crossing, 1 → 2, and the baseline has stayed on it. The shape
 * changes that landed after it — the reserved `title`, the `select` projection
 * replacing the `view` axis, the redefined `contentBearing`, and the removal of
 * the `views?` slot itself — are absorbed INTO 2.0.0 rather than raising it,
 * under the stabilisation rule: 2.0.0 is not published and has no external
 * plugin consumer, so there is nobody a major bump could protect.
 *
 * 1 → 2 is that crossing, and it is the whole point of 2.0.0: an entity
 * type stops CARRYING behaviour (DDL, a slug function, a serializer's
 * snapshot/restore) and starts DECLARING data, from which the host generates
 * the rest. Every entry below is a removal, and every one has
 * `shimAvailable: false` — a shim would have to invent a logical schema out of
 * hand-written SQL, which is exactly the inference this release exists to stop
 * doing. There is no deprecation window: a package built against 1.x does not
 * load, and `c4s plugins doctor` prints these lines.
 */
const HOST_API_CHANGELOG: HostApiMigration[] = [
  {
    fromMajor: 1,
    toMajor: 2,
    slot: 'backend.migrations',
    kind: 'slot-removed',
    summary:
      'Per-plugin DDL is gone, along with the `plugin_schema_migrations` ledger. ' +
      'Declare `data.schema` — a logical field set — and the host generates the ' +
      'SQLite projection from it. A schema change regenerates the projection ' +
      'rather than migrating it: the entity files are authoritative and the index ' +
      'is rebuilt from them.',
  },
  {
    fromMajor: 1,
    toMajor: 2,
    slot: 'slugFrom',
    kind: 'slot-removed',
    summary:
      'Replaced by `slugPattern`, the same derivation as DATA: a closed grammar of ' +
      'literal | slugify(field) | truncate(n) | nanoid(n). A function could read ' +
      'the database or answer differently on a second call, which made slug ' +
      'derivation the one part of a type\'s identity the host could neither inspect ' +
      'nor reproduce.',
  },
  {
    fromMajor: 1,
    toMajor: 2,
    slot: 'serializer.{version,inlineMention,singleElement,elementListItem,taggedListItem,schema}',
    kind: 'slot-removed',
    summary:
      'The serializer became a `SerializationContribution`: an integer ' +
      '`payloadVersion` and an ordered `payloadUpgrades` chain. (It briefly also ' +
      'carried an optional semantic `diff`; 0.2.31 removed that slot within this ' +
      'same baseline — the host generates the delta from `data.schema`.) The advisory semver is gone — the registry never enforced it — ' +
      'and JSON Schemas are derived from `data.schema` instead of being ' +
      'hand-written per view or reflected off the SQLite columns. A type ' +
      'contributes NO read code: the host derives the whole record from ' +
      '`data.schema` and the caller narrows it with `select`.',
  },
  {
    fromMajor: 1,
    toMajor: 2,
    slot: 'serializer.{snapshot,restore}',
    kind: 'slot-removed',
    summary:
      'The host GENERATES both from `data.schema`, over its own `RawEntity` ' +
      'wrapper (`{ type, slug, data, tags }`) — domain fields live under `.data`, ' +
      'not flat. Which restore a collection gets follows from its declaration ' +
      'rather than from hand-written code: `collection: \'value\'` is replaced ' +
      'wholesale, `collection: \'keyed\'` is reconciled replace-all. A ' +
      'hand-written pair could disagree with the projection it wrote into; a ' +
      'generated one cannot. Payload shape changes now travel as an ordered ' +
      '`payloadUpgrades` chain instead of being absorbed silently by `restore`.',
  },
  {
    fromMajor: 1,
    toMajor: 2,
    slot: 'routes.prefix',
    kind: 'slot-removed',
    summary:
      "A domain router inherits the type's `pathPrefix` rather than declaring its " +
      'own. Two spellings of one path meant a type could answer on one prefix and ' +
      'be linked at another.',
  },
  {
    fromMajor: 1,
    toMajor: 2,
    slot: 'backend.onEntityRenamed',
    kind: 'slot-removed',
    summary:
      'Rename propagation reads the `ref` flag on the field that holds the ' +
      'reference. The three hooks this replaces were three spellings of one rule ' +
      '— rewrite the slug wherever the declaration says it is stored — and each ' +
      'had to re-derive its own table, column and JSON path by hand. A type now ' +
      'declares `ref: \'<type>\'` (or `ref: \'$type\'` for a polymorphic ref ' +
      'discriminated by a sibling `type` field) and the host repoints it.',
  },
  /**
   * 2 → 3. Where 1 → 2 moved BEHAVIOUR out of a type and into a declaration,
   * this crossing changes what the declaration must SAY and what a read of it
   * gives back. Every entry is mandatory work for a plugin author, and none has
   * a shim: a `title` cannot be invented for somebody else's entities, and a
   * projection cannot guess which of a type's fields were meant to be content.
   */
];

/** One slot changed WITHOUT crossing a major, during stabilization. */
export interface HostApiUnversionedChange {
  /** Release that made the change, e.g. "0.2.4". */
  release: string;
  /** The affected slot's path on the manifest / interface. */
  slot: string;
  /**
   * `slot-added` carries no obligation on a plugin author at all — it is here
   * because a surface that grew silently is a surface nobody knows they may
   * use, which is the additive twin of the failure the removals below record.
   */
  /**
   * `behaviour-changed` carries no slot change at all: the surface is identical
   * and the answer it gives is different. Recorded for the same reason as the
   * other two — a repair nobody can see is a repair nobody can reason about when
   * their data looks different after an upgrade.
   */
  kind: 'slot-removed' | 'slot-added' | 'behaviour-changed';
  /** Why it needed no bump, and what it replaces or enables. */
  summary: string;
}

/**
 * Changes made inside the current baseline without a version bump.
 *
 * This list exists because "no version bump" must never mean "no record". A
 * removal that nobody wrote down is strictly worse than a recorded breaking
 * change: the plugin author who eventually trips over it has nothing to read.
 *
 * Deliberately NOT part of {@link HOST_API_CHANGELOG}: that list is keyed by
 * major boundaries and drives `migrationsBetween`/`buildMigrationInfo`, so a
 * 1→1 entry there would surface as a migration instruction on a crossing that
 * never happened. These entries are documentation, not a migration path —
 * their whole point is that no migration is required.
 */
export const HOST_API_UNVERSIONED_CHANGES: readonly HostApiUnversionedChange[] = [
  {
    release: '0.2.4',
    slot: 'backend.crud.searchableFields',
    kind: 'slot-removed',
    summary:
      'Declarative narrowing of search scope. Removed together with ' +
      '`EntityCrudService.search?`: leaving either would let one type rank ' +
      'differently depending on which MCP tool asked. Search scope now has a ' +
      "single source — the text paths derived from `backend.crud.createSchema` — " +
      "with the agent's `fields` parameter as the only override. Both slots were " +
      'optional and had zero producers across the host repo, the preinstalled ' +
      'envelope and external packages; the sole occurrence was a test fixture. ' +
      'No action is required of any plugin.',
  },
  {
    release: '0.2.4',
    slot: 'EntityCrudService.search',
    kind: 'slot-removed',
    summary:
      'Per-type search implementation. Ranking belongs to the M39 core, which ' +
      'applies one order relation (exact > prefix > earlier substring position > ' +
      'slug ascending) to every type on every surface. A service ranking over ' +
      'columns the host cannot see could not honestly report `searchedFields`. ' +
      'The interface keeps the write path and the operations that cannot be ' +
      'derived from the composition descriptor.',
  },
  {
    release: '0.2.12',
    slot: 'MountContext.crud.writeCollectionWindow / MountContext.crud.mutateCollectionAxis',
    kind: 'slot-added',
    summary:
      'The point/range write and the axis insert/delete for a KEYED collection. ' +
      'Both operations were already specified (M39 tier C) and already ' +
      'implemented on the domain write-path, but no host-facing surface reached ' +
      'them: `crud.update` reconciles a supplied keyed collection replace-all, ' +
      'so a plugin could only change one cell by resending the whole grid — ' +
      'which loses the merge, and with it the guarantee that two writers to ' +
      'disjoint keys do not overwrite each other. This CLOSES that contract ' +
      'rather than opening a new one, which is why it is additive: no existing ' +
      'slot changes shape, no plugin needs to do anything, and a package built ' +
      'against 2.0.0 keeps loading. Per M33 an additive slot stays inside the ' +
      'current baseline while no external packages are published; once they are, ' +
      'the same class of change bumps the MINOR.',
  },
  {
    release: '0.2.12',
    slot: 'ScalarNode.integer / ScalarNode.min / ScalarNode.max',
    kind: 'slot-added',
    summary:
      'Numeric bounds on a `kind: \'number\'` leaf, applied by `crud-schema-gen` ' +
      'to the generated create/update shapes. Added because the declaration had ' +
      'no way to say "this is a count": a type carrying one had to either accept ' +
      '`-1` and `2.5` or hand-write the schema it was supposed to derive, and ' +
      'the first type to declare a keyed collection showed what that costs — an ' +
      'axis extent of `-1` makes every cell write and every axis insert refuse, ' +
      'so the row is created and is then unusable by construction. Optional and ' +
      'absent everywhere until declared, so no existing type changes shape. The ' +
      'flags are rejected at registration on a non-number leaf rather than ' +
      'ignored, because a constraint the author believes is enforced is worse ' +
      'than no constraint.',
  },
  {
    release: '0.2.12',
    slot: 'keyed collection — rows past an axis extent',
    kind: 'behaviour-changed',
    summary:
      'A keyed row whose coordinate exceeds its axis\'s declared extent is now ' +
      'removed when the entity is written, instead of lingering in the ' +
      'projection. Nothing else in the host believed such a row existed: the ' +
      'write door refuses that coordinate, an axis op refuses that position, ' +
      'and `collectionOverview` reports the grid FROM the extent columns rather ' +
      'than from MAX(coordinate). Only the projection disagreed — and because ' +
      'the snapshot reads the projection, those rows were being written into the ' +
      'entity FILE, so shrinking a grid did not survive a round trip and growing ' +
      'it back resurrected content the author had deleted. Reaching that state ' +
      'requires writing an out-of-extent coordinate through a path that does not ' +
      'validate (a restore, or a hand-edited file); no supported write produces ' +
      'one, which is why this is a repair rather than a semantic change.',
  },
  {
    release: '0.2.13',
    slot: 'ScalarNode.pattern',
    kind: 'slot-added',
    summary:
      'A regex a `kind: \'string\'` leaf must match, applied by `crud-schema-gen` ' +
      'to the generated create/update shapes. Added on the same argument as the ' +
      'numeric bounds: the declaration had no way to say "this value is an ' +
      'identifier", and after tier K deleted `backend.crud` there is no ' +
      'per-type schema left to say it in either — `EntityContribution` carries ' +
      'no validation hook at all. A source string, not a `RegExp`, because a ' +
      'declaration has to survive serialisation; applied with `.regex()`, which ' +
      'SEARCHES, so a caller anchors it. Rejected at registration on a ' +
      'non-string leaf, and rejected when it does not compile, so a typo cannot ' +
      'surface later as a throw from inside router construction. Optional and ' +
      'absent everywhere until declared, so no existing type changes shape.',
  },
  {
    release: '0.2.13',
    slot: 'ScalarNode.notReserved',
    kind: 'slot-added',
    summary:
      'Refuses a `kind: \'string\'` value that is a reserved SQL word, compared ' +
      'case-insensitively against `SQL_RESERVED_WORDS` — the list ' +
      '`data-schema-validation` already screened host-DERIVED identifiers with, ' +
      'hoisted to `shared/` so a caller-SUPPLIED value can be screened against ' +
      'the same copy. A separate slot rather than a `pattern` with a negative ' +
      'lookahead: a 123-alternative lookahead is unreviewable, is ' +
      'case-sensitive where the rule is not, and collapses "that word is ' +
      'reserved" into a generic shape mismatch that does not tell the author ' +
      'what to do. A flag rather than a list on the declaration, because a type ' +
      'transcribing its own copy drifts from the host on the first keyword the ' +
      'host adds.',
  },
  {
    release: '0.2.27',
    slot: "ScalarNode.kind (and the FieldNode discriminator, now `type`)",
    kind: 'slot-added',
    summary:
      'The value-constraint dictionary closes at three: `type: \'enum\'` + ' +
      '`values`, `maxLength`, and `kind: <name>` — a NAMED VALIDATOR resolved ' +
      'from a host registry (`named-validators`), whose only entry today is ' +
      '`sql-identifier` and whose first consumer is `database-table.title`. The ' +
      'name resolves to host CODE, not to an expression in the declaration: the ' +
      'type says which rule, the host knows what it means. It REPLACES ' +
      '`ScalarNode.pattern` and `ScalarNode.notReserved`, both removed here, and ' +
      'replaces them without reopening them — `minLength` and `pattern` are not ' +
      'in the dictionary and are not coming, so a field with a fixed format gets ' +
      'a named validator or nothing. Adding an entry to the registry is a Host ' +
      'API change on the same footing as adding a field flag, because the host ' +
      'has to learn to honour it. Enforced on the input schema through both ' +
      'external doors, never on a read, and never reaching DDL — like ' +
      '`maxLength`, and unlike `maxLength`, a migration over failing values must ' +
      'rewrite or refuse rather than truncate. The rename that made room for it ' +
      '(`FieldNode`\'s variant discriminator `kind` → `type`) is the same change ' +
      'seen from the declaration side: the specification always wrote ' +
      '`type: "enum"`, and the `kind`-discriminated union was implementation ' +
      'invention occupying a contract-reserved word. Absorbed into the 2.0.0 ' +
      'baseline under the stabilisation rule — no published plugins, so a ' +
      'breaking declaration change breaks nobody.',
  },
  {
    release: '0.2.27',
    slot: 'reserved `title` — floor, not ceiling',
    kind: 'behaviour-changed',
    summary:
      'A type may now declare NARROWING constraints beside the reserved title ' +
      'instead of matching the host declaration exactly, and may omit ' +
      '`computedDefault` entirely. The host still fixes `type: \'string\'`, ' +
      '`required: true` and `maxLength: 200`, and still refuses any attempt to ' +
      'drop or widen them; what changes is that "exactly this" becomes "at least ' +
      'this". Without it a type whose name IS its identifier could not say so, ' +
      'because the rule would have had to go on every other type\'s title or ' +
      'nowhere. A type with nothing to derive a title from declares no default ' +
      'and a write without one fails input validation, which is the honest ' +
      'outcome rather than a gap.',
  },
  {
    release: '0.2.13',
    slot: 'ref / onMissing on a nested or embedded field',
    kind: 'behaviour-changed',
    summary:
      'A dangling `ref` now warns wherever the declaration puts one, instead of ' +
      'only on a top-level scalar or the DIRECT field of a table-backed ' +
      'collection\'s item. Not a new slot — the flags already existed and were ' +
      'being silently ignored everywhere else, which is the failure mode the ' +
      'flag screening elsewhere in this file exists to prevent. The gap was the ' +
      'width of every embedded container: a ref inside an object inside an ' +
      'embedded value collection was invisible to `danglingScalarRefs` (which ' +
      'skipped collections outright) and to `syncProjectionTable` (which never ' +
      'runs for an embedded collection), so the reference dangled and every ' +
      'write reported clean. The walk is now shape-driven and deliberately the ' +
      'same recursion `ref-rewrite` uses for renames: a ref the rename path can ' +
      'repoint is a ref the warning path must be able to report, or the two ' +
      'disagree about what a reference IS. Table-backed collections are skipped ' +
      'here and still reported by `syncProjectionTable`, which also DROPS the ' +
      'row — walking both would double-report and then contradict itself.',
  },
  {
    release: '0.2.19',
    slot: 'contributes.skills',
    kind: 'slot-added',
    summary:
      'The fifth manifest slot: `PluginSkillContribution[]`, carrying skills of ' +
      'either scope. `contributes.writingStyles` becomes sugar over it — each ' +
      'entry is lowered to `scope: "writing-style"` and routed to the same ' +
      'SkillRegistry, producing an identical entry and identical selection ' +
      'behaviour, so the older slot keeps working unchanged. The asymmetry is in ' +
      'the other scope: a `scope: "contextual"` skill is attached ' +
      'unconditionally and in full to ALL FOUR context types, with no selector ' +
      'entry, no config opt-in, no opt-out and no way to narrow it to one type. ' +
      'Additive to the manifest, so no bump; `skills` joins the versioned ' +
      'surface beside `entities` / `writingStyles` / `settings` / `commands`.',
  },
  {
    release: '0.2.19',
    slot: 'FieldFlags.contentBearing',
    kind: 'slot-added',
    summary:
      'A field carrying bulk content rather than a value to compare. The host ' +
      'excludes it from all five generated views and emits `has<Field>: boolean` ' +
      '+ `<field>Bytes: number` in its place; the field stays in the snapshot ' +
      '(it is reproducible from the entity file and the projection invariant ' +
      'still binds it), and the delta reports it as `field_changed_opaque` with ' +
      'a `{ fromBytes, toBytes }` pair instead of two payloads nobody ' +
      'can read side by side. Two rules bind a declaring type: it may NOT also ' +
      'declare its own `views?` (the flag only has meaning for host-generated ' +
      'views, so the combination is rejected at load time), and it MUST expose ' +
      'the content through some declared operation — a field excluded from every ' +
      'view with no way to read it would be write-only data. Adding a flag to a ' +
      'closed dictionary is a Host API change precisely because a layer has to ' +
      'learn to honour it, but it is additive to the declaration shape.',
  },
  {
    release: '0.2.19',
    slot: 'injection (SKILL.md frontmatter, SkillMetadata, WritingStyleContribution)',
    kind: 'slot-removed',
    summary:
      'Forcing a skill into the prompt was never a property of the skill — it is ' +
      'a property of the writing-style SLOT, of which there is exactly one per ' +
      'prompt. With `injection` gone, a prompt carries at most one ' +
      '`<project_skill/>` block (the active writing style) in each of the four ' +
      'context types, and every other skill rides `inlineSkills` for the model ' +
      'to open on demand. Legacy frontmatter carrying `injection` is IGNORED, ' +
      'not rejected: the field is treated like any other unknown key, so an ' +
      'existing style neither fails to parse nor drops out of selection. ' +
      'Formally breaking, absorbed into the baseline under the same ' +
      'stabilization rule as the 0.2.4 removal above — zero published plugins ' +
      'means zero possible breakage. Once a third-party plugin is published, ' +
      'removals go back under the major-bump rule.',
  },
  {
    release: '0.2.31',
    slot: 'SerializationContribution.diff / EntityModule.diff / BackendModule.diff',
    kind: 'slot-removed',
    summary:
      'The last place a type could inject its own algorithm into the versioning ' +
      'path. The host now generates the semantic delta from the type\'s logical ' +
      'schema, matching elements of a value collection by a declared ' +
      '`collection: { kind: \'value\', identity, rekeyOn? }`. Five types shipped ' +
      'five mutually incompatible `changes` shapes; all are replaced by one ' +
      'closed dictionary of eight `DiffOp` operations under a `{ op, changes }` ' +
      'envelope, so no consumer branches per entity type any more. A manifest ' +
      'still declaring `diff` is REJECTED at registration rather than ignored — ' +
      'the envelope has no slot for it, so an unknown key does not pass quietly. ' +
      'There is no second diff mode: a type declaring no identity matches its ' +
      'elements BY INDEX, which is a decision (reordering IS a change), not a ' +
      'degradation. Formally breaking, absorbed into the 2.0.0 baseline under ' +
      'the same stabilization rule as the `injection` removal above — zero ' +
      'published plugins means zero possible breakage. The versioned surface ' +
      'stops naming the `diff` slot and starts naming the shape of `EntityDiff` ' +
      'as returned by `useVersionDiff`.',
  },
  {
    release: '0.2.31',
    slot: 'CollectionNode.collection (object form)',
    kind: 'slot-added',
    summary:
      'The flag gains an object spelling, `{ kind, identity?, rekeyOn? }`, ' +
      'alongside the bare `\'value\'` / `\'keyed\'` which stay legal — additive, ' +
      'not a migration. `identity` names ELEMENT fields the host matches on when ' +
      'computing a delta; `rekeyOn` is a proper non-empty prefix of it, feeding a ' +
      'second matching pass so that editing a key field returns as `item_rekeyed` ' +
      'rather than as a remove/add pair. Four rules are checked at registration ' +
      'and all reject loudly: an identity name absent from the item schema, a ' +
      'name resolving to a non-scalar or to a `contentBearing` field, a `rekeyOn` ' +
      'that is not a proper non-empty prefix, and an `identity` declared on a ' +
      'keyed collection (whose `keyFields` already ARE its identity). This is a ' +
      'new VALUE SHAPE for an existing flag, not a new entry in the closed flag ' +
      'dictionary.',
  },
  {
    release: '0.2.50',
    slot: 'SystemPromptContribution.promptBlocks',
    kind: 'slot-added',
    summary:
      'Full XML blocks a type contributes to the prompt\'s writing-conventions ' +
      'layer, emitted in `listEntities()` order and only while the type is ' +
      'active. `narrativeBlock` says what an entity IS in two or three sentences ' +
      'inside the shared `<entities>` block; this slot is for the other thing a ' +
      'type sometimes owns — a whole convention governing how the agent writes ' +
      'ABOUT it. The first migrant is `<diagram_references>`, which the core ' +
      'prompt builder emitted unconditionally, including for projects where the ' +
      '`diagram` type is not mounted, while the diagram\'s own `narrativeBlock` ' +
      'carried a pointer to it: one convention in two files, neither of which ' +
      'owned it. Purely additive — a manifest without the slot renders exactly ' +
      'as before. Note what was NOT removed in the same round: `mcpToolsLine` ' +
      'stopped feeding `<tooling>` (now derived from the servers actually ' +
      'mounted, post-gate) but stays on the surface, because five other ' +
      'subsystems read it as a declaration of the type\'s custom operations.',
  },
  {
    release: '0.2.51',
    slot: 'reserved `title` — `maxLength` is a default, not a constant',
    kind: 'behaviour-changed',
    summary:
      'The host\'s `maxLength: 200` on the reserved title stops being a number ' +
      'every type had to spell back verbatim and becomes the value a type gets ' +
      'when it declares none. A type that declares its own bound now gets it in ' +
      'EITHER direction — narrower or wider — where 0.2.27 admitted narrowing ' +
      'only, and only through the value-constraint dictionary rather than the ' +
      'number itself. `ac` is what forced it: with `text` and `description` ' +
      'collapsed into `title`, the criterion\'s own words ARE the instance\'s ' +
      'name, and 200 characters is a label bound applied to content. It declares ' +
      '500. ADDITIVE, INSIDE THE BASELINE, NO BUMP: every `data.schema` written ' +
      'before this release stays legal and means exactly what it meant, because ' +
      'they all declare 200 explicitly and 200 is still what 200 means. The new ' +
      'freedom is optional. Two things the inversion does NOT relax: `type: ' +
      '"string"` and `required: true` are still the host\'s and still ' +
      'unmovable, and the bound must stay below the read budget ' +
      '(`DEFAULT_BUDGET_CHARS`) — which is what turns "a title never needs ' +
      'shortening at read time" from a free consequence of 200 into a gate ' +
      'checked once at registration, statically, from the manifest. The two ' +
      'directions also do not cost the same: widening is additive and needs ' +
      'nothing, while narrowing invalidates values already on disk and must be ' +
      'carried by a `payloadUpgrades` step, which is where the type chooses ' +
      'between truncating and refusing. NOT A HOST API CHANGE, and worth saying ' +
      'because both numbers live in the same manifest: RETIRING A FIELD from a ' +
      'type is versioned by that type\'s `payloadVersion`, never by the surface ' +
      'version — `ac` dropping `text` and `description` in this same release ' +
      'moves its payload 2 → 3 and leaves `hostApiVersion` untouched.',
  },
];

/** First numeric component of a semver RANGE (e.g. "^1.4.0" → 1, ">=2.5.0" → 2). */
export function rangeMajor(range: string): number | null {
  const m = /(\d+)/.exec(range);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Changelog entries spanning the majors between (inclusive of the boundary crossings). */
export function migrationsBetween(fromMajor: number, toMajor: number): HostApiMigration[] {
  const [lo, hi] = fromMajor <= toMajor ? [fromMajor, toMajor] : [toMajor, fromMajor];
  return HOST_API_CHANGELOG.filter((m) => m.fromMajor >= lo && m.toMajor <= hi);
}

/**
 * Build the migration info for a plugin whose `hostApiVersion` RANGE targets a
 * different major than the running host. Returns `null` when the majors match
 * (no migration needed) or the range major is unparseable.
 */
export function buildMigrationInfo(pluginRange: string): PluginMigrationInfo | null {
  const pluginMajor = rangeMajor(pluginRange);
  const hostMajor = parseMajor(HOST_API_VERSION);
  if (pluginMajor == null || hostMajor == null || pluginMajor === hostMajor) return null;
  const migrations = migrationsBetween(pluginMajor, hostMajor);
  return {
    targetHostApiVersion: HOST_API_VERSION,
    migrations,
    /**
     * No shim without descriptors, and two kinds can never be shimmed:
     * `slot-required` (the author must implement it) and `slot-removed` (there
     * is nothing left to forward to). Shimming 2.0.0's removals would mean
     * inferring a logical schema from hand-written DDL — the exact inference the
     * release exists to stop making. Empty changelog ⇒ false.
     */
    shimAvailable:
      migrations.length > 0 &&
      migrations.every((m) => m.kind !== 'slot-required' && m.kind !== 'slot-removed'),
  };
}
