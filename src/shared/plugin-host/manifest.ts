/**
 * M33 — runtime plugin manifest contract.
 *
 * A plugin is an npm package that default-exports (or named-exports as
 * `manifest`) a {@link PluginManifest}. The host loader (`loadWorkspacePlugins`)
 * dynamic-imports each workspace-declared package, validates `hostApiVersion`
 * / `engines`, then fans `contributes.entities` out to `registerEntityModule`.
 *
 * This lives in `shared/` (not `server/`) because the external `c4s-reader`
 * and plugin authors need the contract without pulling in express /
 * better-sqlite3. Server-only payloads (the express Router, the L9 serializer)
 * are typed `unknown` here and narrowed server-side.
 */

import type { EntityModuleManifest, SystemPromptContribution } from './types.js';

/**
 * The Host API version this build advertises. Bumped on a breaking change to
 * any surface counted into the contract: the manifest / EntityModule
 * signatures, the `mountBackend(app, mcpHost, db, cwd)` mount-context shape,
 * the chip/card/row prop shapes, the L8 editor registration contract, the
 * prop contracts of the `stable` Host UI Kit components (M34/L12;
 * `@c4s/plugin-runtime/ui`), and — since 0.1.133 — the MCP builder FACADE:
 * the opaque `McpServerFactory` handle (return type of the `backend.mcpServer`
 * slot) plus the `createMcpServer` / `mcpTool` signatures re-exported from
 * `@c4s/plugin-runtime`. The vendor types behind that facade
 * (`@inharness-ai/agent-adapters`' `McpServerConfig` / `McpServerInstance`) are
 * deliberately NOT part of the surface. See `UI_KIT_STABLE_COMPONENTS` in
 * `ui-kit-surface.ts`; `experimental` kit components are deliberately NOT part
 * of this surface.
 *
 * A plugin whose `hostApiVersion` range does not satisfy this version is
 * skipped with a warning (never crashed over) — on the backend during load and
 * independently on the frontend during manifest consumption.
 *
 * Versioning rule — only a breaking slot-shape change bumps the version, and it
 * bumps the MAJOR (with a descriptor in the changelog — see `host-api.ts`); the
 * loader gate compares majors only. A plugin built against a different major is
 * reported `incompatible` with a migration descriptor (vs the environment-level
 * `skipped` for an `engines` miss).
 *
 * `1.0.0` baseline — the Host UI Kit catalog + `stable` prop contracts
 * (`@c4s/plugin-runtime/ui`, M34/L12) shipped WITHIN this major, so they are
 * folded into the `1.0.0` versioned surface rather than bumping it; no major has
 * been crossed, so the changelog stays empty.
 *
 * M13 (0.1.113) — the declarative backend surface (`service`/`crud`/`routes`/
 * `mcpServer` slots, `EntityCrudService`/`BaseEntityCrudService`,
 * `SystemPromptContribution.mcpToolsLine` becoming optional) is an additive
 * extension of the `1.0.0` contract: new optional slots, no shape change to
 * anything a plugin already depended on (the `mount` escape hatch is
 * unchanged). Per the qualification rule above, additive-within-baseline
 * during stabilization (no published third-party plugins yet) does not bump
 * the version — it is simply folded into what `1.0.0` now covers, same as the
 * Host UI Kit precedent.
 *
 * MCP facade (0.1.133) — the qualification rule applies as follows:
 *   - ADDING the facade (re-exporting the `createMcpServer` / `mcpTool` values +
 *     defining the opaque `McpServerFactory` handle) is additive within the
 *     `1.0.0` baseline — no bump (same stabilization precedent as M13).
 *   - Bumping the vendor `@inharness-ai/agent-adapters` behind the facade is NOT
 *     a Host API surface change and does NOT bump `hostApiVersion`, as long as
 *     the facade shape (the `createMcpServer` / `mcpTool` signatures and the
 *     `McpServerFactory` contract) is preserved. This is the whole point of the
 *     facade: it decouples the Host API major from vendor dependency churn.
 *   - A `hostApiVersion` MAJOR bumps only when the facade shape itself changes.
 *
 * 0.2.4 — three changes, none of which bumps the version:
 *   - The COMPOSITION DESCRIPTOR (`EntityModuleManifest.composition`) is a new
 *     optional slot beside the old `table` field; a manifest without one gets an
 *     equivalent descriptor synthesized from `table` + `backend.auxTables`.
 *     Additive within the baseline, same precedent as M13.
 *   - `SystemPromptContribution.countStat` goes from REQUIRED to optional and
 *     its `sqlQuery` is no longer executed. Required→optional is an additive
 *     relaxation: no plugin stops compiling or loading. The behaviour change
 *     (who counts, and under what label) belongs to M05, not to this contract.
 *   - REMOVING `backend.crud.searchableFields` and `EntityCrudService.search?`
 *     is the one genuine removal of the round. Formally a breaking shape
 *     change; factually not, since both were optional and had zero producers.
 *     It does NOT bump the major during stabilization — but it DOES carry a
 *     mandatory changelog entry (see `HOST_API_CHANGELOG` in `host-api.ts`),
 *     because an unrecorded removal is worse than a recorded breaking change.
 *
 * Why the descriptor in particular stays additive rather than bumping: the
 * semver gate `continue`s BEFORE `registerPlugin`, so raising the major would
 * reject every external package wholesale — including ones that never touched
 * any of these slots. The cost is asymmetric, and it favours the additive form.
 *
 * 0.2.19 — three changes, none of which bumps the version (all three carry a
 * `HOST_API_UNVERSIONED_CHANGES` entry — see `host-api.ts`):
 *   - `contributes.skills` joins `entities` / `writingStyles` / `settings` /
 *     `commands` on the versioned surface — the fifth manifest slot, additive.
 *   - the `contentBearing` field flag joins the closed `FieldFlags` dictionary;
 *     adding a flag is a Host API change precisely because the host must learn
 *     to honour it, but it is additive to the declaration shape.
 *   - `injection` is REMOVED from the skill vocabulary. Formally breaking, and
 *     absorbed into the baseline under the same stabilization rule as the 0.2.4
 *     removal above: zero published plugins, so nothing can break. Once a first
 *     third-party plugin is published, removals go back under the major rule.
 *
 * 0.2.22 / 0.2.23 — the baseline STAYS at `2.0.0`, and this is the correction.
 *
 * 0.2.22 raised it to `3.0.0` on the reasoning that two of its changes were not
 * additive by any reading: `title` became a required field (a manifest without
 * one stops loading) and `contentBearing` was REDEFINED rather than extended.
 * Both readings are right about the shape and wrong about the conclusion. The
 * stabilisation rule that absorbed 0.2.4's and 0.2.19's removals applies here
 * unchanged: `2.0.0` is not published and has not one external plugin consumer,
 * so a major bump protects nobody and only rejects the packages in this repo.
 * The specification names `2.0.0` as the current baseline in every place it
 * mentions one; the bump was implementation invention, and it is reverted.
 *
 * Absorbed into the baseline, therefore, rather than raising it: the reserved
 * `title`; the redefined `contentBearing` (and the lifted ban on a type
 * declaring its own views beside the flag, which 0.2.23 makes moot by removing
 * views entirely); the `select` projection in place of the `view` axis; the
 * VALUE CONSTRAINT vocabulary (`enum` + `values`, `maxLength`); the
 * `slugPattern` grammar being SHARED with `computedDefault`, minus `nanoid(n)`;
 * and the removal of the `views?` slot itself.
 *
 * Once a first third-party plugin is published, all of this goes back under the
 * major rule — that is the condition the stabilisation window depends on, not a
 * property of the changes.
 *
 * 0.2.50 — `SystemPromptContribution.promptBlocks` joins the slot, and the
 * baseline stays at `2.0.0`. This is the plain additive case the rule was
 * written for: a new OPTIONAL field on an existing contribution, read only when
 * present, with every existing manifest continuing to load and render exactly as
 * before. No shape a plugin already depended on changes.
 *
 * Note what did NOT happen in the same round, because it is the more instructive
 * half: `mcpToolsLine` was a candidate for REMOVAL (the prompt's `<tooling>`
 * block stopped reading it, which was its original purpose). It stays, because
 * "the prompt no longer reads it" turned out not to mean "nothing reads it" —
 * five other subsystems consume it as a declaration of the type's custom
 * operations. A slot is retired when its last consumer goes, not when its first
 * one does; the doc comment on the field now says which consumers remain.
 */
