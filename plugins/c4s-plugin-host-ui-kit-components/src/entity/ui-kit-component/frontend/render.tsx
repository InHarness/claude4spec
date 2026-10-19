/**
 * The render slots of `ui-kit-component` (c4s-plugin-host-ui-kit-components
 * `ctpko3bp`, "Render w treści"):
 *
 * - chip — the type icon, `name` and a `Badge` with `stability`; a broken chip
 *   is a `Badge` in the `broken` variant carrying the slug, not clickable (2.1.39);
 * - card — `name`, badges for `group`, `stability` and `binding`, the number of
 *   props, `composes` chips and the tags as `TagChip`s;
 * - row — `EntityListRow` with the subtitle "<n> props · <binding>" and the
 *   badges in the meta (trailing) slot.
 *
 * Purely presentational: the host injects the resolved entity. No hooks — the
 * host's registration smoke test renders the chip with `entity: null` outside
 * any provider. Colours are `var(--c-*)` tokens only.
 */

import type { FC } from 'react';
import { Blocks } from 'lucide-react';
import { editorBridge } from '@c4s/plugin-runtime';
import type { EntityCardProps, EntityChipProps, EntityRowProps } from '@c4s/plugin-runtime';
import { Badge, EntityListRow, TagChip } from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import { UI_KIT_COMPONENT_TYPE } from '../../../identity.js';
import type { UiKitComponent } from '../../../types.js';
import { rowSubtitle } from './list-model.js';

export const UiKitComponentIcon = Blocks;


export const UiKitComponentChip: FC<EntityChipProps<UiKitComponent>> = ({ slug, entity, onOpen }) => {
  const open = () => (onOpen ? onOpen() : editorBridge.openEntity(UI_KIT_COMPONENT_TYPE, slug));
  if (!entity) return <Badge variant="broken" label={slug} />;
  return (
    <button
      type="button"
      onClick={open}
      data-testid="ui-kit-component-chip"
      className="c4s-chip inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px]"
      style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)', fontSize: 12 }}
    >
      <UiKitComponentIcon size={11} style={{ color: 'var(--c-accent)' }} />
      <span style={{ color: 'var(--c-ink)' }}>{entity.name}</span>
      <Badge small label={entity.stability} />
    </button>
  );
};

export const UiKitComponentCard: FC<EntityCardProps<UiKitComponent>> = ({ slug, entity, onOpen, caption }) => {
  const open = () => (onOpen ? onOpen() : editorBridge.openEntity(UI_KIT_COMPONENT_TYPE, slug));
  // The card stays the type's markup; its broken branch is the same non-clickable broken Badge.
  if (!entity) return <Badge variant="broken" label={slug} />;
  const n = entity.props?.length ?? 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') open();
      }}
      data-testid="ui-kit-component-card"
      className="rounded p-3 my-2"
      style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)', cursor: 'pointer' }}
    >
      <div className="flex items-center gap-2">
        <UiKitComponentIcon size={14} style={{ color: 'var(--c-accent)' }} />
        <span className="font-mono text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
          {entity.name}
        </span>
        <Badge small label={entity.group} />
        <Badge small label={entity.stability} />
        <Badge small label={entity.binding} />
      </div>
      <div className="text-[12.5px] mt-1" style={{ color: 'var(--c-muted)' }}>
        {`${n} ${n === 1 ? 'prop' : 'props'}`}
      </div>
      {(entity.composes?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1" data-testid="ui-kit-component-card-composes">
          {entity.composes.map((c) => (
            // 2.1.39: `Badge` is a value marker with no click — the link is a button around it.
            <button
              key={c.component}
              type="button"
              className="inline-flex"
              onClick={() => editorBridge.openEntity(UI_KIT_COMPONENT_TYPE, c.component)}
            >
              <Badge small mono label={c.component} />
            </button>
          ))}
        </div>
      )}
      {(entity.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1" data-testid="ui-kit-component-card-tags">
          {entity.tags.map((t) => (
            <TagChip key={t} small label={t} />
          ))}
        </div>
      )}
      {caption && (
        <div className="text-[12px] mt-1" style={{ color: 'var(--c-subtle)' }}>
          {caption}
        </div>
      )}
    </div>
  );
};

/** Embedded rows carry no tag chips — the host embed passes no tag context. */
const EMPTY_TAG_LOOKUP = new Map<string, Tag>();

/** The row body, shared by the `renderRow` slot and the type's own list screen. */
export const UiKitComponentListRow: FC<{
  entity: UiKitComponent;
  onOpen?: () => void;
  active?: boolean;
  tags?: string[];
  tagLookup?: Map<string, Tag>;
}> = ({ entity, onOpen, active, tags, tagLookup }) => (
  <EntityListRow
    icon={UiKitComponentIcon}
    onClick={onOpen ?? (() => {})}
    style={active ? { background: 'var(--c-accent-soft)' } : undefined}
    tags={tags ?? []}
    tagLookup={tagLookup ?? EMPTY_TAG_LOOKUP}
    trailing={
      <span className="inline-flex items-center gap-1" data-testid="ui-kit-component-row-meta">
        <Badge small label={entity.stability} />
        <Badge small label={entity.binding} />
      </span>
    }
  >
    <div className="font-mono text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
      {entity.name}
    </div>
    <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
      {rowSubtitle(entity)}
    </div>
  </EntityListRow>
);

export const UiKitComponentRow: FC<EntityRowProps<UiKitComponent>> = ({ entity, active, onOpen }) => (
  <UiKitComponentListRow entity={entity} active={active} onOpen={onOpen} />
);
