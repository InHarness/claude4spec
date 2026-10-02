import { useEffect, useMemo, useRef } from 'react';
import { FieldLabel, SelectInput, TextInput } from '../../../ui/Popover.js';
import { listPickerEntityTypes } from '../../../entities/index.js';
import type { TagAttrs, TagFieldsProps, TagPopoverFields } from '../../popover-fields.js';

function csvValues(v: string | null | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function useFocusFirst() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  return ref;
}

/**
 * Type picker. The tag's OWN type stays selectable (editing must not silently
 * retype it); the options follow the picker rule of the tag — a chip/card
 * takes any active type, a list only types that render a row.
 */
function TypeField({ value, onChange, kind }: TagFieldsProps & { kind: 'element' | 'list' }) {
  const ownType = value.type ?? '';
  const options = useMemo(() => {
    const opts = listPickerEntityTypes(kind);
    return ownType && !opts.includes(ownType) ? [ownType, ...opts] : opts;
  }, [kind, ownType]);
  useEffect(() => {
    if (!ownType && options[0]) onChange({ ...value, type: options[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <FieldLabel>Type</FieldLabel>
      <SelectInput
        value={ownType}
        onChange={(e) => onChange({ ...value, type: e.target.value })}
        style={{ marginBottom: 8 }}
      >
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </SelectInput>
    </>
  );
}

function TextAttrField({
  props,
  attr,
  label,
  placeholder,
  mono,
}: {
  props: TagFieldsProps;
  attr: string;
  label: string;
  placeholder: string;
  mono?: boolean;
}) {
  const ref = useFocusFirst();
  const { value, onChange, submit } = props;
  return (
    <>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        ref={ref}
        value={value[attr] ?? ''}
        onChange={(e) => onChange({ ...value, [attr]: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        style={mono ? { fontFamily: 'ui-monospace, monospace' } : undefined}
      />
    </>
  );
}

function FilterField({ value, onChange }: TagFieldsProps) {
  return (
    <div style={{ marginTop: 8 }}>
      <FieldLabel>Filter</FieldLabel>
      <SelectInput
        value={value.filter === 'or' ? 'or' : 'and'}
        onChange={(e) => onChange({ ...value, filter: e.target.value })}
      >
        <option value="and">and</option>
        <option value="or">or</option>
      </SelectInput>
    </div>
  );
}

const trimSlug = (v: TagAttrs): TagAttrs => ({ ...v, slug: (v.slug ?? '').trim() });
const trimCsv = (key: string) => (v: TagAttrs): TagAttrs => ({ ...v, [key]: csvValues(v[key]).join(',') });
const requireSlug = (v: TagAttrs) => ((v.slug ?? '').trim() ? null : 'Slug is required');
const requireCsv = (key: string, message: string) => (v: TagAttrs) => (csvValues(v[key]).length ? null : message);

export const REFERENCE_FIELDS: Record<string, TagPopoverFields> = {
  inline_mention: {
    title: { create: 'New mention', edit: 'Edit mention' },
    width: 280,
    Fields: (p) => (
      <>
        <TypeField {...p} kind="element" />
        <TextAttrField props={p} attr="slug" label="Slug" placeholder="get-users" mono />
      </>
    ),
    normalize: trimSlug,
    validate: requireSlug,
  },
  single_element: {
    title: { create: 'New element', edit: 'Edit element' },
    width: 280,
    Fields: (p) => (
      <>
        <TypeField {...p} kind="element" />
        <TextAttrField props={p} attr="slug" label="Slug" placeholder="get-users" mono />
      </>
    ),
    normalize: trimSlug,
    validate: requireSlug,
  },
  element_list: {
    title: { create: 'New element list', edit: 'Edit element list' },
    width: 280,
    Fields: (p) => (
      <>
        <TypeField {...p} kind="list" />
        <TextAttrField props={p} attr="slugs" label="Slugs (comma-separated)" placeholder="get-users, create-user" mono />
      </>
    ),
    normalize: trimCsv('slugs'),
    validate: requireCsv('slugs', 'At least one slug required'),
  },
  tagged_list: {
    title: { create: 'New tagged list', edit: 'Edit tagged list' },
    width: 280,
    Fields: (p) => (
      <>
        <TypeField {...p} kind="list" />
        <TextAttrField props={p} attr="tags" label="Tags (comma-separated)" placeholder="auth, core" />
        <FilterField {...p} />
      </>
    ),
    normalize: trimCsv('tags'),
    validate: requireCsv('tags', 'At least one tag required'),
  },
  tagged_list_mixed: {
    title: { create: 'New tagged list (mixed)', edit: 'Edit tagged list (mixed)' },
    width: 280,
    Fields: (p) => (
      <>
        <TextAttrField props={p} attr="tags" label="Tags (comma-separated)" placeholder="auth, core" />
        <FilterField {...p} />
      </>
    ),
    normalize: trimCsv('tags'),
    validate: requireCsv('tags', 'At least one tag required'),
  },
};