export const HOST_API_VERSION = '2.0.0';

/** Node/host engine constraints — checked by the loader before registration. */
export interface PluginEngines {
  /** semver range matched against `process.versions.node`. */
  node?: string;
  [key: string]: string | undefined;
}

/**
 * Authoring shape for one contributed entity type. A superset of the shared
 * {@link EntityModuleManifest} carrying the slots the host needs to lower it
 * into a server `BackendModule`. The express Router (`backend.routes`) and the
 * L9 serializer are typed `unknown` here so the shared bundle stays dep-free;
 * the registry narrows them at registration time.
 */
export interface EntityContribution extends EntityModuleManifest {
  /**
   * L9 — ordered payload migration chain (server
   * `SerializationContribution['payloadUpgrades']`).
   *
   * 0.2.24 — this is declared DIRECTLY on the type. The `serializer` object that
   * used to hold it is gone: with `snapshot`, `restore`, `views`, `schema` and
   * `version` all derived, the container had nothing left to group. 0.2.31 took
   * the last of its company, the `diff` slot — a manifest still carrying that
   * key is now REJECTED at registration rather than ignored.
   */
  payloadUpgrades?: unknown;

  /** M05 — system prompt contribution composed by buildSystemPrompt. */
  systemPrompt: SystemPromptContribution;

