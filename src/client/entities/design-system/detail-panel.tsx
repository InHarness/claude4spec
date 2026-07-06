import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Palette, Plus, Trash } from 'lucide-react';
import { DocEditor } from '../../host-ui-kit/detail/DocEditor.js';
import { TagPicker } from '../../host-ui-kit/detail/TagPicker.js';
import { useEntityDraftEditor } from '../_shared/useEntityDraftEditor.js';
import {
  useDeleteDesignSystem,
  useDesignSystem,
  useUpdateDesignSystem,
} from '../../hooks/useDesignSystems.js';
import { useTags } from '../../hooks/useTags.js';
import { useReferences } from '../../hooks/useReferences.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { tagSlug } from '../../../shared/slug.js';
import { aliasTarget, lintTokens, resolve } from '../../../shared/design-system.js';
import {
  COMPOSITE_TOKEN_TYPES,
  UNRESOLVED_TOKEN,
  type DesignMode,
  type DesignSystem,
  type EntityType,
  type ResolvedTokenValue,
  type TokenGroup,
  type TokenValue,
} from '../../../shared/entities.js';

interface Props {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenPage?: (rootId: string, path: string) => void;
}

interface Draft {
  name: string;
  description: string;
  groups: TokenGroup[];
  modes: DesignMode[];
  tags: string[];
}

const TOKEN_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'duration',
  'easing',
  'shadow',
  'opacity',
  'zIndex',
  'number',
  'string',
  'typography',
];

const BASE_MODE = 'Base';

function toDraft(ds: DesignSystem): Draft {
  return {
    name: ds.name,
    description: ds.description ?? '',
    groups: ds.groups,
    modes: ds.modes,
    tags: ds.tags,
  };
}

function isComposite(type: string): boolean {
  return (COMPOSITE_TOKEN_TYPES as readonly string[]).includes(type);
}

/** Build the alias chain for tooltip, e.g. color-action-primary → {blue-500} → #2563eb. */
function aliasChain(name: string, groups: TokenGroup[]): string {
  const base = new Map<string, TokenValue>();
  for (const g of groups) for (const t of g.tokens) base.set(t.name, t.value);
  const parts: string[] = [name];
  const seen = new Set<string>([name]);
  let cur = base.get(name);
  while (typeof cur === 'string') {
    const target = aliasTarget(cur);
    if (!target) {
      parts.push(cur);
      break;
    }
    parts.push(`{${target}}`);
    if (seen.has(target) || !base.has(target)) {
      parts.push(UNRESOLVED_TOKEN);
      break;
    }
    seen.add(target);
    cur = base.get(target);
  }
  return parts.join(' → ');
}

