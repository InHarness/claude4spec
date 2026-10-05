/**
 * M39 — `check_consistency`, moved out of the MCP transport into the core.
 *
 * It used to live inside `reference-tools`, which made a rule set the property
 * of one transport and bound the sweep to a SINGLE page root — the built-in
 * one, because that is the `PagesService` that server happened to hold. Here it
 * iterates every `referenceValidated` root, and the section rules are gated per
 * root on `sectionIndexed` rather than on any root's identity.
 *
 * This is also the right home for "what does the disk say that the index does
 * not" — that question is a consistency rule, not a mode hidden in a listing
 * operation.
 *
 * Filters are new (`severity`, `rule`, `limit`) and none of them may hide the
 * truth: `summary` always carries FULL counts, so a truncated report still says
 * how much was truncated. Calling it with no arguments still returns everything.
 */

import { readConfig, type ConsistencySeverity } from '../../config.js';
import { parseXmlTags, taggedListVia } from '../../../shared/xml-tags.js';
import { getXmlTag } from '../../../shared/xml-markup/registry.js';
import { anchorLineIndexOf, parseSections } from '../../../shared/section-parser.js';
import { invalidArgument } from '../errors.js';
import { classifyVerifies, readActiveAcs } from './ac-rules.js';
import type { PageSource } from '../page-source.js';
import type { RootSet } from '../roots.js';
import type { CheckConsistencyInput, ConsistencyReport, DiscoveryDeps } from '../types.js';

/**
 * Rule 14 — a tag nobody embeds.
 *
 * NOT `orphanedEntityTags`, which is rule 2 and means something else entirely:
 * an `entity_tag` row pointing at a slug that no longer exists — a dangling
 * ASSIGNMENT. This is the opposite end of the same edge: the assignment is
 * sound, the far side is what is missing. Folding the two into one bucket would
 * give a reader two unrelated defects under one name.
 */
interface TagWithoutConsumerRow {
  tag: string;
  /** How many entities carry it — the size of the edit if the tag is retired. */
  entityCount: number;
  severity: ConsistencySeverity;
}

/**
 * 2.0.0 — rules 1, 5, 6 (and 12) are separate rules of the catalogue with
 * different detection conditions, but their rows land in ONE list, told apart
 * by `reason`: `missing` (rule 1 — no such entity), `inactive` (rule 5 — the
 * type's plugin is not active), `unknown` (rule 6 — no such type). Until 2.0.0
 * they were three report categories distinguished by text.
 */
export type BrokenReferenceReason = 'missing' | 'inactive' | 'unknown';

interface BrokenReferenceRow {
  rootId: string;
  pagePath: string;
  tagType: string;
  type: string;
  slug: string;
  line: number;
  reason: BrokenReferenceReason;
}

interface RuleDef {
  id: number;
  bucket: string;
  /** For rules sharing a bucket: which rows are this rule's. Absent = every row. */
  rows?: (row: Record<string, unknown>) => boolean;
}

/**
 * The rule catalogue (2.0.0: 1–16), as data. `rule` accepts the number or any
 * of the names below, so an agent that read the report can filter by what it
 * saw without a lookup table of its own. Pre-2.0.0 names stay accepted as
 * aliases of the rule they now belong to.
 */
