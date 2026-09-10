import { CheckSquare, ChevronRight } from 'lucide-react';
import type {
  EntityCardProps,
  EntityChipProps,
  EntityRowProps,
  FrontendModule,
} from '@c4s/plugin-runtime';
import type { Ac } from '../../../types.js';
import {
  AC_DISPLAY_ORDER,
  AC_LABEL,
  AC_LABEL_PLURAL,
  AC_PATH_PREFIX,
  AC_TYPE,
  shortLabel,
} from '../../../identity.js';
import { useAc } from './hooks.js';
import { acsApi } from './api.js';
import { AcDetail } from './detail-panel.js';
import { acRoutes } from './routes.js';
import { acData, acSlugPattern } from '../schema.js';

function AcRow({ entity, active, onOpen }: EntityRowProps<Ac>) {
  const deprecated = entity.status === 'deprecated';
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition"
      style={{
        background: active ? 'var(--c-accent-soft)' : 'transparent',
        opacity: deprecated ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--c-panel)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <CheckSquare size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="flex-1 min-w-0">
        {/* Same rule as the chip, deliberately — a row and a chip are the two
            places a criterion appears as a reference to itself. */}
        <span
          className="block text-[13px]"
          style={{ color: 'var(--c-ink)', fontWeight: 500 }}
          title={entity.title}
        >
          {shortLabel(entity.title)}
        </span>
        <span className="block text-[10.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
          {entity.kind}
          {deprecated && ' · deprecated'}
        </span>
      </span>
      {entity.verifies.length > 0 && (
        <span
          className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
          title={`Verifies ${entity.verifies.length} entity reference(s)`}
        >
          ↪{entity.verifies.length}
        </span>
      )}
    </button>
  );
}

function AcChip({ slug, entity, onOpen }: EntityChipProps<Ac>) {
  if (!entity) {
    return (
      <button
        onClick={onOpen}
        title={`broken reference: ac '${slug}'`}
        className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px] font-mono"
        style={{
          background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
          color: 'var(--c-red, #c45a3b)',
          border: '1px solid var(--c-red, #c45a3b)',
        }}
      >
        ⚠ {slug}
      </button>
    );
  }
  const deprecated = entity.status === 'deprecated';
  return (
    <button
      onClick={onOpen}
      className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] transition"
      style={{
        border: '1px solid var(--c-hair)',
        background: 'var(--c-card)',
        fontSize: 12,
        opacity: deprecated ? 0.65 : 1,
        textDecoration: deprecated ? 'line-through' : undefined,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
      title={entity.title}
    >
      <CheckSquare size={11} style={{ color: 'var(--c-accent)' }} />
      {/*
        0.2.51 — truncation comes BACK here, for the opposite reason it left.
        It left in 0.2.22 because `title` was a 200-character label the host
        bounded, so shortening it again was a per-type guess. It returns because
        `title` is no longer a label: it is the criterion, up to 500 characters,
        and a chip is not where a paragraph goes. See `shortLabel`.
      */}
      <span style={{ color: 'var(--c-ink)' }}>{shortLabel(entity.title)}</span>
    </button>
  );
}

function AcCard({ slug, entity, onOpen }: EntityCardProps<Ac>) {
  if (!entity) {
    return (
      <div
        className="rounded-md p-3"
        style={{
          background: 'var(--c-red-soft, rgba(196,90,59,0.08))',
          border: '1px dashed var(--c-red, #c45a3b)',
          color: 'var(--c-red, #c45a3b)',
        }}
      >
        <div className="text-[12px] font-mono">⚠ broken: ac "{slug}"</div>
      </div>
    );
  }
  const deprecated = entity.status === 'deprecated';
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-md p-3 transition"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
        opacity: deprecated ? 0.7 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <div className="flex items-start gap-2">
        <CheckSquare size={14} style={{ color: 'var(--c-accent)', marginTop: 2 }} />
        <span
          className="flex-1 text-[14px]"
          style={{
            color: 'var(--c-ink)',
            fontWeight: 500,
            textDecoration: deprecated ? 'line-through' : undefined,
          }}
        >
          {entity.title}
        </span>
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)', marginTop: 2 }} />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
        <span>{entity.kind}</span>
        {deprecated && <span>· deprecated</span>}
        {entity.verifies.length > 0 && (
          <span title="verifies count">· verifies {entity.verifies.length}</span>
        )}
      </div>
      {/* The card is the one reference-shaped view with room for the whole
          criterion, so it neither truncates the title nor hides the tags. */}
      {entity.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {entity.tags.map((tag) => (
            <span
              key={tag}
              className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/**
 * 0.2.80 — ONE registration, and it is a declaration.
 *
 * The host file this replaces did three things: it registered this module, it
 * ALSO called the legacy `registerEntity<Ac>()` with a near-duplicate of the
 * same renderers, and it declared a `/ac` slash command through
 * `registerEditorExtension`. None of the three survives as written.
 *
 * The legacy registry is host-internal and its second copy of the renderers was
 * exactly the kind of drift a single declaration exists to prevent. The slash
 * command moved to `contributes.commands` on the manifest — declaring it here
 * as well is the trap two envelopes already fell into: the palette matches both
 * entries, the module-borne one wins because modules mount before commands
 * register, and choosing it deletes the typed text and opens nothing, because
 * only the manifest entry carries the `popoverKind`.
 */
export const acFrontendModule: FrontendModule = {
  type: AC_TYPE,
  data: acData,
  slugPattern: acSlugPattern,
  // Tracks the backend contribution (`entity/ac/index.ts`): 2 when `title` was
  // lifted out of `text`, 3 when `text` and `description` were collapsed back
  // INTO it. Left behind, the two halves of the same type would disagree about
  // their own payload age — which is why both now read the SAME constants for
  // everything else, from `identity.ts`.
  payloadVersion: 3,
  label: AC_LABEL,
  labelPlural: AC_LABEL_PLURAL,
  displayOrder: AC_DISPLAY_ORDER,
  pathPrefix: AC_PATH_PREFIX,
  renderRow: AcRow as FrontendModule['renderRow'],
  renderChip: AcChip as FrontendModule['renderChip'],
  renderCard: AcCard as FrontendModule['renderCard'],
  detailPanel: AcDetail,
  routes: acRoutes,
  useGetBySlug: (slug) => useAc(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => acsApi.list({ tags, tagFilter: filter, status: 'all' }),
  sidebarTab: { icon: CheckSquare, label: AC_LABEL_PLURAL, order: AC_DISPLAY_ORDER },
};
