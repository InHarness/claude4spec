import { describe, expect, it } from 'vitest';
import * as errors from './errors.js';
import { DISCOVERY_ERROR_CODES, sectionNotFound } from './errors.js';
import { resolveIdentity } from './ops/entities.js';
import type { DiscoveryDeps } from './types.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { STATUS_FOR_DISCOVERY_CODE } from '../operations/error-codes.js';
import { SERVER_DELEGATING_CODES } from '../../bin/c4s/registry.js';
import { codeToExit } from '../../bin/c4s/errors.js';

registerCoreOperations();

/**
 * 2.1.26 — M39 L2 `7dad4wt0`, the core's error taxonomy as the window leaves it:
 * ambiguity has no code (`resolve_identity` answers an ambiguous phrase with
 * scored candidates), `INDEX_NOT_MATERIALIZED` stays in the catalogue but no
 * operation returns it (a caller with no server gets `SERVER_NOT_RUNNING`), and
 * `SECTION_NOT_FOUND` points at `search_pages` / `get_page_outline`.
 */
describe('[section:7dad4wt0] the discovery core error taxonomy', () => {
  it('[section:7dad4wt0] the catalogue is the eight codes of the table — no AMBIGUOUS_* code', () => {
    expect([...DISCOVERY_ERROR_CODES]).toEqual([
      'ENTITY_NOT_FOUND',
      'SECTION_NOT_FOUND',
      'PAGE_NOT_FOUND',
      'INVALID_TYPE',
      'INVALID_ARGUMENT',
      'INDEX_NOT_MATERIALIZED',
      'INDEX_STALE',
      'SEARCH_BUDGET_EXCEEDED',
    ]);
    expect(DISCOVERY_ERROR_CODES.some((c) => c.startsWith('AMBIGUOUS'))).toBe(false);
    // The REST rendering maps the catalogue 1:1 — and nothing it no longer has.
    expect(Object.keys(STATUS_FOR_DISCOVERY_CODE).sort()).toEqual([...DISCOVERY_ERROR_CODES].sort());
  });

  it('[section:7dad4wt0] the core can construct no ambiguity refusal and no INDEX_NOT_MATERIALIZED refusal', () => {
    const exported = Object.keys(errors);
    expect(exported).not.toContain('ambiguousEntity');
    expect(exported).not.toContain('ambiguousPage');
    expect(exported).not.toContain('indexNotMaterialized');
  });

  it('[section:7dad4wt0] no catalog operation declares an AMBIGUOUS_* code or INDEX_NOT_MATERIALIZED', () => {
    const offending = CATALOG.list().flatMap((op) =>
      op.errorCodes
        .filter((code) => code === 'AMBIGUOUS_ENTITY' || code === 'AMBIGUOUS_PAGE' || code === 'INDEX_NOT_MATERIALIZED')
        .map((code) => `${op.name}: ${code}`),
    );
    expect(offending).toEqual([]);
  });

  it('[section:7dad4wt0] a caller without a server gets SERVER_NOT_RUNNING, not INDEX_NOT_MATERIALIZED', () => {
    expect(SERVER_DELEGATING_CODES).toContain('SERVER_NOT_RUNNING');
    expect(SERVER_DELEGATING_CODES).not.toContain('INDEX_NOT_MATERIALIZED');
    expect(codeToExit('SERVER_NOT_RUNNING')).toBe(8);
  });

  it('[section:7dad4wt0] SECTION_NOT_FOUND directs the caller to search_pages and get_page_outline', () => {
    for (const err of [sectionNotFound('zzzz0000', ['aaaa0001']), sectionNotFound('zzzz0000', [])]) {
      expect(err.code).toBe('SECTION_NOT_FOUND');
      expect(err.hint).toContain('search_pages');
      expect(err.hint).toContain('get_page_outline');
    }
  });

  it('[section:7dad4wt0] resolve_identity answers an ambiguous phrase with scored candidates, not a refusal', () => {
    // The same slug, `user`, under two active types: exactly the input the old
    // `AMBIGUOUS_ENTITY` refused.
    const deps = {
      host: {
        listEntities: () => [{ type: 'dto' }, { type: 'endpoint' }],
        getEntity: () => null,
      },
      reader: {
        listSlugs: () => ['user'],
        getEntity: (_type: string, slug: string) => ({ slug, data: { title: 'User' } }),
      },
    } as unknown as DiscoveryDeps;

    const answer = resolveIdentity(deps, { query: 'user' });
    expect(answer.truncated).toBe(false);
    expect(answer.candidates.map((c) => `${c.type}/${c.slug}`)).toEqual(['dto/user', 'endpoint/user']);
    for (const c of answer.candidates) {
      expect(c.title).toBe('User');
      expect(c.score).toBeGreaterThan(0);
    }
    // An empty phrase is an empty list, never a refusal either.
    expect(resolveIdentity(deps, { query: '   ' }).candidates).toEqual([]);
  });
});
