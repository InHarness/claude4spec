/**
 * `audit_ui_kit_components` (c4s-plugin-host-ui-kit-components `6o1rfh21`,
 * `mew2y4s4`) on plain records — the four rules, the scope narrowing and the
 * two refusals.
 */

import { describe, expect, it } from 'vitest';
import { auditUiKitComponents, type AuditRecord } from '../src/entity/ui-kit-component/backend/audit.js';

const fetch = (exp: string) => ({ export: exp, usage: 'fetchedByComponent' });
const feeds = (exp: string) => ({ export: exp, usage: 'feedsProps' });

const RECORDS: AuditRecord[] = [
  { slug: 'badge', binding: 'presentational', dataSources: [], soleAnatomyOf: 'tag-chip', types: [] },
  { slug: 'entity-list-row', binding: 'presentational', dataSources: [feeds('useTags')], types: [] },
  { slug: 'version-view', binding: 'connected', dataSources: [fetch('useVersions'), feeds('useTags')], types: [] },
];

describe('audit_ui_kit_components', () => {
  it('[section:6o1rfh21] a compliant catalog yields no violations and counts every record', () => {
    expect(auditUiKitComponents(RECORDS)).toEqual({ checked: 3, violations: [] });
  });

  it('[ac:ac-komponent-o-binding-connected-jawni] a connected record without a fetchedByComponent dataSources entry is reported; one with it is not', () => {
    const records: AuditRecord[] = [
      ...RECORDS,
      { slug: 'only-feeds', binding: 'connected', dataSources: [feeds('useTags')] },
      { slug: 'no-sources', binding: 'connected', dataSources: [] },
    ];
    const { violations } = auditUiKitComponents(records, { rules: ['connected-without-fetch'] });
    expect(violations.map((v) => [v.rule, v.slugs])).toEqual([
      ['connected-without-fetch', ['only-feeds']],
      ['connected-without-fetch', ['no-sources']],
    ]);
    // `version-view` names its consumed surface (`useVersions`, fetchedByComponent) — not reported.
    expect(violations.some((v) => v.slugs.includes('version-view'))).toBe(false);
    expect(violations[0]!.message).toMatch(/fetchedByComponent/);
  });

  it('[section:6o1rfh21] fetched-by-presentational: a presentational record with a fetchedByComponent entry', () => {
    const { violations } = auditUiKitComponents([...RECORDS, { slug: 'leaky', binding: 'presentational', dataSources: [fetch('useTags')] }]);
    expect(violations).toEqual([expect.objectContaining({ rule: 'fetched-by-presentational', slugs: ['leaky'] })]);
  });

  it('[section:6o1rfh21] duplicate-sole-anatomy and duplicate-type-definition compare the named records against all records', () => {
    const records: AuditRecord[] = [
      ...RECORDS,
      { slug: 'chip-2', binding: 'presentational', soleAnatomyOf: 'tag-chip' },
      { slug: 'a', binding: 'presentational', types: [{ name: 'Tag', definition: '{}' }] },
      { slug: 'b', binding: 'presentational', types: [{ name: 'Tag', definition: '{}' }] },
    ];
    const all = auditUiKitComponents(records);
    expect(all.violations.map((v) => [v.rule, v.slugs])).toEqual([
      ['duplicate-sole-anatomy', ['badge', 'chip-2']],
      ['duplicate-type-definition', ['a', 'b']],
    ]);
    // Narrowed to one record: only the group it belongs to, still found against every record.
    const one = auditUiKitComponents(records, { slugs: ['chip-2'] });
    expect(one.checked).toBe(1);
    expect(one.violations.map((v) => [v.rule, v.slugs])).toEqual([['duplicate-sole-anatomy', ['badge', 'chip-2']]]);
  });

  it('[section:6o1rfh21] refuses the whole call for an unknown slug or an unknown rule', () => {
    expect(() => auditUiKitComponents(RECORDS, { slugs: ['badge', 'nope'] })).toThrow(/nope/);
    expect(() => auditUiKitComponents(RECORDS, { rules: ['no-such-rule'] })).toThrow(/no-such-rule/);
  });
});
