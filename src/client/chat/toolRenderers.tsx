import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { BriefUpdateCard } from './BriefUpdateCard.js';

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

// --- Endpoint tools (7) ---

const endpointRenderers: Record<string, ToolRenderer> = {
  create_endpoint: {
    summary(i) {
      const { method, path } = cx(i).input;
      return `Create endpoint ${method ?? ''} ${path ?? ''}`.trim();
    },
  },
  get_endpoint: {
    summary(i) {
      return `Fetch endpoint: ${cx(i).input.slug ?? '?'}`;
    },
  },
  update_endpoint: {
    summary(i) {
      return `Update endpoint: ${cx(i).input.slug ?? '?'}`;
    },
  },
  delete_endpoint: {
    summary(i) {
      return `Delete endpoint: ${cx(i).input.slug ?? '?'}`;
    },
  },
  list_endpoints: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const total = result?.total;
      return typeof total === 'number' ? `List endpoints (${total})` : 'List endpoints';
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const items = Array.isArray(result?.endpoints) ? (result!.endpoints as unknown[]) : [];
      if (items.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(no endpoints)</span>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.slice(0, 10).map((item, i) => {
            const ep = item as { method?: string; path?: string; slug?: string };
            return (
              <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
                <span style={{ color: 'var(--c-accent)' }}>{ep.method ?? '?'}</span>{' '}
                {ep.path ?? ep.slug ?? '?'}
              </div>
            );
          })}
          {items.length > 10 && (
            <div className="font-mono text-[11px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
              … +{items.length - 10} more
            </div>
          )}
        </div>
      );
    },
  },
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

// --- DTO tools (5) ---

const dtoRenderers: Record<string, ToolRenderer> = {
  create_dto: { summary: (i) => `Create DTO: ${cx(i).input.name ?? '?'}` },
  get_dto: { summary: (i) => `Fetch DTO: ${cx(i).input.slug ?? '?'}` },
  update_dto: { summary: (i) => `Update DTO: ${cx(i).input.slug ?? '?'}` },
  delete_dto: { summary: (i) => `Delete DTO: ${cx(i).input.slug ?? '?'}` },
  list_dtos: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const total = result?.total;
      return typeof total === 'number' ? `List DTOs (${total})` : 'List DTOs';
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

// --- Database Table tools (5) ---

const databaseRenderers: Record<string, ToolRenderer> = {
  create_database_table: {
    summary: (i) => `Create table: ${cx(i).input.name ?? '?'}`,
    renderInput(i) {
      const { name, fields, summary } = cx(i).input;
      const cols = Array.isArray(fields) ? (fields as unknown[]) : [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kv('Name', mono(String(name ?? '?')))}
          {summary ? kv('Summary', String(summary)) : null}
          {cols.length > 0
            ? kv(
                'Fields',
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {cols.slice(0, 12).map((c, idx) => {
                    const f = c as { name?: string; type?: string };
                    return (
                      <div key={idx} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
                        {f.name ?? '?'}{' '}
                        <span style={{ color: 'var(--c-subtle)' }}>{f.type ?? ''}</span>
                      </div>
                    );
                  })}
                  {cols.length > 12 && (
                    <div className="font-mono text-[11px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
                      … +{cols.length - 12} more
                    </div>
                  )}
                </div>,
              )
            : null}
        </div>
      );
    },
  },
  get_database_table: { summary: (i) => `Fetch table: ${cx(i).input.slug ?? '?'}` },
  update_database_table: { summary: (i) => `Update table: ${cx(i).input.slug ?? '?'}` },
  delete_database_table: { summary: (i) => `Delete table: ${cx(i).input.slug ?? '?'}` },
  list_database_tables: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const total = result?.total;
      return typeof total === 'number' ? `List tables (${total})` : 'List tables';
    },
    renderResult(r) {
      const { result } = cx2({}, r);
      const items = Array.isArray(result?.tables) ? (result!.tables as unknown[]) : [];
      if (items.length === 0) return <span style={{ color: 'var(--c-subtle)' }}>(no tables)</span>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.slice(0, 12).map((item, i) => {
            const t = item as { name?: string; slug?: string };
            return (
              <div key={i} className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
                {t.name ?? t.slug ?? '?'}
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
      const planId = result?.planId;
      const version = result?.version;
      if (typeof planId !== 'number' || typeof version !== 'number') return null;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="text-[12px]" style={{ color: 'var(--c-ink)' }}>
            Updated to v{version}
          </div>
          <Link
            to="/plans/$planId"
            params={{ planId: String(planId) }}
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
  list_brief_versions: {
    summary(_i, r) {
      const { result } = cx2(_i, r);
      const versions = result?.versions;
      const total = Array.isArray(versions) ? versions.length : null;
      return total !== null ? `List brief versions (${total})` : 'List brief versions';
    },
  },
  get_brief_version: {
    summary(i) {
      return `Brief v${cx(i).input.version ?? '?'}`;
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
  MultiEdit: {
    summary(i) {
      const { file_path, edits } = cx(i).input;
      const count = Array.isArray(edits) ? (edits as unknown[]).length : undefined;
      const base = file_path ? `Edit ${file_path}` : 'Multi-edit';
      return typeof count === 'number' ? `${base} (${count} edits)` : base;
    },
    renderInput(i) {
      const { file_path, edits } = cx(i).input;
      const list = Array.isArray(edits) ? (edits as unknown[]) : [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kv('Path', mono(String(file_path ?? '?')))}
          {kv('Edits', mono(`${list.length}`))}
          {list.length > 0
            ? kv(
                'Diff',
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {list.slice(0, 6).map((e, idx) => {
                    const edit = e as { old_string?: string; new_string?: string };
                    const oldText = typeof edit.old_string === 'string' ? edit.old_string : '';
                    const newText = typeof edit.new_string === 'string' ? edit.new_string : '';
                    return (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div
                          className="font-mono uppercase"
                          style={{ fontSize: 9.5, color: 'var(--c-subtle)', letterSpacing: '0.04em' }}
                        >
                          edit #{idx + 1}
                        </div>
                        <pre
                          className="font-mono text-[11px] scroll-thin"
                          style={{
                            background: 'var(--c-red-soft)',
                            color: 'var(--c-ink)',
                            padding: '4px 6px',
                            borderRadius: 4,
                            margin: 0,
                            maxHeight: 80,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {clip(oldText, 240)}
                        </pre>
                        <pre
                          className="font-mono text-[11px] scroll-thin"
                          style={{
                            background: 'var(--c-green-soft)',
                            color: 'var(--c-ink)',
                            padding: '4px 6px',
                            borderRadius: 4,
                            margin: 0,
                            maxHeight: 80,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {clip(newText, 240)}
                        </pre>
                      </div>
                    );
                  })}
                  {list.length > 6 && (
                    <div className="font-mono text-[11px] scroll-thin" style={{ color: 'var(--c-subtle)' }}>
                      … +{list.length - 6} more edits
                    </div>
                  )}
                </div>,
              )
            : null}
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
    Object.entries(dtoRenderers).map(([k, v]) => [`mcp__dto-tools__${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(referenceRenderers).map(([k, v]) => [`mcp__reference-tools__${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(databaseRenderers).map(([k, v]) => [`mcp__database-tools__${k}`, v]),
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