const RULES: Record<string, RuleDef> = {
  'broken-reference': { id: 1, bucket: 'brokenReferences', rows: (r) => r.reason === 'missing' },
  'orphaned-entity-tag': { id: 2, bucket: 'orphanedEntityTags' },
  'unreferenced-entity': { id: 3, bucket: 'unreferencedEntities' },
  'tag-driven-reference': { id: 3, bucket: 'unreferencedEntities' },
  'invalid-tag-reference': { id: 4, bucket: 'invalidTagReferences' },
  'inactive-plugin-reference': { id: 5, bucket: 'brokenReferences', rows: (r) => r.reason === 'inactive' },
  'inactive-plugin': { id: 5, bucket: 'brokenReferences', rows: (r) => r.reason === 'inactive' },
  'unknown-type-reference': { id: 6, bucket: 'brokenReferences', rows: (r) => r.reason === 'unknown' },
  'unknown-type': { id: 6, bucket: 'brokenReferences', rows: (r) => r.reason === 'unknown' },
  'unanchored-heading': { id: 7, bucket: 'unanchoredHeadings' },
  'broken-section-ref': { id: 8, bucket: 'brokenExtensionReferences' },
  'broken-extension-reference': { id: 8, bucket: 'brokenExtensionReferences' },
  'broken-ac-verify': { id: 9, bucket: 'brokenAcVerifies' },
  'entity-without-ac-coverage': { id: 10, bucket: 'entitiesWithoutAcCoverage' },
  'module-without-ac': { id: 11, bucket: 'modulesWithoutAc' },
  /**
   * Rule 12 is a GUARANTEE rather than a detector: a reference to a hidden type
   * (`diagram`, `code-snippet` — types without routes/detail panel of their own)
   * is validated exactly like any other, resolving its type from the tag's
   * `type` attribute, and lands in `brokenReferences` under the same three
   * reasons. The server carries no "hidden" flag to split on (hiddenness is a
   * frontend-slot property), so selecting rule 12 selects the whole list its
   * rows share with rules 1/5/6.
   */
  'hidden-type-reference': { id: 12, bucket: 'brokenReferences' },
  'duplicate-anchor': { id: 13, bucket: 'duplicateAnchors' },
  'tag-without-consumer': { id: 14, bucket: 'tagsWithoutConsumer' },
  'anchor-line-in-code': { id: 15, bucket: 'anchorLinesInCode' },
  'unclosed-code-block': { id: 16, bucket: 'unclosedCodeBlocks' },
};

/** Buckets whose every row is an error, regardless of configuration. */
const ERROR_BUCKETS = new Set([
  'brokenReferences',
  'invalidTagReferences',
  'brokenExtensionReferences',
  'brokenAcVerifies',
  'duplicateAnchors',
]);

/**
 * The severity of ONE row.
 *
 * The AC-coverage buckets carry a per-row `severity` taken from config
 * (`'error' | 'warn' | 'off'`), so they are neither wholly errors nor wholly
 * warnings. Filtering them at bucket granularity made `severity: 'error'` hand
 * back an empty list while `summary.errors` still counted those very rows —
 * a report that contradicts its own summary is worse than no filter at all.
 */
function severityOf(bucket: string, row: unknown): 'error' | 'warning' {
  if (ERROR_BUCKETS.has(bucket)) return 'error';
  const declared = (row as { severity?: string } | null)?.severity;
  if (declared === 'error') return 'error';
  // `warn` (the config spelling) and everything else — an unreferenced entity
  // has no per-row severity and has always been a warning.
  return 'warning';
}

/** The selected rules, or null when `rule` was not given. */
function rulesFor(rule: string | number | undefined): RuleDef[] | null {
  if (rule === undefined) return null;
  const entries = Object.entries(RULES).filter(
    ([name, def]) => name === String(rule) || def.id === Number(rule),
  );
  if (!entries.length) {
    const byId = new Map<number, string[]>();
    for (const [name, def] of Object.entries(RULES)) byId.set(def.id, [...(byId.get(def.id) ?? []), name]);
    throw invalidArgument(
      `unknown rule '${String(rule)}'`,
      `rule accepts a number 1–16 or a name: ${[...byId]
        .sort((a, b) => a[0] - b[0])
        .map(([id, names]) => `${id} (${names.join(' | ')})`)
        .join(', ')}`,
    );
  }
  // Dedupe by id: aliases select the same rule.
  const seen = new Set<number>();
  return entries.map(([, def]) => def).filter((def) => !seen.has(def.id) && seen.add(def.id));
}

