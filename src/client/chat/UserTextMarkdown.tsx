import React, { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { buildMarkdownIt } from '../tiptap/markdown/buildMarkdownIt.js';
import { PageRefChip } from '../components/PageRefChip.js';
import { SectionRefChipWithData } from '../components/SectionRefChipWithData.js';
import { usePageLinks } from '../hooks/usePageLinks.js';
import type { FileMeta, PageLinkSyntax } from '../../shared/page-links.js';

interface Props {
  text: string;
}

type NavigateFn = ReturnType<typeof useNavigate>;

interface RenderCtx {
  navigate: NavigateFn;
  pagesIndex: Map<string, FileMeta> | undefined;
}

interface PageRefAttrs {
  syntax: PageLinkSyntax;
  path: string;
  anchor?: string;
  label?: string;
}

/**
 * Read-only renderer for user chat messages. Parses markdown with the same pipeline
 * as the editor (M14 pageRef rules) so `@path.md` / `` `path.md` `` / `[label](path.md)`
 * render as `PageRefChip` with navigation; other markdown maps to native HTML.
 */
export function UserTextMarkdown({ text }: Props) {
  const { data } = usePageLinks();
  const navigate = useNavigate();

  const pagesIndex = useMemo<Map<string, FileMeta> | undefined>(() => {
    if (!data) return undefined;
    const map = new Map<string, FileMeta>();
    const paths = new Set<string>();
    for (const p of Object.keys(data.links)) paths.add(p);
    for (const p of Object.keys(data.reverseLinks)) paths.add(p);
    for (const sources of Object.values(data.reverseLinks)) sources.forEach((p) => paths.add(p));
    for (const links of Object.values(data.links)) for (const l of links) paths.add(l.targetPath);
    for (const p of paths) map.set(p, { path: p, title: basenameTitle(p), anchors: [] });
    return map;
  }, [data]);

  const tokens = useMemo(() => {
    const md = buildMarkdownIt({ pagesIndex, breaks: true });
    return md.parse(text, {});
  }, [text, pagesIndex]);

  return <>{renderBlocks(tokens, { navigate, pagesIndex })}</>;
}

function renderBlocks(tokens: any[], ctx: RenderCtx): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const totalPara = tokens.filter((t) => t.type === 'paragraph_open').length;
  let paraIdx = 0;
  let i = 0;
  let key = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'paragraph_open') {
      const close = findTokenClose(tokens, i, 'paragraph_close');
      const inlineTok = tokens[i + 1];
      const children: any[] =
        inlineTok && inlineTok.type === 'inline' ? inlineTok.children ?? [] : [];
      const isLast = paraIdx === totalPara - 1;
      out.push(
        <p
          key={`p-${key++}`}
          style={{ margin: 0, marginBottom: isLast ? 0 : '0.4em' }}
        >
          {renderInline(children, ctx, `p${paraIdx}-`)}
        </p>,
      );
      paraIdx++;
      i = close + 1;
    } else if (tok.type === 'fence' || tok.type === 'code_block') {
      out.push(
        <pre
          key={`c-${key++}`}
          style={{
            margin: '0.4em 0',
            padding: '6px 8px',
            background: 'rgba(0,0,0,0.15)',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            whiteSpace: 'pre-wrap',
          }}
        >
          <code>{tok.content}</code>
        </pre>,
      );
      i++;
    } else {
      i++;
    }
  }
  return out;
}

