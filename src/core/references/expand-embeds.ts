import { parseXmlTags, type XmlTag } from '../../shared/xml-tags.js';
import type {
  ExpandEmbedsOptions,
  ExpandEmbedsResult,
  ExpansionContext,
  ExpansionEntity,
  ExpansionListedEntity,
  ExpansionProjection,
  ResolvedEmbed,
} from './types.js';

/**
 * M19 — embed expansion (2.1.9, `t7mekve3`).
 *
 * Turns the reference markup of a markdown text into standalone text for a
 * reader who cannot walk the graph: an entity tag becomes what it points at, a
 * `section_ref` and a page link become the name of their target. The function
 * belongs to this module because this module gives the tags their meaning; a
 * caller brings only the text and the project context (`ExpansionContext`), and
 * decides what to do with the result.
 *
 * Boundaries (`gmjjzpkb`):
 *  - not a catalog operation — no channel of its own; `get_page` still returns
 *    the page as authored;
 *  - reads no files — the text comes from the caller;
 *  - removes neither anchor lines nor frontmatter — the input comes back with
 *    both untouched (tags inside the frontmatter block are not expanded either);
 *  - serverless — every read goes through the read-only collaborators of ONE
 *    project context, so a text expanded in project P reads P and nothing else.
 *
 * Tags are recognised by the markup module's parser (`parseXmlTags`), never by
 * the editor's.
 */
export async function expandEmbeds(
  text: string,
  ctx: ExpansionContext,
  options: ExpandEmbedsOptions,
): Promise<ExpandEmbedsResult> {
  const fmEnd = frontmatterEnd(text);
  const tags = parseXmlTags(text).filter((t) => t.start >= fmEnd);

  // ── Entity reads, grouped per (type, projection) ──────────────────────────
  // Chips and lists go with the empty projection, a card with the full record.
  // One read per group, so a text with many tags is not a cascade of
  // single-slug reads.
  const groups = new Map<string, { type: string; projection: ExpansionProjection; slugs: Set<string> }>();
  const want = (type: string, projection: ExpansionProjection, slugs: string[]) => {
    const key = `${type}\u0000${projection}`;
    const group = groups.get(key) ?? { type, projection, slugs: new Set<string>() };
    for (const slug of slugs) group.slugs.add(slug);
    groups.set(key, group);
  };
  for (const tag of tags) {
    const type = tag.attrs.type;
    if (!type) continue;
    if (tag.kind === 'inline_mention' && tag.attrs.slug) want(type, 'empty', [tag.attrs.slug]);
    else if (tag.kind === 'single_element' && tag.attrs.slug) want(type, 'full', [tag.attrs.slug]);
    else if (tag.kind === 'element_list') want(type, 'empty', splitList(tag.attrs.slugs));
  }

  const records = new Map<string, Map<string, ExpansionEntity | null>>();
  const groupErrors = new Map<string, string>();
  for (const [key, group] of groups) {
    const bySlug = new Map<string, ExpansionEntity | null>();
    try {
      const rows = await ctx.readEntities(group.type, [...group.slugs], group.projection);
      for (const row of rows) bySlug.set(row.slug, row.entity);
    } catch (err) {
      groupErrors.set(key, err instanceof Error ? err.message : String(err));
    }
    records.set(key, bySlug);
  }
  const lookup = (
    type: string,
    projection: ExpansionProjection,
    slug: string,
  ): { error: string } | { entity: ExpansionEntity } => {
    const key = `${type}\u0000${projection}`;
    const failed = groupErrors.get(key);
    if (failed) return { error: failed };
    const entity = records.get(key)?.get(slug) ?? null;
    return entity ? { entity } : { error: `${type} '${slug}' not found` };
  };

  const resolved: ResolvedEmbed[] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const push = (entry: ResolvedEmbed, replacement: string | null) => {
    resolved.push(entry);
    if (replacement !== null && entry.error === undefined) {
      replacements.push({ start: entry.start, end: entry.end, text: replacement });
    }
  };
  const base = (tag: XmlTag) => ({ kind: tag.kind, raw: tag.raw, start: tag.start, end: tag.end, line: tag.line });

  for (const tag of tags) {
    const type = tag.attrs.type;
    switch (tag.kind) {
      case 'inline_mention': {
        const slug = tag.attrs.slug;
        if (!type || !slug) {
          push({ ...base(tag), error: 'inline_mention needs type and slug' }, null);
          break;
        }
        const hit = lookup(type, 'empty', slug);
        if ('error' in hit) push({ ...base(tag), error: hit.error }, null);
        else push({ ...base(tag), data: { type, slug, entity: hit.entity } }, renderMention(hit.entity, slug));
        break;
      }
      case 'single_element': {
        const slug = tag.attrs.slug;
        if (!type || !slug) {
          push({ ...base(tag), error: 'single_element needs type and slug' }, null);
          break;
        }
        const hit = lookup(type, 'full', slug);
        if ('error' in hit) push({ ...base(tag), error: hit.error }, null);
        else
          push(
            { ...base(tag), data: { type, slug, entity: hit.entity } },
            renderCard(type, slug, hit.entity, tag.attrs.caption),
          );
        break;
      }
      case 'element_list': {
        const slugs = splitList(tag.attrs.slugs);
        if (!type) {
          push({ ...base(tag), error: 'element_list needs type' }, null);
          break;
        }
        const entities: ExpansionEntity[] = [];
        const errors: string[] = [];
        // In the order of `slugs`, as the author wrote them.
        for (const slug of slugs) {
          const hit = lookup(type, 'empty', slug);
          if ('error' in hit) errors.push(hit.error);
          else entities.push(hit.entity);
        }
        if (errors.length > 0) push({ ...base(tag), error: errors.join('; ') }, null);
        else
          push(
            { ...base(tag), data: { type, entities } },
            renderTable(entities.map((e) => ({ type, slug: e.slug, title: labelOf(e, e.slug) }))),
          );
        break;
      }
      case 'tagged_list':
      case 'tagged_list_mixed': {
        const listType = tag.kind === 'tagged_list' ? type : undefined;
        if (tag.kind === 'tagged_list' && !listType) {
          push({ ...base(tag), error: 'tagged_list needs type' }, null);
          break;
        }
        const tagSlugs = splitList(tag.attrs.tags);
        const filter: 'and' | 'or' = tag.attrs.filter === 'or' ? 'or' : 'and';
        // Lists by tags come from the listing by tags, not from reads by slug.
        let entities: ExpansionListedEntity[];
        try {
          entities = tagSlugs.length === 0 ? [] : await ctx.listByTags({ type: listType, tags: tagSlugs, filter });
        } catch (err) {
          push({ ...base(tag), error: err instanceof Error ? err.message : String(err) }, null);
          break;
        }
        push(
          { ...base(tag), data: { ...(listType ? { type: listType } : {}), tags: tagSlugs, filter, entities } },
          renderTable(entities, tag.kind === 'tagged_list_mixed'),
        );
        break;
      }
      case 'section_ref': {
        const anchor = tag.attrs.anchor;
        const heading = anchor ? await ctx.sectionHeading(anchor) : null;
        if (!heading) push({ ...base(tag), error: `unknown section anchor '${anchor ?? ''}'` }, null);
        else push({ ...base(tag), data: { anchor, heading } }, heading);
        break;
      }
      default:
        // A registered tag this module gives no meaning to (todo, …) stays as is.
        break;
    }
  }

  // ── Page links — replaced by the target page's title ─────────────────────
  const taken = tags.map((t) => [t.start, t.end] as const);
  for (const link of ctx.findPageLinks(text)) {
    if (link.start < fmEnd) continue;
    if (taken.some(([s, e]) => link.start < e && link.end > s)) continue;
    const title = await ctx.pageTitle(link, options.source);
    const entry: ResolvedEmbed = { kind: 'page_link', raw: link.raw, start: link.start, end: link.end, line: lineOf(text, link.start) };
    if (title) {
      push({ ...entry, data: { targetPath: link.targetPath, title } }, title);
    } else if (link.syntax !== 'backticks') {
      // A backtick path that resolves to no page is code, not a broken link.
      push({ ...entry, error: `unresolved page link '${link.targetPath}'` }, null);
    }
  }

  resolved.sort((a, b) => a.start - b.start);
  if (options.format === 'json') return { format: 'json', text, resolved };

  replacements.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const r of replacements) {
    if (r.start < cursor) continue;
    out += text.slice(cursor, r.start) + r.text;
    cursor = r.end;
  }
  out += text.slice(cursor);
  return { format: 'inline', text: out, resolved };
}

