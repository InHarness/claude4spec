import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { BriefUpdateCard } from './BriefUpdateCard.js';
import { clientPluginHost } from '../core/plugin-host/host.js';

export interface ToolRenderer {
  summary(input: unknown, result?: unknown): string;
  renderInput?(input: unknown, result?: unknown): ReactNode;
  renderResult?(result: unknown): ReactNode;
}

// Strip `mcp__<server>__` prefix from a fully-qualified MCP tool name.
// `mcp__database-tools__create_database_table` → `create_database_table`
export function prettyToolName(full: string): string {
  return full.startsWith('mcp__') ? (full.split('__').slice(-1)[0] ?? full) : full;
}

// Compact key/value row used by renderInput/renderResult.
export function kv(label: string, value: ReactNode) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: 10, alignItems: 'start' }}>
      <span
        className="font-mono uppercase"
        style={{ fontSize: 10, color: 'var(--c-subtle)', letterSpacing: '0.04em', paddingTop: 2 }}
      >
        {label}
      </span>
      <span className="text-[12.5px] break-words" style={{ color: 'var(--c-ink)' }}>
        {value}
      </span>
    </div>
  );
}

export function mono(value: ReactNode) {
  return (
    <span className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
      {value}
    </span>
  );
}

// `tool_result.content` is the agent-chat wire `summary` string.
// From the claude-code adapter, summary is a JSON-serialized MCP content array:
//   [{"type":"text","text":"<our JSON>"}]
// We need to parse both layers to get our MCP tool's payload.
export function parseToolResult(raw: string): unknown {
  if (!raw) return null;
  try {
    const outer = JSON.parse(raw);
    if (Array.isArray(outer) && outer[0]?.type === 'text' && typeof outer[0].text === 'string') {
      try {
        return JSON.parse(outer[0].text);
      } catch {
        return outer[0].text;
      }
    }
    return outer;
  } catch {
    return raw;
  }
}

interface RendererContext {
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

function cx(input: unknown): RendererContext {
  return { input: (input ?? {}) as Record<string, unknown>, result: null };
}
function cx2(input: unknown, result: unknown): RendererContext {
  return { input: (input ?? {}) as Record<string, unknown>, result: (result ?? {}) as Record<string, unknown> };
}

// --- Endpoint tools (2) — CRUD moved to entity-tools (M13); only the
// cross-entity DTO-link relation tools remain custom. ---

const endpointRenderers: Record<string, ToolRenderer> = {
  link_dto: {
    summary(i) {
      const { endpointSlug, dtoSlug, relation } = cx(i).input;
      return `Link ${dtoSlug ?? '?'} → ${endpointSlug ?? '?'} (${relation ?? '?'})`;
    },
  },
  unlink_dto: {
    summary(i) {
      const { endpointSlug, dtoSlug, relation } = cx(i).input;
      return `Unlink ${dtoSlug ?? '?'} ✗ ${endpointSlug ?? '?'} (${relation ?? '?'})`;
    },
  },
};

// --- Reference tools (9) ---

const referenceRenderers: Record<string, ToolRenderer> = {
  create_tag: { summary: (i) => `Create tag: ${cx(i).input.name ?? '?'}` },
  update_tag: { summary: (i) => `Update tag: ${cx(i).input.slug ?? '?'}` },
  delete_tag: { summary: (i) => `Delete tag: ${cx(i).input.slug ?? '?'}` },
  list_tags: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const tags = Array.isArray(result?.tags) ? (result!.tags as unknown[]).length : undefined;
      return typeof tags === 'number' ? `List tags (${tags})` : 'List tags';
    },
  },
  tag_entity: {
    summary(i) {
      const { type, slug, tags } = cx(i).input;
      const tagList = Array.isArray(tags) ? (tags as string[]).join(', ') : '';
      return `Tag ${type ?? '?'} ${slug ?? '?'}: ${tagList}`;
    },
  },
  untag_entity: {
    summary(i) {
      const { type, slug, tags } = cx(i).input;
      const tagList = Array.isArray(tags) ? (tags as string[]).join(', ') : '';
      return `Untag ${type ?? '?'} ${slug ?? '?'}: ${tagList}`;
    },
  },
  find_references: {
    summary(i, r) {
      const { type, slug } = cx(i).input;
      const { result } = cx2(i, r);
      const refs = Array.isArray(result?.references) ? (result!.references as unknown[]).length : undefined;
      const base = `Find refs to ${type ?? '?'} ${slug ?? '?'}`;
      return typeof refs === 'number' ? `${base} (${refs})` : base;
    },
  },
  check_consistency: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const s = result?.summary as { total?: number; errors?: number; warnings?: number } | undefined;
      if (!s) return 'Consistency check';
      return `Consistency: ${s.errors ?? 0} errors, ${s.warnings ?? 0} warnings`;
    },
  },
};

