export function renderInlineMention(data: unknown): string {
  const obj = asObject(data);
  if (!obj) return String(data);
  /**
   * 0.2.22 — `title` is the label, on every type, with no per-type view left to
   * supply one. `label` stays ahead of `slug` in the chain for the SECTION chip,
   * which is not an entity and carries its own.
   */
  const label =
    pickString(obj, 'title') ?? pickString(obj, 'label') ?? pickString(obj, 'slug') ?? 'unknown';
  const href = pickString(obj, 'href') ?? '';
  return href ? `[${label}](${href})` : `**${label}**`;
}

export function renderSingleElement(data: unknown): string {
  const obj = asObject(data);
  if (!obj) return String(data);
  const slug = pickString(obj, 'slug') ?? pickString(obj, 'anchor') ?? '?';
  const lines: string[] = [];
  lines.push(`### ${titleFor(obj)} \`${slug}\``);
  const description = pickString(obj, 'description') ?? pickString(obj, 'summary');
  if (description) lines.push('', description);
  // Method+path header (endpoint-shaped data)
  const method = pickString(obj, 'method');
  const path = pickString(obj, 'path');
  if (method || path) lines.push('', `**${method ?? ''}** \`${path ?? ''}\``);
  // dtos[] (endpoint-shaped data)
  const dtos = obj.dtos;
  if (Array.isArray(dtos) && dtos.length) {
    lines.push('', '| Relation | DTO | Status |');
    lines.push('| -------- | --- | ------ |');
    for (const d of dtos) {
      const row = asObject(d);
      if (!row) continue;
      lines.push(
        `| ${pickString(row, 'relation') ?? ''} | ${pickString(row, 'dtoName') ?? pickString(row, 'dtoSlug') ?? ''} | ${row.statusCode ?? ''} |`
      );
    }
  }
  // fields[] (dto-shaped data)
  const fields = obj.fields;
  if (Array.isArray(fields) && fields.length) {
    lines.push('', '| Field | Type | Required |');
    lines.push('| ----- | ---- | -------- |');
    for (const f of fields) {
      const row = asObject(f);
      if (!row) continue;
      lines.push(
        `| ${pickString(row, 'name') ?? ''} | ${pickString(row, 'type') ?? ''} | ${row.required ? 'yes' : 'no'} |`
      );
    }
  }
  // columns[] (database-table-shaped data)
  const columns = obj.columns;
  if (Array.isArray(columns) && columns.length) {
    lines.push('', '| Column | Type | PK | FK |');
    lines.push('| ------ | ---- | -- | -- |');
    for (const c of columns) {
      const row = asObject(c);
      if (!row) continue;
      const fk = asObject(row.fk);
      const fkStr = fk ? `${pickString(fk, 'table')}.${pickString(fk, 'column')}` : '';
      lines.push(
        `| ${pickString(row, 'name') ?? ''} | ${pickString(row, 'type') ?? ''} | ${row.pk ? 'yes' : ''} | ${fkStr} |`
      );
    }
  }
  // section-shaped data (anchor + pagePath)
  const anchor = pickString(obj, 'anchor');
  const pagePath = pickString(obj, 'pagePath');
  if (anchor && pagePath) {
    lines.push('', `> [${pickString(obj, 'headingText') ?? 'section'}](${pagePath}#${anchor})`);
  }
  return lines.join('\n');
}

/**
 * One table, two columns, every type.
 *
 * 0.2.22 collapsed three layouts into this. The old code chose between a
 * method/path table, a name/description table and a type/slug/label table by
 * SNIFFING the first item's shape — which was the only way to render a row
 * before every type had a label, and which meant the same list rendered
 * differently depending on which entity happened to sort first.
 *
 * A list row is now `{ slug, title }` on every surface, so there is nothing to
 * sniff and nothing to choose. A reader wanting a summary or a method follows
 * the link.
 */
export function renderElementList(items: unknown[]): string {
  if (!items.length) return '_empty list_';
  const lines: string[] = ['| Slug | Title |', '| ---- | ----- |'];
  for (const item of items) {
    const row = asObject(item);
    if (!row) continue;
    lines.push(`| \`${pickString(row, 'slug') ?? ''}\` | ${titleFor(row)} |`);
  }
  return lines.join('\n');
}

export function renderTaggedListMixed(groups: Record<string, unknown[]>): string {
  const parts: string[] = [];
  for (const [key, items] of Object.entries(groups)) {
    if (!items.length) continue;
    parts.push(`**${capitalize(key)}**`, '', renderElementList(items), '');
  }
  return parts.length ? parts.join('\n') : '_no matches_';
}

/**
 * The heading for a rendered record.
 *
 * 0.2.22 — `title` first, and for every entity that is the end of it. The chain
 * below survives for the two shapes that are not entities: a SECTION carries
 * `headingText`, and a chip payload carries `label`. `slug` remains the last
 * resort for a row read mid-rebuild.
 */
function titleFor(obj: Record<string, unknown>): string {
  return (
    pickString(obj, 'title') ??
    pickString(obj, 'headingText') ??
    pickString(obj, 'label') ??
    pickString(obj, 'slug') ??
    'Entity'
  );
}

function tagsAsText(tags: unknown): string {
  if (!Array.isArray(tags)) return '';
  return tags.filter((t) => typeof t === 'string').join(', ');
}

function firstLine(value: string | undefined): string {
  if (!value) return '';
  const nl = value.indexOf('\n');
  return nl >= 0 ? value.slice(0, nl) : value;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