export async function checkConsistency(
  deps: DiscoveryDeps,
  pages: PageSource,
  roots: RootSet,
  input: CheckConsistencyInput = {},
): Promise<ConsistencyReport> {
  const wanted = rulesFor(input.rule);
  const host = deps.host;
  const reader = deps.reader;

  // Type scope comes from `reader.hasTable`, not from a hardcoded list of core
  // types: a plugin-contributed type has rows and references like any other,
  // and skipping it meant its broken references were simply never reported.
  const entitiesByType: Record<string, string[]> = {};
  const slugSets: Record<string, Set<string>> = {};
  const referenced: Record<string, Set<string>> = {};
  const entityTags: Record<string, Map<string, Set<string>>> = {};
  for (const module of host.listEntities()) {
    if (!reader.hasTable(module.type)) continue;
    const slugs = reader.listSlugs(module.type);
    entitiesByType[module.type] = slugs;
    slugSets[module.type] = new Set(slugs);
    referenced[module.type] = new Set();
    entityTags[module.type] = new Map(
      slugs.map((slug) => [slug, new Set(reader.getEntity(module.type, slug)?.tags ?? [])]),
    );
  }
  const tagSlugs = new Set(reader.listTags().map((t) => t.slug));
  /**
   * Rule 8 (2.0.0) asks the current project's `SectionsService` directly — the
   * process-wide `validate` callback a `section_ref` extension could carry never
   * could answer it, since an anchor is only valid against ONE project's index.
   * A rig without a service reads the same table.
   */
  const anchorExists =
    deps.sections !== undefined
      ? (anchor: string) => deps.sections!.has(anchor)
      : (() => {
          const known = new Set(
            (deps.db.prepare('SELECT anchor FROM section_index').all() as Array<{ anchor: string }>).map(
              (r) => r.anchor,
            ),
          );
          return (anchor: string) => known.has(anchor);
        })();

  /**
   * Every tag slug NAMED by a `tagged_list` / `tagged_list_mixed` embed, filled
   * by the same attribute walk that feeds `invalidTagReferences` below. Rule 14
   * is the complement of that set against the tags entities actually carry, so
   * it costs one `Set` and no extra pass over the pages.
   */
  const consumedTags = new Set<string>();

  const brokenReferences: BrokenReferenceRow[] = [];
  const invalidTagReferences: Array<{ rootId: string; pagePath: string; tagType: string; tag: string; line: number }> = [];
  const brokenExtensionReferences: Array<{
    rootId: string;
    pagePath: string;
    tagType: string;
    attrs: Record<string, string>;
    line: number;
    category: string;
  }> = [];

  const categorise = (type: string): BrokenReferenceReason | 'active' => {
    if (host.getEntity(type)) return 'active';
    if (host.getAvailable(type)) return 'inactive';
    return 'unknown';
  };

  const scanned = roots.referenceValidated();
  const allPagePaths: Array<{ rootId: string; path: string }> = [];

  /**
   * Rule 13's evidence is collected INSIDE this sweep rather than by a second
   * pass. `PageSource.readAll` has no cache, and the two root sets overlap
   * almost entirely in practice, so a separate scan meant reading the whole
   * specification off disk twice on every consistency check. The counts still
   * have to be exact regardless of the `rule` filter — `summary` promises full
   * numbers — so the answer is to read once, not to skip when filtered.
   */
  const sectionIndexedIds = new Set(roots.sectionIndexed().map((r) => r.id));
  const anchorOccurrences = new Map<string, AnchorOccurrence[]>();
  const structure: StructureRows = { unanchoredHeadings: [], anchorLinesInCode: [], unclosedCodeBlocks: [] };

  for (const root of scanned) {
    for (const page of await pages.readAll([root])) {
      allPagePaths.push({ rootId: root.id, path: page.path });
      collectStructure(structure, anchorOccurrences, root.id, sectionIndexedIds.has(root.id), page);
      for (const tag of parseXmlTags(page.body)) {
        // 0.2.15 — the entity type comes from `type=` and nowhere else. The
        // branch that derived it from a registered extension tag's name is
        // gone with the tags that needed it; an extension tag now names no
        // entity, so it can never enter this arm.
        const tagType = tag.attrs.type;
        if (tag.kind !== 'tagged_list_mixed' && tagType) {
          const category = categorise(tagType);
          const slugs =
            tag.kind === 'element_list'
              ? (tag.attrs.slugs ?? '').split(',').map((s) => s.trim()).filter(Boolean)
              : tag.attrs.slug
                ? [tag.attrs.slug]
                : [];
          if (category !== 'active') {
            for (const slug of slugs) {
              brokenReferences.push({
                rootId: root.id,
                pagePath: page.path,
                tagType: tag.kind,
                type: tagType,
                slug,
                line: tag.line,
                reason: category,
              });
            }
            continue;
          }
          const set = slugSets[tagType];
          if (!set) continue;
          for (const slug of slugs) {
            if (set.has(slug)) referenced[tagType]?.add(slug);
            else
              brokenReferences.push({
                rootId: root.id,
                pagePath: page.path,
                tagType: tag.kind,
                type: tagType,
                slug,
                line: tag.line,
                reason: 'missing',
              });
          }
        }

        if (tag.kind === 'tagged_list' || tag.kind === 'tagged_list_mixed') {
          for (const t of (tag.attrs.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
            // Recorded BEFORE the existence check: an embed naming a tag that
            // does not exist is already reported as rule 4, and counting it as a
            // consumer too would report the same page twice under two names.
            if (tagSlugs.has(t)) consumedTags.add(t);
            else
              invalidTagReferences.push({ rootId: root.id, pagePath: page.path, tagType: tag.kind, tag: t, line: tag.line });
          }
          const candidateTypes =
            tag.kind === 'tagged_list' ? (tag.attrs.type ? [tag.attrs.type] : []) : Object.keys(entityTags);
          for (const t of candidateTypes) {
            const tagMap = entityTags[t];
            const seen = referenced[t];
            if (!tagMap || !seen) continue;
            for (const [slug, tags] of tagMap) {
              if (taggedListVia(tag, t, tags).length > 0) seen.add(slug);
            }
          }
        }

        if (tag.kind === 'section_ref') {
          // Rule 8 — M06's own check: the tag is registered WITHOUT `validate`
          // (an anchor is valid only against one project's section index), so
          // it is verified here, against the current context. Section rules
          // apply only where sections exist: a root with no index has no
          // anchor space to validate against, which is not a broken anchor.
          if (!root.sectionIndexed) continue;
          const anchor = tag.attrs.anchor ?? '';
          if (!anchor || !anchorExists(anchor)) {
            brokenExtensionReferences.push({
              rootId: root.id,
              pagePath: page.path,
              tagType: tag.kind,
              attrs: tag.attrs,
              line: tag.line,
              category: 'unknown-anchor',
            });
          }
          continue;
        }

        // A tag whose validity is a pure function of its attributes declares
        // `validate` in the M51 registry; run it here.
        const validate = getXmlTag(tag.kind)?.validate;
        if (validate) {
          const result = validate(tag.attrs);
          if (!result.ok) {
            brokenExtensionReferences.push({
              rootId: root.id,
              pagePath: page.path,
              tagType: tag.kind,
              attrs: tag.attrs,
              line: tag.line,
              category: result.category,
            });
          }
        }
      }
    }
  }

  const unreferencedEntities: Array<{ type: string; slug: string }> = [];
  for (const [type, slugs] of Object.entries(entitiesByType)) {
    const seen = referenced[type];
    if (!seen) continue;
    for (const slug of slugs) if (!seen.has(slug)) unreferencedEntities.push({ type, slug });
  }

  const brokenAcVerifies: Array<{ acSlug: string; verifyType: string; verifySlug: string; category: string }> = [];
  const entitiesWithoutAcCoverage: Array<{ type: string; slug: string; severity: ConsistencySeverity }> = [];
  const modulesWithoutAc: Array<{ module: string; severity: ConsistencySeverity }> = [];

  /**
   * Rules 9-11 are AC rules by definition, so this is the one place the core
   * resolves that type by name. It resolves the MODULE — which is also the
   * activity check, since `getEntity` returns null for an inactive type — so the
   * "AC does not need AC coverage of itself" exemption below can compare module
   * identity instead of re-hardcoding the literal a second time.
   *
   * 2.0.0 tier K: this used to reach `getEntityService('ac')` and cast it to a
   * two-method interface declared right here. Both methods outlived the service:
   * `listRaw({status:'active'})` is `readActiveAcs(reader)` (which takes the
   * `active` default from `ac`'s own `defaultPredicate` rather than restating
   * it), and `classifyVerifies` is a free function over the host.
   */
  const acModule = host.getEntity('ac');
  const config = readConfig(deps.projectDir);
  if (acModule) {
    const requireAcCoverage = config.consistency.requireAcCoverage;
    const requireModuleAc = config.consistency.requireModuleAc;
    const activeAcs = readActiveAcs(reader);

    for (const ac of activeAcs) {
      for (const broken of classifyVerifies(host, ac.verifies)) {
        brokenAcVerifies.push({
          acSlug: ac.slug,
          verifyType: broken.type,
          verifySlug: broken.slug,
          category: broken.reason,
        });
      }
    }

    if (requireAcCoverage !== 'off') {
      const coveredByVerifies = new Set<string>();
      const coveredByTag = new Set<string>();
      for (const ac of activeAcs) {
        for (const v of ac.verifies) coveredByVerifies.add(`${v.type}:${v.slug}`);
        for (const t of ac.tags) if (t.startsWith('entity-')) coveredByTag.add(t.slice('entity-'.length));
      }
      for (const [type, slugs] of Object.entries(entitiesByType)) {
        // AC coverage OF the AC type is circular, so the type that carries the
        // coverage is exempt from needing it.
        if (type === acModule?.type) continue;
        for (const slug of slugs) {
          if (coveredByVerifies.has(`${type}:${slug}`) || coveredByTag.has(slug)) continue;
          entitiesWithoutAcCoverage.push({ type, slug, severity: requireAcCoverage });
        }
      }
    }

    /**
     * The ONE rule bound to a specific root, and deliberately so. Every other
     * rule iterates roots without knowing their names; this one asks "does
     * module MNN have a criterion", and the `M{NN}` numbering is a convention of
     * the `pages` root alone — the `plugins` root carries entity-type pages,
     * which are tagged `entity-{type}` and were never numbered. Sweeping every
     * root here would invent modules out of any root that happened to hold a
     * `modules/mNN-*.md`, then report them all as uncovered.
     *
     * The binding is this predicate and nothing else: the rest of the sweep
     * above stays root-agnostic. It is expressed as the `builtin` PROPERTY
     * rather than `rootId === 'pages'` — same set of roots, but it keeps the
     * rule readable as "the root the host ships" and honours the no-identity-
     * branches rule the root module states.
     */
    if (requireModuleAc !== 'off') {
      const moduleRe = /modules\/(m\d{2})-[^/]+\.md$/;
      const modules = new Set<string>();
      for (const p of allPagePaths) {
        if (!roots.get(p.rootId)?.builtin) continue;
        const m = moduleRe.exec(p.path);
        if (m?.[1]) modules.add(m[1]);
      }
      const tagged = new Set<string>();
      for (const ac of activeAcs) for (const t of ac.tags) if (/^m\d{2}$/.test(t)) tagged.add(t);
      for (const mod of modules) if (!tagged.has(mod)) modulesWithoutAc.push({ module: mod, severity: requireModuleAc });
    }
  }

  /**
   * Rule 14 — tags carried by entities that no embed selects on.
   *
   * OFF unless configured, and off is the default: a tag is also a plain filter
   * axis for `list_entities({tags})` and for an author's own searches, so "no
   * embed names it" is a smell, not a broken edge. Projects that have adopted
   * the convention — a tag is assigned where it has a consumer — turn it on and
   * get the stale ones listed; projects that have not stay silent.
   *
   * TWO SHAPES OF TAG ARE EXEMPT, because their consumer is a rule rather than
   * an embed: `entity-{slug}` on an AC is what rule 10 reads as coverage, and
   * `mNN` on an AC is what rule 11 reads as a module's criterion. Reporting them
   * would be the rule contradicting its own report two buckets down — and the
   * exemption is unconditional, because those tags mean what they mean whether
   * or not rules 10/11 are switched on to say so.
   */
  const tagsWithoutConsumer: TagWithoutConsumerRow[] = [];
  const requireTagConsumer = config.consistency.requireTagConsumer;
  if (requireTagConsumer !== 'off') {
    const acTagMap = acModule ? entityTags[acModule.type] : undefined;
    const ruleConsumed = new Set<string>();
    for (const tags of acTagMap?.values() ?? []) {
      for (const t of tags) if (t.startsWith('entity-') || /^m\d{2}$/.test(t)) ruleConsumed.add(t);
    }
    const carriers = new Map<string, number>();
    for (const tagMap of Object.values(entityTags)) {
      for (const tags of tagMap.values()) {
        for (const t of tags) carriers.set(t, (carriers.get(t) ?? 0) + 1);
      }
    }
    for (const [tag, entityCount] of [...carriers].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (consumedTags.has(tag) || ruleConsumed.has(tag)) continue;
      // A tag an entity carries that the tag registry never declared is a
      // dangling ASSIGNMENT — M18's orphan rule, not this one. Reporting it here
      // would tell an author to find a consumer for a tag that does not exist.
      if (!tagSlugs.has(tag)) continue;
      tagsWithoutConsumer.push({ tag, entityCount, severity: requireTagConsumer });
    }
  }

  // Section-indexed roots the reference sweep above did NOT cover.
  for (const root of roots.sectionIndexed()) {
    if (scanned.some((r) => r.id === root.id)) continue;
    for (const page of await pages.readAll([root])) {
      collectStructure(structure, anchorOccurrences, root.id, true, page);
    }
  }

  /**
   * Rule 2 — an `entity_tag` row whose entity no longer exists (a dangling
   * ASSIGNMENT). The other end of rule 14's edge: there the assignment is sound
   * and the consumer is missing; here the assignment points at nothing.
   * `tag_slug` is a FK with ON DELETE CASCADE, so a missing TAG cannot orphan a
   * row — only a missing entity can. A type whose table the reader does not
   * hold (inactive / unknown) is outside the sweep, like every other rule.
   */
  const orphanedEntityTags: Array<{ entityType: string; entitySlug: string; tagSlug: string }> = [];
  for (const row of deps.db
    .prepare('SELECT entity_type, entity_slug, tag_slug FROM entity_tag ORDER BY entity_type, entity_slug, tag_slug')
    .all() as Array<{ entity_type: string; entity_slug: string; tag_slug: string }>) {
    const set = slugSets[row.entity_type];
    if (!set || set.has(row.entity_slug)) continue;
    orphanedEntityTags.push({ entityType: row.entity_type, entitySlug: row.entity_slug, tagSlug: row.tag_slug });
  }

  const duplicateAnchors = [...anchorOccurrences.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([anchor, occurrences]) => ({ anchor, occurrences }))
    .sort((a, b) => a.anchor.localeCompare(b.anchor));

  const buckets: Record<string, unknown[]> = {
    brokenReferences,
    duplicateAnchors,
    orphanedEntityTags,
    unanchoredHeadings: structure.unanchoredHeadings,
    anchorLinesInCode: structure.anchorLinesInCode,
    unclosedCodeBlocks: structure.unclosedCodeBlocks,
    unreferencedEntities,
    invalidTagReferences,
    brokenExtensionReferences,
    brokenAcVerifies,
    entitiesWithoutAcCoverage,
    modulesWithoutAc,
    tagsWithoutConsumer,
  };

  // Counts are taken BEFORE any filter or cut, so `summary` describes the
  // project rather than the slice of it that survived the arguments.
  const acErrors =
    brokenAcVerifies.length +
    entitiesWithoutAcCoverage.filter((e) => e.severity === 'error').length +
    modulesWithoutAc.filter((m) => m.severity === 'error').length;
  const acWarnings =
    entitiesWithoutAcCoverage.filter((e) => e.severity === 'warn').length +
    modulesWithoutAc.filter((m) => m.severity === 'warn').length;
  // Rule 14 carries its severity per row exactly like rules 10/11, so it splits
  // across both counters rather than belonging to either.
  const errors =
    brokenReferences.length +
    invalidTagReferences.length +
    brokenExtensionReferences.length +
    duplicateAnchors.length +
    acErrors +
    tagsWithoutConsumer.filter((t) => t.severity === 'error').length;
  // Rules 2, 7, 15, 16 are informational: warnings, never blocking a write.
  const warnings =
    unreferencedEntities.length +
    orphanedEntityTags.length +
    structure.unanchoredHeadings.length +
    structure.anchorLinesInCode.length +
    structure.unclosedCodeBlocks.length +
    acWarnings +
    tagsWithoutConsumer.filter((t) => t.severity === 'warn').length;

  const report: ConsistencyReport = {
    brokenReferenceCounts: countBy(brokenReferences, (r) => r.reason),
    brokenExtensionReferenceCounts: countBy(brokenExtensionReferences, (r) => `${r.tagType}:${r.category}`),
    brokenAcVerifyCounts: countBy(brokenAcVerifies, (r) => r.category),
    summary: { total: errors + warnings, errors, warnings },
    truncated: false,
  };

  /**
   * 0.2.15 — the cut is now REPORTED rather than left to be deduced.
   *
   * `limit` is a PER-BUCKET cap, and `summary` above counts the unfiltered
   * buckets, so a caller passing `limit: 10` against 50 broken references got
   * ten rows and a summary saying fifty — with nothing in the envelope saying
   * which of the two was the answer. The only way to notice was to compare the
   * counter against the array length, per bucket, which is a deduction a
   * consumer has to know to make and most did not: the report simply looked
   * complete and short.
   *
   * `rule` and `severity` are filters, not cuts, and deliberately do NOT set the
   * flag — a caller that asked for errors only got exactly what it asked for.
   */
  let truncated = false;
  for (const [name, rows] of Object.entries(buckets)) {
    const selecting = wanted?.filter((def) => def.bucket === name);
    if (selecting && selecting.length === 0) {
      report[name] = [];
      continue;
    }
    // A bucket shared by several rules (1/5/6/12 → brokenReferences) keeps the
    // rows of the SELECTED rules only.
    const ruled =
      selecting && !selecting.some((def) => def.rows === undefined)
        ? rows.filter((row) => selecting.some((def) => def.rows!(row as Record<string, unknown>)))
        : rows;
    const kept = input.severity ? ruled.filter((row) => severityOf(name, row) === input.severity) : ruled;
    if (input.limit !== undefined && kept.length > input.limit) truncated = true;
    report[name] = input.limit === undefined ? kept : kept.slice(0, input.limit);
  }
  report.truncated = truncated;

  return report;
}

interface AnchorOccurrence {
  rootId: string;
  pagePath: string;
  /** 1-based, within the page BODY — the same space `section_index` uses. */
  line: number;
  heading: string;
}

interface StructureRows {
  /** Rule 7. */
  unanchoredHeadings: Array<{ rootId: string; pagePath: string; line: number; heading: string }>;
  /** Rule 15. */
  anchorLinesInCode: Array<{ rootId: string; path: string; line: number; anchor: string }>;
  /** Rule 16. */
  unclosedCodeBlocks: Array<{ rootId: string; path: string; line: number }>;
}

/**
 * Rules 7, 13, 15 and 16 — one parse per page, and no scan of their own: they
 * read headings, anchors and diagnostics from the SHARED SECTION PARSER (M06),
 * the same one the indexer runs. Two implementations of "which anchor belongs
 * to which heading" are two answers, failing in opposite directions — a stricter
 * rule misses real collisions, a looser one reports prose (or a code sample) as
 * a defect. A heading-shaped or anchor-shaped line inside a code block is code:
 * it produces no rule 7 row and never counts toward rule 13.
 *
 * Rule 7 (headings without an anchor) and rule 13 (one anchor, two headings)
 * only mean something where anchors are minted, so they run on section-indexed
 * roots. Rule 13's evidence comes from the PAGE TEXT, not `section_index`:
 * `anchor` is UNIQUE there, so the index is the one place a collision is
 * guaranteed to be invisible.
 *
 * Rule 15 — an anchor-shaped line inside a code block DIRECTLY above a
 * heading-shaped line in that block (the trace of a failed injection); without
 * the heading line below it there is no row. Rule 16 — a fence or multi-line
 * HTML comment nothing closes, `line` being its opening line: it runs to the
 * end of the page, so every XML tag below it drops out of slug rewrites, rules
 * 1 and 3, find_references and the todo index (M51) — this row is how the
 * author learns that visibility was lost. Both are
 * informational and never block a write; both run on every scanned root.
 */
function collectStructure(
  rows: StructureRows,
  anchors: Map<string, AnchorOccurrence[]>,
  rootId: string,
  sectionIndexed: boolean,
  page: { path: string; body: string },
): void {
  const lines = page.body.split('\n');
  const parsed = parseSections(page.body, { frontmatter: false });
  if (sectionIndexed) {
    for (const sec of parsed.sections) {
      if (sec.anchor === null) {
        rows.unanchoredHeadings.push({ rootId, pagePath: page.path, line: sec.headingLine, heading: sec.heading });
        continue;
      }
      const list = anchors.get(sec.anchor) ?? [];
      list.push({
        rootId,
        pagePath: page.path,
        line: (anchorLineIndexOf(lines, sec) ?? sec.headingLine - 1) + 1,
        heading: sec.heading,
      });
      anchors.set(sec.anchor, list);
    }
  }
  for (const a of parsed.diagnostics.anchorLinesInCode) {
    if (a.adjacentToHeadingLine) rows.anchorLinesInCode.push({ rootId, path: page.path, line: a.line, anchor: a.anchor });
  }
  for (const u of parsed.diagnostics.unclosedCodeBlocks) {
    rows.unclosedCodeBlocks.push({ rootId, path: page.path, line: u.openLine });
  }
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const k = key(row);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
