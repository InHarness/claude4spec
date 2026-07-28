import { describe, expect, it } from 'vitest';
import { verifyGroupItems, verifyGroupTypes, type VerifyGroupInput } from './verify-groups.js';

const base: VerifyGroupInput = {
  moduleTypes: ['endpoint', 'dto'],
  selected: {},
  fetchedByType: {},
  queries: {},
};

describe('AC verifies — group derivation', () => {
  it('gives a referenced type a group even when no module serves it', () => {
    const selected = { endpoint: ['get-users'], 'database-table': ['orders'] };
    expect(verifyGroupTypes({ moduleTypes: base.moduleTypes, selected })).toEqual([
      'endpoint',
      'dto',
      'database-table',
    ]);
  });

  it('keeps a reference to an inactive type visible, so it can be unlinked', () => {
    const input = { ...base, selected: { 'database-table': ['orders'] } };
    expect(verifyGroupItems('database-table', input)).toEqual(['orders']);
  });

  it('does not duplicate a type that both has a module and is referenced', () => {
    const types = verifyGroupTypes({
      moduleTypes: ['endpoint', 'dto'],
      selected: { endpoint: ['get-users'] },
    });
    expect(types).toEqual(['endpoint', 'dto']);
  });

  it('keeps linked slugs in the list even when the query excludes them', () => {
    const input: VerifyGroupInput = {
      ...base,
      selected: { endpoint: ['get-users'] },
      fetchedByType: { endpoint: ['get-payments', 'post-payments'] },
      queries: { endpoint: 'pay' },
    };
    // Without this, the picker cannot resolve the chip and drops its ⚠ badge.
    expect(verifyGroupItems('endpoint', input)).toContain('get-users');
    expect(verifyGroupItems('endpoint', input)).toContain('get-payments');
  });

  it('confines a query to its own group', () => {
    const input: VerifyGroupInput = {
      ...base,
      fetchedByType: { endpoint: ['get-payments', 'get-users'], dto: ['user', 'payment'] },
      queries: { endpoint: 'pay' },
    };
    expect(verifyGroupItems('endpoint', input)).toEqual(['get-payments', 'pay']);
    // The dto group was never searched, so it stays whole and gets no literal.
    expect(verifyGroupItems('dto', input)).toEqual(['user', 'payment']);
  });

  it('offers an unmatched query as a literal, for a not-yet-existing entity', () => {
    const input: VerifyGroupInput = {
      ...base,
      fetchedByType: { endpoint: ['get-users'] },
      queries: { endpoint: 'get-invoices' },
    };
    expect(verifyGroupItems('endpoint', input)).toEqual(['get-invoices']);
  });

  it('does not offer a literal that duplicates an existing candidate', () => {
    const input: VerifyGroupInput = {
      ...base,
      fetchedByType: { endpoint: ['get-users'] },
      queries: { endpoint: 'get-users' },
    };
    expect(verifyGroupItems('endpoint', input)).toEqual(['get-users']);
  });

  it('shows only linked slugs before a group has loaded its candidates', () => {
    const input: VerifyGroupInput = { ...base, selected: { endpoint: ['get-users'] } };
    expect(verifyGroupItems('endpoint', input)).toEqual(['get-users']);
  });
});