// --- Entity tools (7) — M13: generic CRUD for every active entity type,
// parametrized by `input.type`. Card/row rendering is delegated to the
// type's own client entity registration (`clientPluginHost`) rather than
// reinventing per-type markup here.

function entityLabel(type: unknown, plural = true): string {
  const t = typeof type === 'string' ? type : '?';
  const mod = clientPluginHost.getEntity(t);
  if (mod) return plural ? mod.labelPlural : mod.label;
  return t;
}

interface ItemEnvelope {
  slug?: unknown;
  error?: unknown;
  code?: unknown;
  warnings?: unknown;
}

function isErrorItem(item: unknown): item is { error: string; code: string } {
  return !!item && typeof item === 'object' && 'error' in (item as Record<string, unknown>);
}

function ItemBadgeList({ items }: { items: unknown[] }) {
  if (items.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(none)</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.slice(0, 12).map((raw, i) => {
        const item = raw as ItemEnvelope;
        if (isErrorItem(item)) {
          return (
            <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-error, #c0392b)' }}>
              ✗ {String(item.error)} <span style={{ color: 'var(--c-subtle)' }}>({String(item.code)})</span>
            </div>
          );
        }
        const warnings = Array.isArray(item.warnings) ? (item.warnings as string[]) : [];
        return (
          <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
            {String(item.slug ?? '?')}
            {warnings.length > 0 && (
              <span style={{ color: 'var(--c-warning, #b8860b)' }}> — {warnings.join('; ')}</span>
            )}
          </div>
        );
      })}
      {items.length > 12 && (
        <div className="font-mono text-[11px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
          … +{items.length - 12} more
        </div>
      )}
    </div>
  );
}

function EntityRows({ type, items }: { type: string; items: unknown[] }) {
  const mod = clientPluginHost.getEntity(type);
  if (items.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(no results)</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.slice(0, 12).map((entity, i) => {
        const slug = String((entity as { slug?: unknown })?.slug ?? '?');
        if (mod?.renderRow) {
          const Row = mod.renderRow;
          return <Row key={i} slug={slug} entity={entity} />;
        }
        return (
          <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
            {slug}
          </div>
        );
      })}
      {items.length > 12 && (
        <div className="font-mono text-[11px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
          … +{items.length - 12} more
        </div>
      )}
    </div>
  );
}

