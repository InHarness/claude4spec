/**
 * 2.1.16 — `kind` and `status` are edited through the catalog's
 * `EnumBadgePicker` everywhere they are editable: the detail page, the create
 * dialog, the `/ac` popover and the `ac-edit` popover. One option list per
 * field, so the four surfaces cannot drift apart in labels or colors.
 */

export const AC_KIND_OPTIONS = [
  { value: 'requirement', label: 'requirement', color: 'var(--c-accent)' },
  { value: 'edge-case', label: 'edge-case', color: 'var(--c-yellow-ink)' },
];

export const AC_STATUS_OPTIONS = [
  { value: 'active', label: 'active', color: 'var(--c-accent)' },
  { value: 'deprecated', label: 'deprecated', color: 'var(--c-red, #c45a3b)' },
];