function renderInline(children: any[], ctx: RenderCtx, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let key = 0;
  let i = 0;
  while (i < children.length) {
    const tok = children[i];
    switch (tok.type) {
      case 'text':
        out.push(tok.content);
        i++;
        break;
      case 'softbreak':
        out.push(' ');
        i++;
        break;
      case 'hardbreak':
        out.push(<br key={`${keyPrefix}br-${key++}`} />);
        i++;
        break;
      case 'strong_open': {
        const close = findTokenClose(children, i, 'strong_close');
        out.push(
          <strong key={`${keyPrefix}st-${key++}`}>
            {renderInline(children.slice(i + 1, close), ctx, `${keyPrefix}st-`)}
          </strong>,
        );
        i = close + 1;
        break;
      }
      case 'em_open': {
        const close = findTokenClose(children, i, 'em_close');
        out.push(
          <em key={`${keyPrefix}em-${key++}`}>
            {renderInline(children.slice(i + 1, close), ctx, `${keyPrefix}em-`)}
          </em>,
        );
        i = close + 1;
        break;
      }
      case 'code_inline':
        out.push(
          <code
            key={`${keyPrefix}ci-${key++}`}
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: '0.9em',
              padding: '1px 4px',
              background: 'rgba(0,0,0,0.15)',
              borderRadius: 3,
            }}
          >
            {tok.content}
          </code>,
        );
        i++;
        break;
      case 'link_open': {
        const href = tok.attrGet?.('href') ?? '#';
        const close = findTokenClose(children, i, 'link_close');
        out.push(
          <a
            key={`${keyPrefix}a-${key++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline' }}
          >
            {renderInline(children.slice(i + 1, close), ctx, `${keyPrefix}a-`)}
          </a>,
        );
        i = close + 1;
        break;
      }
      case 'html_inline': {
        const sectionAnchor = parseSectionRefHtml(tok.content);
        if (sectionAnchor) {
          out.push(<SectionRefChipWithData key={`${keyPrefix}sref-${key++}`} anchor={sectionAnchor} />);
          i++;
          break;
        }
        const attrs = parsePageRefHtml(tok.content);
        if (attrs) {
          out.push(renderChip(attrs, ctx, `${keyPrefix}ref-${key++}`));
        }
        i++;
        break;
      }
      default:
        i++;
    }
  }
  return out;
}

function renderChip(attrs: PageRefAttrs, ctx: RenderCtx, key: string): React.ReactNode {
  const resolved = resolvePath(attrs.path, ctx.pagesIndex);
  const meta = resolved ? ctx.pagesIndex?.get(resolved) : undefined;
  const state = resolved ? 'normal' : 'broken';
  const onClick = resolved
    ? (e: React.MouseEvent<HTMLSpanElement>) => {
        e.preventDefault();
        e.stopPropagation();
        void ctx.navigate({
          to: '/pages/$',
          params: { _splat: resolved },
          hash: attrs.anchor ? `anchor-${attrs.anchor}` : undefined,
        });
      }
    : undefined;
  return (
    <PageRefChip
      key={key}
      syntax={attrs.syntax}
      path={attrs.path}
      anchor={attrs.anchor}
      label={attrs.label}
      title={meta?.title}
      state={state}
      onClick={onClick}
      interactive={!!resolved}
    />
  );
}

function findTokenClose(tokens: any[], from: number, closeType: string): number {
  let depth = 0;
  const openType = closeType.replace(/_close$/, '_open');
  for (let k = from + 1; k < tokens.length; k++) {
    if (tokens[k].type === openType) depth++;
    else if (tokens[k].type === closeType) {
      if (depth === 0) return k;
      depth--;
    }
  }
  return tokens.length - 1;
}

function resolvePath(path: string, index: Map<string, FileMeta> | undefined): string | null {
  if (!path) return null;
  if (!index) return null;
  if (index.has(path)) return path;
  if (!/\.\w+$/.test(path) && index.has(`${path}.md`)) return `${path}.md`;
  return null;
}

function parseSectionRefHtml(html: string): string | null {
  const m = /<section_ref\s+([^>]+?)\s*\/?>/.exec(html);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const am = /anchor="([^"]*)"/.exec(attrs);
  return am ? decodeAttr(am[1] ?? '') : null;
}

function parsePageRefHtml(html: string): PageRefAttrs | null {
  const m = /<page_ref\s+([^>]+?)\s*\/?>/.exec(html);
  if (!m) return null;
  const attrs = m[1]!;
  const get = (name: string): string | undefined => {
    const re = new RegExp(`data-${name}="([^"]*)"`);
    const mm = re.exec(attrs);
    if (!mm) return undefined;
    return decodeAttr(mm[1] ?? '');
  };
  const syntax = (get('syntax') ?? 'at') as PageLinkSyntax;
  const path = get('path') ?? '';
  const anchor = get('anchor');
  const label = get('label');
  return { syntax, path, anchor: anchor || undefined, label: label || undefined };
}

function decodeAttr(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function basenameTitle(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.md$/, '');
}
