import { useEffect, useRef, useState } from 'react';
import { Edit3 } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  SelectInput,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';
import { ENTITY_TYPES, type ChipNodeType } from '../events.js';
import type { EntityType } from '../../../shared/entities.js';

type FilterMode = 'and' | 'or';

const TITLE_FOR: Record<ChipNodeType, string> = {
  inline_mention: 'Edit mention',
  single_element: 'Edit element',
  element_list: 'Edit element list',
  tagged_list: 'Edit tagged list',
  tagged_list_mixed: 'Edit tagged list (mixed)',
};

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function parseCsv(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(',');
  return '';
}

export function EditChipForm({ request, onClose }: PopoverFormProps<'edit-chip'>) {
  const { nodeType, attrs, onRemove } = request.props;
  const firstRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<EntityType>(
    (str(attrs.type, 'endpoint') as EntityType) || 'endpoint',
  );
  const [slug, setSlug] = useState(str(attrs.slug));
  const [slugsRaw, setSlugsRaw] = useState(parseCsv(attrs.slugs));
  const [tagsRaw, setTagsRaw] = useState(parseCsv(attrs.tags));
  const [filter, setFilter] = useState<FilterMode>(
    str(attrs.filter, 'and') === 'or' ? 'or' : 'and',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    setError(null);
    switch (nodeType) {
      case 'inline_mention':
      case 'single_element': {
        const s = slug.trim();
        if (!s) return setError('Slug is required');
        onClose({ type, slug: s });
        return;
      }
      case 'element_list': {
        const slugs = slugsRaw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (slugs.length === 0) return setError('At least one slug required');
        onClose({ type, slugs: slugs.join(',') });
        return;
      }
      case 'tagged_list': {
        const tags = tagsRaw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (tags.length === 0) return setError('At least one tag required');
        onClose({ type, tags: tags.join(','), filter });
        return;
      }
      case 'tagged_list_mixed': {
        const tags = tagsRaw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (tags.length === 0) return setError('At least one tag required');
        onClose({ tags: tags.join(','), filter });
        return;
      }
    }
  }

  function remove() {
    onRemove();
    onClose(null);
  }

  const needsType =
    nodeType === 'inline_mention' ||
    nodeType === 'single_element' ||
    nodeType === 'element_list' ||
    nodeType === 'tagged_list';

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={280}
      estHeight={260}
      onCancel={() => onClose(null)}
      title={TITLE_FOR[nodeType]}
      icon={<Edit3 size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      {needsType && (
        <>
          <FieldLabel>Type</FieldLabel>
          <SelectInput
            value={type}
            onChange={(e) => setType(e.target.value as EntityType)}
            style={{ marginBottom: 8 }}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectInput>
        </>
      )}

      {(nodeType === 'inline_mention' || nodeType === 'single_element') && (
        <>
          <FieldLabel>Slug</FieldLabel>
          <TextInput
            ref={firstRef}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="get-users"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
        </>
      )}

      {nodeType === 'element_list' && (
        <>
          <FieldLabel>Slugs (comma-separated)</FieldLabel>
          <TextInput
            ref={firstRef}
            value={slugsRaw}
            onChange={(e) => {
              setSlugsRaw(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="get-users, create-user"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
        </>
      )}

      {(nodeType === 'tagged_list' || nodeType === 'tagged_list_mixed') && (
        <>
          <FieldLabel>Tags (comma-separated)</FieldLabel>
          <TextInput
            ref={firstRef}
            value={tagsRaw}
            onChange={(e) => {
              setTagsRaw(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="auth, core"
          />
          <div style={{ marginTop: 8 }}>
            <FieldLabel>Filter</FieldLabel>
            <SelectInput
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterMode)}
            >
              <option value="and">and</option>
              <option value="or">or</option>
            </SelectInput>
          </div>
        </>
      )}

      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={submit}
        submitLabel="Save"
        onRemove={remove}
      />
    </PopoverShell>
  );
}