const entityToolsRenderers: Record<string, ToolRenderer> = {
  create_entities: {
    summary(i, r) {
      const { type, items } = cx(i).input;
      const { result } = cx2(i, r);
      const count = Array.isArray(items) ? (items as unknown[]).length : 0;
      const results = Array.isArray(result?.results) ? (result!.results as unknown[]) : [];
      const label = entityLabel(type, count !== 1);
      if (count === 1 && results[0] && !isErrorItem(results[0])) {
        return `Created ${entityLabel(type, false)}: ${String((results[0] as ItemEnvelope).slug ?? '?')}`;
      }
      return `Created ${count} ${label}`;
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const items = Array.isArray(result?.results) ? (result!.results as unknown[]) : [];
      return <ItemBadgeList items={items} />;
    },
  },
  get_entities: {
    summary(i, r) {
      const { type, slugs } = cx(i).input;
      const { result } = cx2(i, r);
      const results = Array.isArray(result?.results) ? (result!.results as unknown[]) : [];
      const count = results.length || (Array.isArray(slugs) ? (slugs as unknown[]).length : 0);
      return `Fetched ${count} ${entityLabel(type, count !== 1)}`;
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const type = typeof result?.type === 'string' ? (result!.type as string) : '';
      const results = Array.isArray(result?.results) ? (result!.results as Array<{ slug: string; entity: unknown }>) : [];
      const mod = clientPluginHost.getEntity(type);
      if (results.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(no results)</span>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.slice(0, 10).map(({ slug, entity }, i) => {
            if (entity == null) {
              return (
                <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-subtle)' }}>
                  {slug} — not found
                </div>
              );
            }
            if (mod?.renderCard) {
              const Card = mod.renderCard;
              return <Card key={i} slug={slug} entity={entity} />;
            }
            return (
              <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
                {slug}
              </div>
            );
          })}
        </div>
      );
    },
  },
  update_entities: {
    summary(i, r) {
      const { type, updates } = cx(i).input;
      const { result } = cx2(i, r);
      const count =
        (Array.isArray(result?.results) ? (result!.results as unknown[]).length : 0) ||
        (Array.isArray(updates) ? (updates as unknown[]).length : 0);
      return `Updated ${count} ${entityLabel(type, count !== 1)}`;
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const items = Array.isArray(result?.results) ? (result!.results as unknown[]) : [];
      return <ItemBadgeList items={items} />;
    },
  },
  delete_entities: {
    summary(i, r) {
      const { type, slugs } = cx(i).input;
      const { result } = cx2(i, r);
      const count =
        (Array.isArray(result?.results) ? (result!.results as unknown[]).length : 0) ||
        (Array.isArray(slugs) ? (slugs as unknown[]).length : 0);
      return `Deleted ${count} ${entityLabel(type, count !== 1)}`;
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const items = Array.isArray(result?.results) ? (result!.results as unknown[]) : [];
      if (items.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(none)</span>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((raw, i) => {
            const item = raw as ItemEnvelope & { brokenReferences?: Array<{ pagePath: string; count: number }> };
            if (isErrorItem(item)) {
              return (
                <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-error, #c0392b)' }}>
                  ✗ {String(item.error)} <span style={{ color: 'var(--c-subtle)' }}>({String(item.code)})</span>
                </div>
              );
            }
            const broken = item.brokenReferences ?? [];
            return (
              <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
                {String(item.slug ?? '?')}
                {broken.length > 0 && (
                  <span style={{ color: 'var(--c-warning, #b8860b)' }}>
                    {' '}
                    — {broken.reduce((n, b) => n + b.count, 0)} broken reference(s) in {broken.length} page(s)
                  </span>
                )}
              </div>
            );
          })}
        </div>
      );
    },
  },
  list_entities: {
    summary(i, r) {
      const { type } = cx(i).input;
      const { result } = cx2(i, r);
      const total = result?.total;
      const items = Array.isArray(result?.items) ? (result!.items as unknown[]) : [];
      const count = typeof total === 'number' ? total : items.length;
      return `Listed ${count} ${entityLabel(type, count !== 1)}`;
    },
    renderResult(r) {
      // `renderResult` only receives `result`, not the tool input — `type` is
      // read back off the response envelope (entity-tools echoes it) instead.
      const { result } = cx2({}, r);
      const items = Array.isArray(result?.items) ? (result!.items as unknown[]) : [];
      const type = typeof result?.type === 'string' ? (result!.type as string) : '';
      return <EntityRows type={type} items={items} />;
    },
  },
  search_entities: {
    summary(i, r) {
      const { query } = cx(i).input;
      const { result } = cx2(i, r);
      const groups = Array.isArray(result?.results) ? (result!.results as Array<{ total: number }>) : [];
      const total = groups.reduce((n, g) => n + (g.total ?? 0), 0);
      return `Found ${total} matches for "${String(query ?? '')}"`;
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const groups = Array.isArray(result?.results)
        ? (result!.results as Array<{ type: string; items: unknown[]; total: number }>)
        : [];
      if (groups.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(no matches)</span>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map((g, i) => (
            <div key={i}>
              <div
                className="font-mono uppercase"
                style={{ fontSize: 10, color: 'var(--c-subtle)', letterSpacing: '0.04em', marginBottom: 4 }}
              >
                {entityLabel(g.type)} ({g.total})
              </div>
              <EntityRows type={g.type} items={g.items} />
            </div>
          ))}
        </div>
      );
    },
  },
  describe_entity_type: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const types = Array.isArray(result?.types) ? (result!.types as unknown[]) : [];
      return `Described ${types.length} entity type${types.length === 1 ? '' : 's'}`;
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const types = Array.isArray(result?.types)
        ? (result!.types as Array<{
            type: string;
            label: string;
            crudSupported: boolean;
            searchSupported: boolean;
            createSchema?: { properties?: Record<string, unknown> };
          }>)
        : [];
      if (types.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(no types)</span>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {types.map((t, i) => (
            <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
              {t.type}{' '}
              <span style={{ color: 'var(--c-subtle)' }}>
                crud={String(t.crudSupported)} search={String(t.searchSupported)} fields=
                {Object.keys(t.createSchema?.properties ?? {}).length}
              </span>
            </div>
          ))}
        </div>
      );
    },
  },
};