  backend?: {
    /**
     * ESCAPE HATCH — full-power imperative mount hook (server `PluginMountFn`).
     * A typical plugin does not write this; declare `service`/`routes`/
     * `mcpServer` instead and the host synthesizes an equivalent mount. When
     * present, `mount` takes precedence over the declarative slots below (they
     * are ignored).
     */
    mount?: unknown;
    /**
     * M13 — L2 service factory (server `(ctx: MountContext) => EntityCrudService`).
     * Instantiated by the host EXACTLY ONCE per `ProjectContext`; the same
     * instance is then visible in DI (`ctx.registerEntityService`), in the
     * generic `entity-tools` CRUD registry, and as the argument passed to the
     * `routes`/`mcpServer` factories below (referential identity).
     */
    service?: unknown;
    /*
     * 2.0.0 — `crud` was REMOVED. Every active type has CRUD by construction and
     * its input schemas are generated from `data.schema` (create omits
     * `systemManaged`/`localSurrogate`, update is partial and tri-state). The
     * slot outlived its handling by two releases: the server stopped copying it
     * into the lowered module, so a manifest still declaring one was silently
     * ignored while this type went on advertising it to plugin authors.
     */
    /**
     * A factory receiving the SAME service instance as `mcpServer`
     * (server `(service, ctx) => Router`), mounted at `pathPrefix`. ALWAYS a
     * factory — never a bare Router (express's `Router` type is itself
     * callable, so a `Router | (fn)` union can't be discriminated at
     * runtime). A plugin with no service dependency just ignores the args.
     */
    routes?: {
      router: unknown;
    };
    /**
     * M13 — factory for a CUSTOM MCP server carrying ONLY this type's
     * non-standard tools (e.g. `link_dto`/`unlink_dto`); CRUD tools belong
     * exclusively to `entity-tools`, never to a per-type server. Registered as
     * `${type}-tools`. Omit when the type has no custom tools — no server is
     * mounted in that case. 0.1.133: the slot returns the MCP server HANDLE
     * directly — the result of `createMcpServer(...)`, published as the opaque
     * C4S facade `McpServerFactory` — NOT a `() => instance` thunk; per-turn
     * freshness is host-owned. Typed `unknown` here (like `service`/`crud`/
     * `routes`) so the dep-free shared bundle carries no vendor type; the
     * server registry narrows it to `(service, ctx) => McpServerFactory`.
     */
    mcpServer?: unknown;
    /*
     * 2.0.0 — `auxTables` was REMOVED along with `table`. Junctions and side
     * indexes are derived from `data.schema` (a collection with `keyFields`
     * projects to its own table), so there is nothing left for a module to
     * declare. Unlike `crud` this one is REJECTED at registration, and the
     * declaration surviving here made the published type contradict the loader.
     */
    /*
     * 2.0.0 — `onEntityRenamed` was REMOVED. Declare `ref: '<type>'` on the
     * field that holds the reference and the host repoints it; see the
     * `HOST_API_CHANGELOG` entry.
     */
  };

