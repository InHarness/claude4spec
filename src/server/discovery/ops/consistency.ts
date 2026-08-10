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
import { parseXmlTagsExcludingCode, taggedListVia } from '../../../shared/xml-tags.js';
import { getExtensionReferenceType } from '../../../shared/reference-extensions.js';
import { parseHeadings } from '../../services/section-indexer.js';
import { invalidArgument } from '../errors.js';
import { classifyVerifies } from '../../entities/ac/classify-verifies.js';
import { readActiveAcs } from '../../entities/ac/read-acs.js';
import type { PageSource } from '../page-source.js';
import type { RootSet } from '../roots.js';
import type { CheckConsistencyInput, ConsistencyReport, DiscoveryDeps } from '../types.js';

interface BrokenReferenceRow {
  rootId: string;
  pagePath: string;
  tagType: string;
  type: string;
  slug: string;
  line: number;
  category: 'broken-reference' | 'inactive-plugin' | 'unknown-type';
}

/**
 * The rule catalogue, as data. `rule` accepts either the number or the name, so
 * an agent that read the report can filter by what it saw without a lookup
 * table of its own.
 */
const RULES: Record<string, { id: number; bucket: string }> = {
  'broken-reference': { id: 1, bucket: 'brokenReferences' },
  'inactive-plugin': { id: 2, bucket: 'brokenReferences' },
  'tag-driven-reference': { id: 3, bucket: 'unreferencedEntities' },
  'broken-extension-reference': { id: 8, bucket: 'brokenExtensionReferences' },
  'broken-ac-verify': { id: 9, bucket: 'brokenAcVerifies' },
  'entity-without-ac-coverage': { id: 10, bucket: 'entitiesWithoutAcCoverage' },
  'module-without-ac': { id: 11, bucket: 'modulesWithoutAc' },
  'unknown-type': { id: 12, bucket: 'brokenReferences' },
  'invalid-tag-reference': { id: 4, bucket: 'invalidTagReferences' },
  'duplicate-anchor': { id: 13, bucket: 'duplicateAnchors' },
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

function bucketsFor(rule: string | number | undefined): Set<string> | null {
  if (rule === undefined) return null;
  const entries = Object.entries(RULES).filter(
    ([name, def]) => name === String(rule) || def.id === Number(rule),
  );
  if (!entries.length) {
    throw invalidArgument(
      `unknown rule '${String(rule)}'`,
      `rule accepts a number or a name: ${Object.entries(RULES)
        .map(([name, def]) => `${def.id} (${name})`)
        .join(', ')}`,
    );
  }
  return new Set(entries.map(([, def]) => def.bucket));
}

export async function checkConsistency(
  deps: DiscoveryDeps,
  pages: PageSource,
  roots: RootSet,
  input: CheckConsistencyInput = {},
): Promise<ConsistencyReport> {
  const wanted = bucketsFor(input.rule);
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
  const knownAnchors = new Set(
    (deps.db.prepare('SELECT anchor FROM section_index').all() as Array<{ anchor: string }>).map(
      (r) => r.anchor,
    ),
  );

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

  const categorise = (type: string): BrokenReferenceRow['category'] | 'active' => {
    if (host.getEntity(type)) return 'active';
    if (host.getAvailable(type)) return 'inactive-plugin';
    return 'unknown-type';
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

  for (const root of scanned) {
    for (const page of await pages.readAll([root])) {
      allPagePaths.push({ rootId: root.id, path: page.path });
      if (sectionIndexedIds.has(root.id)) collectAnchors(anchorOccurrences, root.id, page);
      for (const tag of parseXmlTagsExcludingCode(page.body)) {
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
                category,
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
                category: 'broken-reference',
              });
          }
        }

        if (tag.kind === 'tagged_list' || tag.kind === 'tagged_list_mixed') {
          for (const t of (tag.attrs.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
            if (!tagSlugs.has(t))
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

        if (tag.source === 'extension') {
          if (tag.kind === 'section_ref') {
            // Section rules apply only where sections exist. Gated on the root
            // PROPERTY — a root with no index has no anchor space to validate
            // against, which is not the same as having a broken anchor.
            if (!root.sectionIndexed) continue;
            const anchor = tag.attrs.anchor ?? '';
            if (!anchor || !knownAnchors.has(anchor)) {
              brokenExtensionReferences.push({
                rootId: root.id,
                pagePath: page.path,
                tagType: tag.kind,
                attrs: tag.attrs,
                line: tag.line,
                category: 'unknown-anchor',
              });
            }
          } else {
            const extType = getExtensionReferenceType(tag.kind);
            if (!extType?.validate) continue;
            const result = extType.validate(tag.attrs);
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
  if (acModule) {
    const config = readConfig(deps.projectDir);
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

    if (requireModuleAc !== 'off') {
      const moduleRe = /modules\/(m\d{2})-[^/]+\.md$/;
      const modules = new Set<string>();
      for (const p of allPagePaths) {
        const m = moduleRe.exec(p.path);
        if (m?.[1]) modules.add(m[1]);
      }
      const tagged = new Set<string>();
      for (const ac of activeAcs) for (const t of ac.tags) if (/^m\d{2}$/.test(t)) tagged.add(t);
      for (const mod of modules) if (!tagged.has(mod)) modulesWithoutAc.push({ module: mod, severity: requireModuleAc });
    }
  }

  // Section-indexed roots the reference sweep above did NOT cover.
  for (const root of roots.sectionIndexed()) {
    if (scanned.some((r) => r.id === root.id)) continue;
    for (const page of await pages.readAll([root])) collectAnchors(anchorOccurrences, root.id, page);
  }

  const duplicateAnchors = [...anchorOccurrences.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([anchor, occurrences]) => ({ anchor, occurrences }))
    .sort((a, b) => a.anchor.localeCompare(b.anchor));

  const buckets: Record<string, unknown[]> = {
    brokenReferences,
    duplicateAnchors,
    orphanedEntityTags: [],
    unreferencedEntities,
    invalidTagReferences,
    brokenExtensionReferences,
    brokenAcVerifies,
    entitiesWithoutAcCoverage,
    modulesWithoutAc,
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
  const errors =
    brokenReferences.length +
    invalidTagReferences.length +
    brokenExtensionReferences.length +
    duplicateAnchors.length +
    acErrors;
  const warnings = unreferencedEntities.length + acWarnings;

  const report: ConsistencyReport = {
    brokenReferenceCounts: countBy(brokenReferences, (r) => r.category),
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
    if (wanted && !wanted.has(name)) {
      report[name] = [];
      continue;
    }
    const kept = input.severity ? rows.filter((row) => severityOf(name, row) === input.severity) : rows;
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

/**
 * Rule 13 — one anchor, two headings.
 *
 * An anchor is an identity: `get_sections({ anchors })`,
 * `list_sections({ by: "anchor" })` and `<section_ref anchor="…"/>` all assume it
 * names exactly one section. A duplicate makes every reference to it ambiguous.
 *
 * The evidence comes from the PAGE TEXT, not from `section_index`. It cannot come
 * from the index: `anchor` is UNIQUE there, so by the time a duplicate reaches
 * the table one of the two occurrences has already been discarded — the index is
 * the one place where the collision is guaranteed to be invisible.
 *
 * Occurrences are resolved by the INDEXER'S OWN `parseHeadings`, not by a second
 * matcher written to look equivalent. Two implementations of "which anchor
 * belongs to which heading" are two answers, and they fail in opposite
 * directions: a stricter rule misses real collisions (an anchor comment the
 * indexer accepts mid-sentence above a heading), a looser one reports prose as a
 * defect (the `xxxxxxxx` placeholder on the pages that DOCUMENT the anchor
 * format — a false positive this rule actually produced against the real
 * specification). Sharing the function makes the two agree by construction —
 * the same lesson as B10 in this release, one layer down.
 */
function collectAnchors(
  into: Map<string, AnchorOccurrence[]>,
  rootId: string,
  page: { path: string; body: string },
): void {
  for (const h of parseHeadings(page.body.split('\n'))) {
    if (h.anchor === null) continue;
    const list = into.get(h.anchor) ?? [];
    list.push({
      rootId,
      pagePath: page.path,
      line: (h.anchorLineIndex ?? h.lineIndex) + 1,
      heading: h.text,
    });
    into.set(h.anchor, list);
  }
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const k = key(row);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