// --- Plan tools (4) ---

const PLAN_ACTION_LABEL: Record<string, string> = {
  replace: 'replace',
  append: 'append',
  insert_after_section: 'insert',
};

const planRenderers: Record<string, ToolRenderer> = {
  get_plan: { summary: () => 'Read plan' },
  list_plan_versions: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const total = result?.total;
      return typeof total === 'number' ? `List plan versions (${total})` : 'List plan versions';
    },
  },
  get_plan_version: {
    summary(i) {
      return `Plan v${cx(i).input.version ?? '?'}`;
    },
  },
  update_plan: {
    summary(i) {
      const { action, changeSummary } = cx(i).input;
      const label = PLAN_ACTION_LABEL[String(action ?? '')] ?? String(action ?? '?');
      return changeSummary ? `Plan ${label}: ${changeSummary}` : `Plan ${label}`;
    },
    renderInput(i) {
      const { action, changeSummary, anchor, heading, content } = cx(i).input;
      const label = PLAN_ACTION_LABEL[String(action ?? '')] ?? String(action ?? '?');
      const text = typeof content === 'string' ? content : '';
      const preview = text.length > 320 ? `${text.slice(0, 320)}…` : text;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kv(
            'Action',
            <span
              className="font-mono text-[11px] px-1.5 py-[1px] rounded-sm"
              style={{
                background: 'var(--c-panel)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
            >
              {label}
            </span>,
          )}
          {changeSummary ? kv('Summary', String(changeSummary)) : null}
          {anchor ? kv('Anchor', mono(String(anchor))) : null}
          {heading ? kv('Heading', String(heading)) : null}
          {preview
            ? kv(
                'Body',
                <pre
                  className="font-mono text-[11.5px] scroll-thin"
                  style={{
                    background: 'var(--c-panel)',
                    color: 'var(--c-ink)',
                    padding: '6px 8px',
                    borderRadius: 4,
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 160,
                    overflow: 'auto',
                  }}
                >
                  {preview}
                </pre>,
              )
            : null}
        </div>
      );
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const planPath = result?.planPath;
      const version = result?.version;
      if (typeof planPath !== 'string' || typeof version !== 'number') return null;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="text-[12px]" style={{ color: 'var(--c-ink)' }}>
            Updated to v{version}
          </div>
          <Link
            to="/plans/$planPath"
            params={{ planPath }}
            className="text-[11.5px] underline"
            style={{ color: 'var(--c-accent)' }}
          >
            Open plan →
          </Link>
        </div>
      );
    },
  },
};

// --- Brief tools (4) — analog Plan, used in context_type='brief' threads ---

const BRIEF_ACTION_LABEL: Record<string, string> = {
  replace: 'replace',
  append: 'append',
  insert_after_section: 'insert',
};

const briefRenderers: Record<string, ToolRenderer> = {
  get_brief: {
    summary() {
      return 'Read brief';
    },
  },
  update_brief: {
    summary(i) {
      const { action, changeSummary } = cx(i).input;
      const label = BRIEF_ACTION_LABEL[String(action ?? '')] ?? String(action ?? '?');
      return changeSummary ? `Brief ${label}: ${changeSummary}` : `Brief ${label}`;
    },
    renderInput(i, r) {
      const { action, changeSummary, anchor, heading, content } = cx(i).input;
      const { result } = cx2(i, r);
      const newHash = typeof result?.newHash === 'string' ? (result.newHash as string) : null;
      return (
        <BriefUpdateCard
          action={String(action ?? '?')}
          changeSummary={typeof changeSummary === 'string' ? changeSummary : null}
          anchor={typeof anchor === 'string' ? anchor : null}
          heading={typeof heading === 'string' ? heading : null}
          content={typeof content === 'string' ? content : null}
          newHash={newHash}
        />
      );
    },
  },
};