  /** L8 — client editor extensions + render slots (narrowed client-side). */
  frontend?: unknown;
}

/**
 * The four interaction types a turn can have — the plugin-author-facing spelling
 * of the host's `ChatContextType`.
 *
 * Spelled out here rather than imported from `shared/entities.ts`: this module is
 * the contract a plugin author compiles against and must not drag in the host's
 * deps. It used to be written inline at each use site, which made it invisible as
 * a concept; two slots now select on it (`PluginSubagentContribution.contextTypes`
 * and `PluginSkillContribution.contextTypes`), so it is worth a name.
 */
export type ContextType = 'chat' | 'brief' | 'patch' | 'ask';

/**
 * 0.2.19 (M37) — authoring shape for one contributed SKILL, the generalisation of
 * {@link WritingStyleContribution}. A plugin carries the skill inline (body +
 * optional attached files) rather than dropping a SKILL.md dir on disk;
 * discovery is by push at load time (the loader fans these into the per-project
 * SkillRegistry as `source: "plugin"`), not by FS scan.
 *
 * `scope` is what makes this more than a rename, and the two values are NOT
 * symmetric:
 *
 *   - `'writing-style'` — offered in the M15 selector, and at most ONE of them
 *     ever reaches a prompt: the one named by `config.writingStyle`. A plugin
 *     contributing three of these shows three choices and injects zero or one.
 *   - `'contextual'` — listed in `<available_skills>` with no selector entry and
 *     no config opt-in. WHICH turns it is listed in is the package's own call
 *     since 0.2.66, declared through {@link PluginSkillContribution.contextTypes};
 *     omitting the field still means all four. The other brakes are the
 *     `trustProjectPlugins` gate and the fact that a user-authored skill of the
 *     same slug overrides the body.
 *
 * Either way a plugin skill only ever rides the listing — it never earns a
 * `<project_writing_skill>` block, which since 0.2.19 belongs to the
 * writing-style slot alone.
 *
 * 0.2.66: this is the ONLY way a `scope: 'contextual'` skill enters the registry.
 * The FS roots admit writing styles and nothing else, and the in-package
 * `bundled` root that used to carry `writing-style-author` no longer exists — so
 * a contextual skill is a package's contribution by construction, not by
 * convention.
 */