export function DesignSystemDetail({ slug, onDeleted, onRenamed, onOpenEntity }: Props) {
  const { data: ds, isLoading, error } = useDesignSystem(slug);
  const update = useUpdateDesignSystem();
  const remove = useDeleteDesignSystem();
  const { data: allTags = [] } = useTags();
  const { data: refs = [] } = useReferences('design-system', ds?.slug ?? null);

  const [warnings, setWarnings] = useState<string[]>([]);
  const [activeMode, setActiveMode] = useState<string>(BASE_MODE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { draft, dirty, patch } = useEntityDraftEditor({
    entity: ds,
    toDraft,
    save: async (current, entity) => {
      const updated = await update.mutateAsync({
        slug: entity.slug,
        input: {
          name: current.name,
          description: current.description || null,
          groups: current.groups,
          modes: current.modes,
          tags: current.tags,
        },
      });
      setWarnings(updated.warnings ?? []);
      if (updated.warnings?.length) {
        toast.warning(`${updated.warnings.length} linter warning(s)`);
      }
      if (updated.slug !== entity.slug) onRenamed(updated.slug);
      return updated;
    },
  });

  // Live (client-side) lint for per-row warning icons, independent of last save.
  const liveWarnings = useMemo(
    () => (draft ? lintTokens(draft.groups, draft.modes) : []),
    [draft]
  );

  const resolved = useMemo<Record<string, ResolvedTokenValue>>(() => {
    if (!draft) return {};
    return resolve(draft.groups, draft.modes, activeMode === BASE_MODE ? undefined : activeMode);
  }, [draft, activeMode]);

  async function handleDelete() {
    if (!ds) return;
    const refCount = refs.length;
    const body = refCount
      ? `Delete design system "${ds.name}"? ${refCount} page${refCount === 1 ? '' : 's'} reference it and will become broken. UI views pointing at it will show a broken chip.`
      : `Delete design system "${ds.name}"? UI views pointing at it will show a broken chip. This cannot be undone.`;
    const ok = await confirmDestructive({ title: 'Delete design system?', body, confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await remove.mutateAsync(ds.slug);
      onDeleted();
      toast.success(`Design system ${ds.name} deleted`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function toggleTag(tagSlug: string) {
    if (!draft) return;
    const next = draft.tags.includes(tagSlug)
      ? draft.tags.filter((t) => t !== tagSlug)
      : [...draft.tags, tagSlug];
    patch({ tags: next });
  }

  function handleCreateTag(name: string) {
    if (!draft) return;
    const slug = tagSlug(name);
    if (!slug || draft.tags.includes(slug)) return;
    patch({ tags: [...draft.tags, slug] });
  }

  // ─── group / token / mode editing ─────────────────────────────────────────

  function updateGroups(groups: TokenGroup[]) {
    patch({ groups });
  }

  function addGroup() {
    if (!draft) return;
    updateGroups([...draft.groups, { name: `Group ${draft.groups.length + 1}`, tier: 'primitive', tokens: [] }]);
  }

  function renameGroup(idx: number, name: string) {
    if (!draft) return;
    updateGroups(draft.groups.map((g, i) => (i === idx ? { ...g, name } : g)));
  }

  function setGroupTier(idx: number, tier: 'primitive' | 'semantic') {
    if (!draft) return;
    updateGroups(draft.groups.map((g, i) => (i === idx ? { ...g, tier } : g)));
  }

  function removeGroup(idx: number) {
    if (!draft) return;
    updateGroups(draft.groups.filter((_, i) => i !== idx));
  }

  function addToken(gIdx: number) {
    if (!draft) return;
    updateGroups(
      draft.groups.map((g, i) =>
        i === gIdx ? { ...g, tokens: [...g.tokens, { name: '', type: 'color', value: '' }] } : g
      )
    );
  }

  function updateToken(gIdx: number, tIdx: number, partial: Partial<{ name: string; type: string; value: TokenValue; description: string }>) {
    if (!draft) return;
    updateGroups(
      draft.groups.map((g, i) =>
        i === gIdx
          ? { ...g, tokens: g.tokens.map((t, j) => (j === tIdx ? { ...t, ...partial } : t)) }
          : g
      )
    );
  }

  function removeToken(gIdx: number, tIdx: number) {
    if (!draft) return;
    updateGroups(
      draft.groups.map((g, i) => (i === gIdx ? { ...g, tokens: g.tokens.filter((_, j) => j !== tIdx) } : g))
    );
  }

  function toggleCollapse(name: string) {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // ─── modes ─────────────────────────────────────────────────────────────────

  function addMode() {
    if (!draft) return;
    const name = `mode-${draft.modes.length + 1}`;
    patch({ modes: [...draft.modes, { name, overrides: [] }] });
    setActiveMode(name);
  }

  function updateMode(idx: number, next: DesignMode) {
    if (!draft) return;
    patch({ modes: draft.modes.map((m, i) => (i === idx ? next : m)) });
  }

  function removeMode(idx: number) {
    if (!draft) return;
    const removed = draft.modes[idx];
    patch({ modes: draft.modes.filter((_, i) => i !== idx) });
    if (removed && activeMode === removed.name) setActiveMode(BASE_MODE);
  }

  if (isLoading && !ds) {
    return <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>Loading design system…</div>;
  }
  if (error) {
    return <div className="p-8 text-[13px]" style={{ color: 'var(--c-red)' }}>Failed to load: {(error as Error).message}</div>;
  }
  if (!ds || !draft) return null;

  const tokenCount = draft.groups.reduce((acc, g) => acc + g.tokens.length, 0);
  const allTokenNames = draft.groups.flatMap((g) => g.tokens.map((t) => t.name)).filter(Boolean);
  const activeModeObj = draft.modes.find((m) => m.name === activeMode) ?? null;

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 960, padding: '48px 56px 140px' }}>
        {/* header meta */}
        <div className="flex items-center gap-2 mb-1 text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          <span className="font-mono">{ds.slug}</span>
          <span>·</span>
          <span>
            updated{' '}
            {new Date(ds.updatedAt.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          {update.isPending && <span style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}>saving…</span>}
          {!update.isPending && dirty && <span style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}>edited</span>}
          <span className="flex-1" />
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
            style={{ color: 'var(--c-red, #c45a3b)' }}
            title="Delete"
          >
            <Trash size={11} /> Delete
          </button>
        </div>

        {/* name + counts */}
        <div className="flex items-center gap-2 mt-2 mb-1">
          <Palette size={22} style={{ color: 'var(--c-accent)' }} />
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: 26, fontWeight: 600, color: 'var(--c-ink)' }}
            placeholder="Design System Name"
            spellCheck={false}
          />
          <span
            className="font-mono text-[11px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
          >
            {draft.groups.length} groups / {tokenCount} tokens
          </span>
        </div>

        {/* tags */}
        <div className="mt-3">
          <TagPicker
            allTags={allTags}
            selected={draft.tags}
            onToggle={toggleTag}
            onCreate={handleCreateTag}
            variant="collapsed"
          />
        </div>

        {/* warnings */}
        {warnings.length > 0 && (
          <div
            className="mt-4 rounded-md p-3"
            style={{ background: 'var(--c-yellow-soft, rgba(196,162,79,0.12))', border: '1px dashed var(--c-yellow, #c4a24f)' }}
          >
            <div
              className="flex items-center gap-1.5 mb-1 text-[11px] uppercase font-mono tracking-wider"
              style={{ color: 'var(--c-yellow-ink, #c4a24f)' }}
            >
              <AlertTriangle size={11} /> Warnings
            </div>
            <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--c-ink)' }}>
              {warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* description */}
        <div className="mt-8">
          <SectionLabel>Description</SectionLabel>
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="What this design system covers, when to use it, conventions…"
          />
        </div>

        {/* mode switcher */}
        <div className="mt-10">
          <SectionLabel>Modes</SectionLabel>
          <ModeSwitcher
            modes={draft.modes}
            activeMode={activeMode}
            onSelect={setActiveMode}
            onAddMode={addMode}
          />
          {activeModeObj && (
            <ModeOverridesEditor
              mode={activeModeObj}
              tokenNames={allTokenNames}
              onChange={(next) => updateMode(draft.modes.indexOf(activeModeObj), next)}
              onRemove={() => removeMode(draft.modes.indexOf(activeModeObj))}
            />
          )}
        </div>

        {/* token groups */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-2">
            <SectionLabel>Token groups</SectionLabel>
            <span className="flex-1" />
            <button
              onClick={addGroup}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
              style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}
            >
              <Plus size={11} /> add group
            </button>
          </div>
          {draft.groups.length === 0 && (
            <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
              No token groups yet.
            </div>
          )}
          {draft.groups.map((g, gIdx) => (
            <TokenGroupEditor
              key={gIdx}
              group={g}
              collapsed={collapsed.has(g.name)}
              tokenNames={allTokenNames}
              liveWarnings={liveWarnings}
              onToggleCollapse={() => toggleCollapse(g.name)}
              onRename={(name) => renameGroup(gIdx, name)}
              onTier={(tier) => setGroupTier(gIdx, tier)}
              onRemove={() => removeGroup(gIdx)}
              onAddToken={() => addToken(gIdx)}
              onUpdateToken={(tIdx, partial) => updateToken(gIdx, tIdx, partial)}
              onRemoveToken={(tIdx) => removeToken(gIdx, tIdx)}
            />
          ))}
        </div>

        {/* preview */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-2">
            <SectionLabel>Preview</SectionLabel>
            <span className="text-[10.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
              {activeMode}
            </span>
          </div>
          <DesignSystemPreview groups={draft.groups} resolved={resolved} />
        </div>

        <datalist id="design-system-token-types">
          {TOKEN_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <datalist id="design-system-token-names">
          {allTokenNames.map((n) => (
            <option key={n} value={`{${n}}`} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

// ─── ModeSwitcher (segmented control) ─────────────────────────────────────────

function ModeSwitcher({
  modes,
  activeMode,
  onSelect,
  onAddMode,
}: {
  modes: DesignMode[];
  activeMode: string;
  onSelect: (mode: string) => void;
  onAddMode: () => void;
}) {
  const all = [BASE_MODE, ...modes.map((m) => m.name)];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div
        className="inline-flex items-center rounded-md overflow-hidden"
        style={{ border: '1px solid var(--c-hair)' }}
      >
        {all.map((name) => (
          <button
            key={name}
            onClick={() => onSelect(name)}
            className="px-2.5 py-1 text-[12px] font-mono transition"
            style={{
              background: activeMode === name ? 'var(--c-accent)' : 'transparent',
              color: activeMode === name ? '#fff' : 'var(--c-muted)',
              borderLeft: name === BASE_MODE ? 'none' : '1px solid var(--c-hair)',
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <button
        onClick={onAddMode}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded"
        style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}
      >
        <Plus size={11} /> Add mode
      </button>
    </div>
  );
}

function ModeOverridesEditor({
  mode,
  tokenNames,
  onChange,
  onRemove,
}: {
  mode: DesignMode;
  tokenNames: string[];
  onChange: (next: DesignMode) => void;
  onRemove: () => void;
}) {
  function addOverride() {
    onChange({ ...mode, overrides: [...mode.overrides, { token: '', value: '' }] });
  }
  function updateOverride(idx: number, partial: Partial<{ token: string; value: TokenValue }>) {
    onChange({
      ...mode,
      overrides: mode.overrides.map((o, i) => (i === idx ? { ...o, ...partial } : o)),
    });
  }
  function removeOverride(idx: number) {
    onChange({ ...mode, overrides: mode.overrides.filter((_, i) => i !== idx) });
  }
  return (
    <div
      className="mt-3 rounded-md p-3"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <input
          value={mode.name}
          onChange={(e) => onChange({ ...mode, name: e.target.value })}
          className="font-mono text-[12.5px] bg-transparent outline-none px-2 py-1 rounded"
          style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
          spellCheck={false}
        />
        <span className="flex-1" />
        <button onClick={addOverride} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}>
          <Plus size={11} /> add override
        </button>
        <button onClick={onRemove} className="text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--c-red, #c45a3b)' }}>
          remove mode
        </button>
      </div>
      {mode.overrides.length === 0 && (
        <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          No overrides — this mode renders identically to Base.
        </div>
      )}
      {mode.overrides.map((o, i) => (
        <div key={i} className="grid gap-2 items-center mb-1" style={{ gridTemplateColumns: '1.4fr 1.4fr 24px' }}>
          <input
            list="design-system-token-names-plain"
            value={o.token}
            onChange={(e) => updateOverride(i, { token: e.target.value })}
            className="font-mono text-[12px] bg-transparent outline-none px-1.5 py-1 rounded"
            style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
            placeholder="token name"
            spellCheck={false}
          />
          <input
            value={typeof o.value === 'string' ? o.value : JSON.stringify(o.value)}
            onChange={(e) => updateOverride(i, { value: e.target.value })}
            className="font-mono text-[12px] bg-transparent outline-none px-1.5 py-1 rounded"
            style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
            placeholder="{token} or literal"
            spellCheck={false}
          />
          <button onClick={() => removeOverride(i)} className="text-[12px]" style={{ color: 'var(--c-subtle)' }} title="Remove override">
            ×
          </button>
        </div>
      ))}
      <datalist id="design-system-token-names-plain">
        {tokenNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}

// ─── TokenGroupEditor ─────────────────────────────────────────────────────────

function TokenGroupEditor({
  group,
  collapsed,
  liveWarnings,
  onToggleCollapse,
  onRename,
  onTier,
  onRemove,
  onAddToken,
  onUpdateToken,
  onRemoveToken,
}: {
  group: TokenGroup;
  collapsed: boolean;
  tokenNames: string[];
  liveWarnings: string[];
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onTier: (tier: 'primitive' | 'semantic') => void;
  onRemove: () => void;
  onAddToken: () => void;
  onUpdateToken: (tIdx: number, partial: Partial<{ name: string; type: string; value: TokenValue; description: string }>) => void;
  onRemoveToken: (tIdx: number) => void;
}) {
  return (
    <div className="rounded-md mb-3" style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggleCollapse} style={{ color: 'var(--c-subtle)' }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <input
          value={group.name}
          onChange={(e) => onRename(e.target.value)}
          className="text-[13px] bg-transparent outline-none"
          style={{ color: 'var(--c-ink)', fontWeight: 500 }}
          placeholder="Group name"
          spellCheck={false}
        />
        <select
          value={group.tier}
          onChange={(e) => onTier(e.target.value as 'primitive' | 'semantic')}
          className="text-[11px] font-mono bg-transparent outline-none px-1 rounded"
          style={{ color: 'var(--c-muted)', border: '1px solid var(--c-hair)' }}
        >
          <option value="primitive">primitive</option>
          <option value="semantic">semantic</option>
        </select>
        <span className="flex-1" />
        <button onClick={onAddToken} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}>
          <Plus size={11} /> add token
        </button>
        <button onClick={onRemove} className="text-[12px]" style={{ color: 'var(--c-red, #c45a3b)' }} title="Delete group">
          <Trash size={12} />
        </button>
      </div>
      {!collapsed && group.tokens.length > 0 && (
        <div className="px-3 pb-2 overflow-x-auto">
          <div style={{ minWidth: 680 }}>
            <div
              className="grid gap-2 px-1 py-1 text-[10.5px] uppercase font-mono tracking-wider"
              style={{ gridTemplateColumns: '1.3fr 1fr 1.6fr 1.6fr 20px 20px', color: 'var(--c-subtle)', borderBottom: '1px solid var(--c-hair)' }}
            >
              <span>name</span>
              <span>type</span>
              <span>value</span>
              <span>description</span>
              <span />
              <span />
            </div>
            {group.tokens.map((t, tIdx) => {
              const composite = isComposite(t.type);
              const hasIssue = liveWarnings.some((w) => w.includes(`'${t.name}'`)) && Boolean(t.name);
              return (
                <div
                  key={tIdx}
                  className="grid gap-2 items-center px-1 py-1"
                  style={{ gridTemplateColumns: '1.3fr 1fr 1.6fr 1.6fr 20px 20px', borderBottom: '1px solid var(--c-hair)' }}
                >
                  <input
                    value={t.name}
                    onChange={(e) => onUpdateToken(tIdx, { name: e.target.value })}
                    className="font-mono text-[12px] bg-transparent outline-none"
                    style={{ color: 'var(--c-ink)' }}
                    placeholder="token-name"
                    spellCheck={false}
                  />
                  <input
                    list="design-system-token-types"
                    value={t.type}
                    onChange={(e) => onUpdateToken(tIdx, { type: e.target.value })}
                    className="font-mono text-[12px] bg-transparent outline-none"
                    style={{ color: 'var(--c-muted)' }}
                    spellCheck={false}
                  />
                  <TokenValueInput
                    type={t.type}
                    value={t.value}
                    composite={composite}
                    onChange={(value) => onUpdateToken(tIdx, { value })}
                  />
                  <input
                    value={t.description ?? ''}
                    onChange={(e) => onUpdateToken(tIdx, { description: e.target.value || undefined })}
                    className="text-[12px] bg-transparent outline-none"
                    style={{ color: 'var(--c-muted)' }}
                    placeholder="optional"
                  />
                  {hasIssue ? (
                    <AlertTriangle size={12} style={{ color: 'var(--c-yellow-ink, #c4a24f)' }} aria-label="linter warning" />
                  ) : (
                    <span />
                  )}
                  <button onClick={() => onRemoveToken(tIdx)} className="text-[12px]" style={{ color: 'var(--c-subtle)' }} title="Remove token">
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenValueInput({
  type,
  value,
  composite,
  onChange,
}: {
  type: string;
  value: TokenValue;
  composite: boolean;
  onChange: (value: TokenValue) => void;
}) {
  if (composite) {
    // Composite sub-form: edit each field of the object (literal or {alias}).
    const obj = typeof value === 'object' && value !== null ? value : {};
    const entries = Object.entries(obj);
    const fields = type === 'typography'
      ? ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']
      : ['offsetX', 'offsetY', 'blur', 'spread', 'color'];
    const known = new Set(fields);
    const extra = entries.filter(([k]) => !known.has(k));
    return (
      <div className="flex flex-col gap-1">
        {[...fields, ...extra.map(([k]) => k)].map((f) => (
          <input
            key={f}
            list="design-system-token-names"
            value={(obj as Record<string, string>)[f] ?? ''}
            onChange={(e) => onChange({ ...obj, [f]: e.target.value })}
            className="font-mono text-[11px] bg-transparent outline-none px-1 rounded"
            style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
            placeholder={f}
            spellCheck={false}
          />
        ))}
      </div>
    );
  }
  const str = typeof value === 'string' ? value : '';
  const isAlias = aliasTarget(str) !== null;
  return (
    <div className="flex items-center gap-1">
      {type === 'color' && !isAlias && /^#|^rgb|^hsl/.test(str) && (
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(str) ? str : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 22, height: 22, border: 'none', background: 'transparent', padding: 0 }}
          title="color"
        />
      )}
      <input
        list="design-system-token-names"
        value={str}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-[12px] bg-transparent outline-none flex-1"
        style={{ color: isAlias ? 'var(--c-accent)' : 'var(--c-ink)' }}
        placeholder="literal or {alias}"
        spellCheck={false}
      />
    </div>
  );
}

// ─── DesignSystemPreview ──────────────────────────────────────────────────────

function DesignSystemPreview({
  groups,
  resolved,
}: {
  groups: TokenGroup[];
  resolved: Record<string, ResolvedTokenValue>;
}) {
  // Bucket tokens by type for the right visual treatment.
  const colors: Array<{ name: string }> = [];
  const typography: Array<{ name: string }> = [];
  const scales: Array<{ name: string; type: string }> = [];
  const others: Array<{ name: string; type: string }> = [];

  for (const g of groups) {
    for (const t of g.tokens) {
      if (!t.name) continue;
      if (t.type === 'color') colors.push({ name: t.name });
      else if (t.type === 'typography') typography.push({ name: t.name });
      else if (['dimension', 'fontSize', 'letterSpacing', 'lineHeight', 'duration', 'easing', 'shadow'].includes(t.type))
        scales.push({ name: t.name, type: t.type });
      else others.push({ name: t.name, type: t.type });
    }
  }

  const empty = colors.length + typography.length + scales.length + others.length === 0;
  if (empty) {
    return <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>No tokens to preview yet.</div>;
  }

  return (
    <div className="rounded-md p-4" style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}>
      {colors.length > 0 && (
        <ColorSwatchGrid items={colors} resolved={resolved} groups={groups} />
      )}
      {typography.length > 0 && (
        <TypographySpecimen items={typography} resolved={resolved} />
      )}
      {scales.length > 0 && <ScaleStrip items={scales} resolved={resolved} />}
      {others.length > 0 && (
        <table className="mt-4 text-[12px] w-full">
          <tbody>
            {others.map((o) => (
              <tr key={o.name}>
                <td className="font-mono pr-4" style={{ color: 'var(--c-ink)' }}>{o.name}</td>
                <td className="font-mono" style={{ color: 'var(--c-muted)' }}>
                  {renderScalar(resolved[o.name])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function renderScalar(v: ResolvedTokenValue | undefined): React.ReactNode {
  if (v === undefined) return '—';
  if (v === UNRESOLVED_TOKEN) return <span style={{ color: 'var(--c-subtle)', textDecoration: 'line-through' }}>unresolved</span>;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function ColorSwatchGrid({
  items,
  resolved,
  groups,
}: {
  items: Array<{ name: string }>;
  resolved: Record<string, ResolvedTokenValue>;
  groups: TokenGroup[];
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map(({ name }) => {
        const v = resolved[name];
        const unresolved = v === UNRESOLVED_TOKEN || typeof v !== 'string';
        const color = unresolved ? undefined : (v as string);
        return (
          <div key={name} className="flex flex-col items-center" title={aliasChain(name, groups)}>
            <div
              className="rounded-md"
              style={{
                width: 48,
                height: 48,
                background: color ?? 'transparent',
                border: '1px solid var(--c-hair)',
                position: 'relative',
              }}
            >
              {unresolved && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--c-subtle)',
                    fontSize: 9,
                  }}
                >
                  ✕
                </div>
              )}
            </div>
            <span className="font-mono text-[10px] mt-1" style={{ color: 'var(--c-muted)' }}>{name}</span>
          </div>
        );
      })}
    </div>
  );
}

function TypographySpecimen({
  items,
  resolved,
}: {
  items: Array<{ name: string }>;
  resolved: Record<string, ResolvedTokenValue>;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3">
      {items.map(({ name }) => {
        const v = resolved[name];
        if (typeof v !== 'object' || v === null) {
          return (
            <div key={name} className="text-[12px]" style={{ color: 'var(--c-subtle)', textDecoration: 'line-through' }}>
              {name}: unresolved
            </div>
          );
        }
        const style: React.CSSProperties = {
          fontFamily: v.fontFamily,
          fontSize: v.fontSize,
          fontWeight: v.fontWeight as React.CSSProperties['fontWeight'],
          lineHeight: v.lineHeight,
          letterSpacing: v.letterSpacing,
          color: 'var(--c-ink)',
        };
        return (
          <div key={name}>
            <span className="font-mono text-[10px] block" style={{ color: 'var(--c-subtle)' }}>{name}</span>
            <span style={style}>The quick brown fox</span>
          </div>
        );
      })}
    </div>
  );
}

function ScaleStrip({
  items,
  resolved,
}: {
  items: Array<{ name: string; type: string }>;
  resolved: Record<string, ResolvedTokenValue>;
}) {
  return (
    <div className="mt-5 flex flex-wrap gap-4 items-end">
      {items.map(({ name, type }) => {
        const v = resolved[name];
        const unresolved = v === UNRESOLVED_TOKEN || typeof v !== 'string';
        const val = unresolved ? '' : (v as string);
        return (
          <div key={name} className="flex flex-col items-center gap-1">
            {type === 'dimension' || type === 'fontSize' || type === 'lineHeight' || type === 'letterSpacing' ? (
              <div
                style={{
                  width: 12,
                  height: unresolved ? 6 : Math.max(4, Math.min(64, parseFloat(val) || 8)),
                  background: 'var(--c-accent)',
                  opacity: unresolved ? 0.3 : 1,
                  borderRadius: 2,
                }}
              />
            ) : type === 'shadow' ? (
              <div
                style={{ width: 40, height: 28, background: 'var(--c-card)', borderRadius: 4, boxShadow: unresolved ? 'none' : val, border: '1px solid var(--c-hair)' }}
              />
            ) : (
              <div
                className="font-mono text-[10px] px-1.5 py-1 rounded"
                style={{ background: 'var(--c-panel)', color: unresolved ? 'var(--c-subtle)' : 'var(--c-ink)' }}
              >
                {unresolved ? 'unresolved' : val}
              </div>
            )}
            <span className="font-mono text-[9.5px]" style={{ color: 'var(--c-subtle)' }}>{name}</span>
          </div>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase font-mono tracking-wider mb-2" style={{ color: 'var(--c-subtle)' }}>
      {children}
    </div>
  );
}
