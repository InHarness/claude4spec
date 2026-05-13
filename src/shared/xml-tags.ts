import {
  getExtensionReferenceType,
  listExtensionReferenceTypes,
} from './reference-extensions.js';

export const XML_TAG_KINDS = [
  'inline_mention',
  'single_element',
  'element_list',
  'tagged_list',
  'tagged_list_mixed',
  'todo',
] as const;

export type XmlTagKind = (typeof XML_TAG_KINDS)[number];

export interface XmlTag {
  kind: XmlTagKind | string;
  source: 'core' | 'extension';
  attrs: Record<string, string>;
  raw: string;
  start: number;
  end: number;
  line: number;
}

export const XML_TAG_REGEX =
  /<(inline_mention|single_element|element_list|tagged_list|tagged_list_mixed|todo)\s+([^>]*?)\/?>/g;

const ATTR_REGEX = /(\w+)="([^"]*)"/g;

const ATTR_ORDER: Record<XmlTagKind, readonly string[]> = {
  inline_mention: ['type', 'slug'],
  single_element: ['type', 'slug'],
  element_list: ['type', 'slugs'],
  tagged_list: ['type', 'tags', 'filter'],
  tagged_list_mixed: ['tags', 'filter'],
  todo: ['comment'],
};

function readAttrs(attrBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_REGEX.lastIndex = 0;
  let a: RegExpExecArray | null;
  while ((a = ATTR_REGEX.exec(attrBody)) !== null) {
    const key = a[1];
    const value = a[2];
    if (key !== undefined && value !== undefined) attrs[key] = value;
  }
  return attrs;
}

export function parseXmlTags(md: string): XmlTag[] {
  const out: XmlTag[] = [];

  XML_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = XML_TAG_REGEX.exec(md)) !== null) {
    const kind = m[1] as XmlTagKind;
    const attrBody = m[2] ?? '';
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const line = md.slice(0, start).split('\n').length;
    out.push({ kind, source: 'core', attrs: readAttrs(attrBody), raw, start, end, line });
  }

  for (const ext of listExtensionReferenceTypes()) {
    const re = new RegExp(`<(${ext.tag})\\s+([^>]*?)\\/?>`, 'g');
    let em: RegExpExecArray | null;
    while ((em = re.exec(md)) !== null) {
      const attrBody = em[2] ?? '';
      const raw = em[0];
      const start = em.index;
      const end = start + raw.length;
      const line = md.slice(0, start).split('\n').length;
      out.push({ kind: ext.tag, source: 'extension', attrs: readAttrs(attrBody), raw, start, end, line });
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

export function serializeXmlTag(
  kind: XmlTagKind | string,
  attrs: Record<string, string | null | undefined>,
): string {
  const coreOrder = (ATTR_ORDER as Record<string, readonly string[] | undefined>)[kind];
  const order = coreOrder ?? getExtensionReferenceType(kind)?.attrOrder;
  if (!order) {
    throw new Error(`Unknown XML tag kind: ${kind}`);
  }
  const parts: string[] = [];
  for (const key of order) {
    const value = attrs[key];
    if (value == null || value === '') continue;
    parts.push(`${key}="${escapeAttr(value)}"`);
  }
  return `<${kind} ${parts.join(' ')}/>`;
}

function escapeAttr(v: string | null | undefined): string {
  if (v == null) return '';
  return v.replace(/"/g, '&quot;');
}

export function extractSlugs(tag: XmlTag): string[] {
  if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
    return tag.attrs.slug ? [tag.attrs.slug] : [];
  }
  if (tag.kind === 'element_list') {
    return (tag.attrs.slugs ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractTags(tag: XmlTag): string[] {
  if (tag.kind === 'tagged_list' || tag.kind === 'tagged_list_mixed') {
    return (tag.attrs.tags ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