export interface PluginSkillContribution {
  /** Stable identifier; also the dedup key against user/other-plugin skills. */
  slug: string;
  title: string;
  description: string;
  /** Positive integer; mirrors SKILL.md frontmatter `version`. */
  version: number;
  language: 'en' | 'pl';
  /** See the asymmetry note above — this is the load-bearing field. */
  scope: 'writing-style' | 'contextual';
  /**
   * 0.2.66 — which context types this skill appears in on the `<available_skills>`
   * listing. OMISSION MEANS ALL FOUR, which is the opposite default to
   * {@link PluginSubagentContribution.contextTypes}; the asymmetry is priced by
   * the cost of guessing wrong, one listing line against a whole delegated turn.
   *
   * The field NARROWS DISCOVERY, NOT ACCESS. A skill absent from this turn's
   * listing stays openable by `load_skill_file(slug)` — the filter runs when the
   * listing is built and nowhere else, so the listing never becomes a permission
   * boundary.
   *
   * `contextTypes` is the host's concept (the enum, the resolver's predicate, the
   * default); the VALUE belongs to the package. That is the whole of the change:
   * the envelope says where it wants to appear, instead of the host holding a map
   * of where to pin it.
   *
   * An element outside the enum costs the ENTRY, not the envelope: the loader
   * warns and skips this contribution, and the package's other contributions
   * register normally.
   */
  contextTypes?: ContextType[];
  /** The skill body markdown (the SKILL.md content without frontmatter). */
  content: string;
  /** The rest of the package keyed by rel path (e.g. `workflows/brief.md`). */
  files?: Record<string, string>;
}

/**
 * Authoring shape for one contributed writing style (M15). A plugin carries the
 * style inline (body + optional attached files) rather than dropping a SKILL.md
 * dir on disk — discovery is by push at load time (the loader fans these into
 * the per-project SkillRegistry as `source: "plugin"`), not by FS scan.
 *
 * 0.2.19: this is now SUGAR over {@link PluginSkillContribution} — the loader
 * lowers each entry to one with `scope: 'writing-style'` and routes it into the
 * same registry, so the two slots produce an identical entry and identical
 * selection behaviour.
 */
export interface WritingStyleContribution {
  /** Stable identifier; also the dedup key against user styles. */
  slug: string;
  title: string;
  description: string;
  /** Positive integer; mirrors SKILL.md frontmatter `version`. */
  version: number;
  language: 'en' | 'pl';
  /** The skill body markdown (the SKILL.md content without frontmatter). */
  content: string;
  /** Optional attached files (templates/examples/workflows), keyed by rel path. */
  files?: Record<string, string>;
}

/**
 * M33 — one settings field a plugin renders in its own Settings section
 * (panel M26), values stored under `config.plugins[<manifest.name>][key]`.
 * `kind` drives the reload classification on write:
 *   - `hot-reload` → only `invalidateQueries(['config'])`, no context rebuild
 *     (parity with `writingStyle` / `language`; takes effect next turn/thread).
 *   - `executive` → invalidates the `ProjectContext` (rebuild, no banner, no
 *     restart).
 */
export interface PluginSettingField {
  /** Stable field key inside the plugin's config namespace. */
  key: string;
  /** Human label shown in the Settings panel. */
  label: string;
  control: 'toggle' | 'text' | 'select' | 'multiselect';
  kind: 'hot-reload' | 'executive';
  /** Default applied when `config.plugins[<name>][key]` is absent. */
  default: unknown;
  /** Choices for `select` / `multiselect` controls. */
  options?: { value: string; label: string }[];
  /** Optional help/description text. */
  help?: string;
}

/** A plugin's settings module = an ordered list of fields. */
export type PluginSettingsModule = PluginSettingField[];

/**
 * M33 — declarative editor slash-command contributed by a plugin
 * (typically an entity-less one). The loader normalizes each entry into an
 * `EditorExtensionRegistration.slashCommand` and routes it through
 * `registerEditorExtension(...)` — the SAME path as entity-borne extensions.
 * Declarative, not imperative: the plugin declares the trigger + popover to
 * open; execution is the editor framework's popover dispatch, not plugin code.
 * Kept as a dep-free subset here (the full `EditorExtensionRegistration` lives
 * client-side); `popoverKind` is narrowed against the client `PopoverMap`.
 */