// --- Built-in tools ---

const builtinRenderers: Record<string, ToolRenderer> = {
  Read: {
    summary(i) {
      const path = cx(i).input.file_path ?? cx(i).input.path;
      return path ? `Read ${path}` : 'Read file';
    },
    renderInput(i) {
      const { file_path, path } = cx(i).input;
      return (
        <pre
          className="font-mono text-[11.5px] scroll-thin"
          style={{
            background: 'var(--c-panel)',
            color: 'var(--c-ink)',
            padding: '3px 8px',
            borderRadius: 4,
            margin: 0,
            whiteSpace: 'pre',
            overflowX: 'auto',
          }}
        >
          {String(file_path ?? path ?? '?')}
        </pre>
      );
    },
  },
  Write: {
    summary(i) {
      const path = cx(i).input.file_path ?? cx(i).input.path;
      return path ? `Write ${path}` : 'Write file';
    },
    renderInput(i) {
      const { file_path, content } = cx(i).input;
      const text = typeof content === 'string' ? content : '';
      const lines = text.split('\n').length;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <pre
            className="font-mono text-[11.5px] scroll-thin"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-ink)',
              padding: '3px 8px',
              borderRadius: 4,
              margin: 0,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {String(file_path ?? '?')}
          </pre>
          <div className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
            {lines} lines · {text.length} chars
          </div>
        </div>
      );
    },
  },
  Edit: {
    summary(i) {
      const path = cx(i).input.file_path ?? cx(i).input.path;
      return path ? `Edit ${path}` : 'Edit file';
    },
    renderInput(i) {
      const { file_path, old_string, new_string, replace_all } = cx(i).input;
      const oldText = typeof old_string === 'string' ? old_string : '';
      const newText = typeof new_string === 'string' ? new_string : '';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <pre
              className="font-mono text-[11.5px] scroll-thin"
              style={{
                background: 'var(--c-panel)',
                color: 'var(--c-ink)',
                padding: '3px 8px',
                borderRadius: 4,
                margin: 0,
                whiteSpace: 'pre',
                overflowX: 'auto',
                flex: 1,
                minWidth: 0,
              }}
            >
              {String(file_path ?? '?')}
            </pre>
            {replace_all ? (
              <span
                className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--c-subtle)', flexShrink: 0 }}
              >
                replace all
              </span>
            ) : null}
          </div>
          <pre
            className="font-mono text-[11.5px] scroll-thin"
            style={{
              background: 'var(--c-red-soft)',
              color: 'var(--c-ink)',
              padding: '4px 8px',
              borderRadius: 4,
              margin: 0,
              maxHeight: 80,
              overflow: 'auto',
              whiteSpace: 'pre',
            }}
          >
            {clip(oldText, 500)}
          </pre>
          <pre
            className="font-mono text-[11.5px] scroll-thin"
            style={{
              background: 'var(--c-green-soft)',
              color: 'var(--c-ink)',
              padding: '4px 8px',
              borderRadius: 4,
              margin: 0,
              maxHeight: 80,
              overflow: 'auto',
              whiteSpace: 'pre',
            }}
          >
            {clip(newText, 500)}
          </pre>
        </div>
      );
    },
  },
  Glob: {
    summary(i) {
      return `Find: ${cx(i).input.pattern ?? '?'}`;
    },
    renderInput(i) {
      const { pattern, path } = cx(i).input;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kv('Pattern', mono(String(pattern ?? '?')))}
          {path ? kv('Path', mono(String(path))) : null}
        </div>
      );
    },
    renderResult(r) {
      const text = typeof r === 'string' ? r : null;
      if (!text) return null;
      const lines = text.split('\n').filter(Boolean);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="font-mono text-[11.5px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
            {lines.length} match{lines.length === 1 ? '' : 'es'}
          </div>
          {lines.slice(0, 8).map((ln, idx) => (
            <div
              key={idx}
              className="font-mono text-[11.5px] truncate"
              style={{ color: 'var(--c-ink)' }}
            >
              {ln}
            </div>
          ))}
          {lines.length > 8 && (
            <div className="font-mono text-[11px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
              … +{lines.length - 8} more
            </div>
          )}
        </div>
      );
    },
  },
  Grep: {
    summary(i) {
      const { pattern, path } = cx(i).input;
      return `Search "${pattern ?? '?'}"${path ? ` in ${path}` : ''}`;
    },
    renderInput(i) {
      const { pattern, path, glob, type, output_mode } = cx(i).input;
      const filters: string[] = [];
      if (path) filters.push(`in ${path}`);
      if (glob) filters.push(`glob ${glob}`);
      if (type) filters.push(`type ${type}`);
      if (output_mode) filters.push(`mode ${output_mode}`);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <pre
            className="font-mono text-[11.5px] scroll-thin"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-ink)',
              padding: '3px 8px',
              borderRadius: 4,
              margin: 0,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {String(pattern ?? '?')}
          </pre>
          {filters.length > 0 ? (
            <div className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
              {filters.join(' · ')}
            </div>
          ) : null}
        </div>
      );
    },
    renderResult(r) {
      const text = typeof r === 'string' ? r : null;
      if (!text) return null;
      const lines = text.split('\n').filter(Boolean);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="font-mono text-[11.5px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </div>
          {lines.slice(0, 8).map((ln, idx) => (
            <div
              key={idx}
              className="font-mono text-[11.5px] truncate"
              style={{ color: 'var(--c-ink)' }}
            >
              {ln}
            </div>
          ))}
          {lines.length > 8 && (
            <div className="font-mono text-[11px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
              … +{lines.length - 8} more
            </div>
          )}
        </div>
      );
    },
  },
  ToolSearch: {
    summary(i) {
      const q = cx(i).input.query;
      return typeof q === 'string' ? `Find tool: ${q}` : 'Find tool';
    },
    renderInput(i, result) {
      const { query } = cx(i).input;
      const names = extractToolSearchNames(result);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <pre
            className="font-mono text-[11.5px] scroll-thin"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-ink)',
              padding: '3px 8px',
              borderRadius: 4,
              margin: 0,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {String(query ?? '?')}
          </pre>
          {names.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {names.map((n) => (
                <span
                  key={n}
                  className="font-mono text-[11px]"
                  style={{
                    background: 'var(--c-panel)',
                    color: 'var(--c-ink)',
                    border: '1px solid var(--c-hair)',
                    borderRadius: 3,
                    padding: '1px 6px',
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      );
    },
  },
  Bash: {
    summary(i) {
      const cmd = cx(i).input.command;
      if (typeof cmd !== 'string') return 'Run shell command';
      const short = cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd;
      return `$ ${short}`;
    },
    renderInput(i) {
      const { command, description } = cx(i).input;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {description ? (
            <div className="text-[12px]" style={{ color: 'var(--c-muted)' }}>
              {String(description)}
            </div>
          ) : null}
          <pre
            className="font-mono text-[11.5px] scroll-thin"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-ink)',
              padding: '3px 8px',
              borderRadius: 4,
              margin: 0,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {String(command ?? '?')}
          </pre>
        </div>
      );
    },
  },
  WebFetch: {
    summary(i) {
      const url = cx(i).input.url;
      return typeof url === 'string' ? `Fetch ${url}` : 'Fetch URL';
    },
    renderInput(i) {
      const { url, prompt } = cx(i).input;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kv('Url', mono(String(url ?? '?')))}
          {prompt ? kv('Prompt', clip(String(prompt), 280)) : null}
        </div>
      );
    },
  },
  WebSearch: {
    summary(i) {
      const query = cx(i).input.query;
      return typeof query === 'string' ? `Search web: "${query}"` : 'Web search';
    },
    renderInput(i) {
      const { query, allowed_domains, blocked_domains } = cx(i).input;
      const allow = Array.isArray(allowed_domains) ? (allowed_domains as string[]) : [];
      const block = Array.isArray(blocked_domains) ? (blocked_domains as string[]) : [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kv('Query', mono(String(query ?? '?')))}
          {allow.length > 0 ? kv('Allow', mono(allow.join(', '))) : null}
          {block.length > 0 ? kv('Block', mono(block.join(', '))) : null}
        </div>
      );
    },
  },
  Task: {
    summary(i) {
      const { description, subagent_type } = cx(i).input;
      const base = typeof description === 'string' ? description : 'Subagent task';
      return subagent_type ? `${base} (${subagent_type})` : base;
    },
    renderInput(i) {
      const { description, subagent_type, prompt } = cx(i).input;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {description ? kv('What', String(description)) : null}
          {subagent_type
            ? kv(
                'Agent',
                <span
                  className="font-mono text-[11px] px-1.5 py-[1px] rounded-sm"
                  style={{
                    background: 'var(--c-panel)',
                    border: '1px solid var(--c-hair)',
                    color: 'var(--c-ink)',
                  }}
                >
                  {String(subagent_type)}
                </span>,
              )
            : null}
          {prompt
            ? kv(
                'Prompt',
                <pre
                  className="font-mono text-[11.5px] scroll-thin"
                  style={{
                    background: 'var(--c-panel)',
                    color: 'var(--c-ink)',
                    padding: '6px 8px',
                    borderRadius: 4,
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {clip(String(prompt), 1200)}
                </pre>,
              )
            : null}
        </div>
      );
    },
  },
  TodoWrite: {
    summary(i) {
      const todos = cx(i).input.todos;
      const count = Array.isArray(todos) ? (todos as unknown[]).length : undefined;
      return typeof count === 'number' ? `Update todos (${count})` : 'Update todos';
    },
    renderInput(i) {
      const list = cx(i).input.todos;
      const todos = Array.isArray(list) ? (list as unknown[]) : [];
      if (todos.length === 0) {
        return <span style={{ color: 'var(--c-subtle)' }}>(no todos)</span>;
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {todos.map((t, idx) => {
            const todo = t as { content?: string; activeForm?: string; status?: string };
            const status = todo.status ?? 'pending';
            const marker =
              status === 'completed' ? '☑' : status === 'in_progress' ? '▣' : '☐';
            const color =
              status === 'completed'
                ? 'var(--c-subtle)'
                : status === 'in_progress'
                  ? 'var(--c-accent)'
                  : 'var(--c-ink)';
            const text = status === 'in_progress' ? todo.activeForm ?? todo.content : todo.content;
            return (
              <div
                key={idx}
                className="text-[12px] flex gap-2"
                style={{
                  color,
                  textDecoration: status === 'completed' ? 'line-through' : undefined,
                }}
              >
                <span style={{ width: 12 }}>{marker}</span>
                <span className="break-words">{text ?? '(empty)'}</span>
              </div>
            );
          })}
        </div>
      );
    },
  },
  NotebookEdit: {
    summary(i) {
      const path = cx(i).input.notebook_path ?? cx(i).input.file_path;
      return path ? `Edit notebook ${path}` : 'Edit notebook';
    },
    renderInput(i) {
      const { notebook_path, cell_id, cell_type, edit_mode, new_source } = cx(i).input;
      const text = typeof new_source === 'string' ? new_source : '';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kv('Path', mono(String(notebook_path ?? '?')))}
          {cell_id ? kv('Cell', mono(String(cell_id))) : null}
          {cell_type ? kv('Type', mono(String(cell_type))) : null}
          {edit_mode ? kv('Mode', mono(String(edit_mode))) : null}
          {text
            ? kv(
                'Source',
                <pre
                  className="font-mono text-[11.5px] scroll-thin"
                  style={{
                    background: 'var(--c-panel)',
                    color: 'var(--c-ink)',
                    padding: '6px 8px',
                    borderRadius: 4,
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {clip(text, 800)}
                </pre>,
              )
            : null}
        </div>
      );
    },
  },
};

// --- Registry (keyed by full tool name) ---

export const toolRenderers: Record<string, ToolRenderer> = {
  ...Object.fromEntries(
    Object.entries(endpointRenderers).map(([k, v]) => [`mcp__endpoint-tools__${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(entityToolsRenderers).map(([k, v]) => [`mcp__entity-tools__${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(referenceRenderers).map(([k, v]) => [`mcp__reference-tools__${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(planRenderers).map(([k, v]) => [`mcp__plan-tools__${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(briefRenderers).map(([k, v]) => [`mcp__brief-tools__${k}`, v]),
  ),
  ...builtinRenderers,
};

export function getRenderer(toolName: string): ToolRenderer | null {
  return toolRenderers[toolName] ?? null;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function extractToolSearchNames(result: unknown): string[] {
  const text = typeof result === 'string' ? result : '';
  if (!text) return [];
  const names: string[] = [];
  const re = /"name"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}