/** Offset just past a leading `---` frontmatter block, or 0. */
function frontmatterEnd(text: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? m[0].length : 0;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** The label is the entity's `title` field — never a per-type hardcode. */
function labelOf(entity: ExpansionEntity, slug: string): string {
  return typeof entity.title === 'string' && entity.title.trim() ? entity.title : slug;
}

function renderMention(entity: ExpansionEntity, slug: string): string {
  const label = labelOf(entity, slug);
  return typeof entity.href === 'string' && entity.href ? `[${label}](${entity.href})` : label;
}

const CARD_SKIPPED_FIELDS = new Set(['slug', 'title', 'href']);

function renderCard(type: string, slug: string, entity: ExpansionEntity, caption: string | undefined): string {
  const lines = [`**${labelOf(entity, slug)}** (${type} \`${slug}\`)`];
  if (caption) lines.push('', `_${caption}_`);
  const fields = Object.entries(entity).filter(([k, v]) => !CARD_SKIPPED_FIELDS.has(k) && v !== undefined && v !== null);
  if (fields.length > 0) lines.push('');
  for (const [key, value] of fields) {
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    const [first, ...rest] = rendered.split('\n');
    lines.push(`- **${key}**: ${first ?? ''}`);
    for (const line of rest) lines.push(`  ${line}`);
  }
  return lines.join('\n');
}

function renderTable(rows: Array<{ type: string; slug: string; title: string }>, withType = false): string {
  const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = withType ? ['| Type | Title | Slug |', '| --- | --- | --- |'] : ['| Title | Slug |', '| --- | --- |'];
  const body = rows.map((r) =>
    withType
      ? `| ${cell(r.type)} | ${cell(r.title)} | \`${cell(r.slug)}\` |`
      : `| ${cell(r.title)} | \`${cell(r.slug)}\` |`,
  );
  return [...head, ...body].join('\n');
}