export interface PluginCommandContribution {
  /** Stable registration name (unique within the editor extension registry). */
  name: string;
  /** Slash trigger token, e.g. "mychart". */
  trigger: string;
  /** Menu label shown in the slash palette. */
  label: string;
  /** Popover kind dispatched on invoke (client `PopoverKind`). */
  popoverKind: string;
  /**
   * What the command does, shown beside the label in the palette. Defaults to
   * the label, which renders as the same text twice.
   *
   * 0.2.2 — added because the host's hardcoded `/endpoint` and `/dto` entries
   * carried one ("Create a new endpoint inline") and a declarative command had
   * no way to. When those two types moved into an envelope the palette row
   * degraded to `/dto  /dto  /dto`, which is not a description of anything.
   */
  description?: string;
  /** Argument hint, e.g. `METHOD /path`. Defaults to `/<trigger>`. */
  hint?: string;
  /** Editor contexts the command is available in. Omitted = all contexts. */
  availableIn?: string[];
}

/**
 * M33/M05 — one programmatic subagent a plugin contributes to a turn.
 *
 * Deliberately NARROWER FIELD-BY-FIELD than the library's `SubagentDefinition`:
 * every field here is either the plugin's own prose or a SELECTION over a set
 * the host enumerates — never a raw permission literal. The host validates each
 * entry at fan-out, dedupes by `name`, sanitizes `tools`, and prepends its own
 * prompt frame before anything reaches `adapter.execute({ subagents })`.
 *
 * NOT sugar over `skills`: a different registry, a different consumer, and a
 * different moment of resolution. A contextual skill costs a line of listing in
 * every prompt; a subagent costs a WHOLE TURN with its own model whenever
 * auto-delegation by `description` lands on it — and that routing cannot be
 * switched off.
 */
export interface PluginSubagentContribution {
  /**
   * Agent type the model invokes. No prefix is enforced — namespacing belongs
   * to distribution, not to the envelope. The host dedupes deterministically
   * (first by discovery order wins) and reserves its own built-in names.
   */
  name: string;
  /**
   * STEERS AUTO-DELEGATION — the host does not rewrite it. This prose is the
   * whole routing surface, so it should say when to delegate, not what the
   * subagent is.
   */
  description: string;
  /**
   * BODY of the prompt. The host prepends its own frame (spec language, the
   * no-mutation rule, the findings-reporting contract, the ban on reaching for
   * another context's entry primitives); a plugin cannot skip or rewrite it.
   */
  promptBody: string;
  /**
   * Which turns this subagent is offered in. OMISSION MEANS `['chat']`, not
   * "everywhere" — a plugin that meant to reach `brief` adds one field and
   * learns so from the docs, whereas one that reached it by oversight would
   * pollute brief composition with no opt-out available to the user.
   *
   * Contrast {@link PluginSkillContribution.contextTypes}, whose omission means
   * ALL FOUR. The two defaults differ by the cost of the mistake: a subagent
   * reached by auto-delegation spends a whole turn and a model, a skill spends
   * one line of a listing.
   */
  contextTypes?: ContextType[];
  /**
   * SELECTION over the host's delegable tool set — never a grant. Passes
   * through the host's sanitizer, which subtracts the non-delegable primitives
   * (`Agent`/`Task`, `Skill`, `runTransagent`) and every mutating MCP tool. An
   * unknown or subtracted entry is dropped with a warning; the turn still
   * starts.
   */
  tools: string[];
  /** Slugs from the internal skill registry; the host verifies each exists. */
  attachInternalSkills?: string[];
  /**
   * CLOSED enum. `model` goes to the SDK verbatim, bypassing the model
   * catalogue, so an arbitrary literal is a turn-failure vector rather than
   * merely a cost one. Omitted = inherit the parent's model.
   */
  model?: 'sonnet' | 'haiku';
  effort?: 'low' | 'medium' | 'high';
  /** A PROPOSAL: the host clamps it to a ceiling of 20 rather than throwing. */
  maxTurns?: number;
}

/**
 * The default export of a plugin package. `contributes` is the capability
 * bundle: `contributes.entities`, `contributes.skills` and its sugar
 * `contributes.writingStyles` (both pushed into the SkillRegistry as
 * `source: "plugin"`), and `contributes.settings` / `contributes.commands`.
 */
export interface PluginManifest {
  /** npm package name. */
  name: string;
  /** plugin semver. */
  version: string;
  /** semver range — which Host API the plugin targets, e.g. "^1.0.0". */
  hostApiVersion: string;
  /** node/host engine constraints. */
  engines?: PluginEngines;
  /**
   * OPTIONAL teardown hook — for the plugin's OWN resources only: a timer, a
   * watcher, an open connection. Those can be allocated in exactly one place,
   * the imperative `backend.mount`, which is invisible to the host and so is
   * reachable by nothing else. A package using only declarative slots does not
   * declare this at all.
   *
   * It is NOT how a plugin's capability comes down. Entity types, commands,
   * settings and skills are unwired by the HOST — `registry.unregisterPlugin(name)`
   * fanning out over the envelope's `contributedTypes[]`, plus the
   * `ProjectContext` rebuild for the mounted side (Express routes, MCP
   * factories, DI services). An `onUnregister` that tries to unwire any of that
   * is a BUG: it duplicates the host's work.
   *
   * The hot-reload pipeline calls it on the OLD version, before the host-owned
   * `unregisterPlugin`. Should be idempotent; a throw is logged as a warning and
   * never blocks the reload — in particular it cannot hold up the host's step.
   *
   * 0.2.29: degraded from required to optional. Additive, so `HOST_API_VERSION`
   * stays `2.0.0` and there is no `migrations[]` entry.
   */
  onUnregister?(): void;
  contributes: {
    entities?: EntityContribution[];
    /**
     * 0.2.19 (M37) — skills contributed by this plugin, of either scope. The
     * fifth slot; `writingStyles` below is sugar over it.
     */
    skills?: PluginSkillContribution[];
    /** M15 — writing styles contributed by this plugin (sugar for `skills` with `scope: 'writing-style'`). */
    writingStyles?: WritingStyleContribution[];
    /** M33 — settings fields rendered per-plugin in Settings (M26). */
    settings?: PluginSettingsModule;
    /** M33 — declarative editor slash-commands (entity-less plugins). */
    commands?: PluginCommandContribution[];
    /**
     * M33/M05 — programmatic subagents contributed to a turn. Read by PULL at
     * turn-build time via `subagentsFor(contextType)`, after validation and
     * sanitizing; there is no push and therefore no teardown step — dropping
     * the source is enough, and the contribution is gone from the NEXT turn
     * without a session restart.
     */
    subagents?: PluginSubagentContribution[];
    /**
     * 0.2.15 — `referenceTypes` is GONE. A plugin envelope no longer contributes
     * XML reference tags at all; the enumeration of envelope capabilities is
     * `entities` plus the three above. An entity is embedded through the generic
     * M19 tags dispatched on `type=`, and brings its appearance through the
     * `renderChip` / `renderCard` / `renderRow` render slots instead.
     *
     * Deliberately NOT a `HOST_API_VERSION` bump: a 2.x plugin that still
     * declares the field keeps loading, and the declaration is simply inert.
     */
  };
}

/** One plugin's Settings section, as returned by `ProjectPluginHost.listSettings()`. */
export interface PluginSettingsSection {
  /** Plugin package name — also the `config.plugins` namespace key. */
  name: string;
  version: string;
  fields: PluginSettingsModule;
}

/**
 * Parse the major component of a clean semver string (e.g. "1.4.0" -> 1).
 * Used for the cheap major-mismatch gate on the frontend, mirroring the
 * backend's `semver.satisfies` check. Returns `null` for unparseable input.
 */
export function parseMajor(version: string): number | null {
  const match = /^\s*v?(\d+)\./.exec(version);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isFinite(major) ? major : null;
}
