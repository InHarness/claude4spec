/**
 * The errors these services throw must be the HOST's `DomainError`.
 *
 * The host narrows with `instanceof`, in two places that decide what a caller
 * sees: the MCP entity-tools error mapper (`create_entities` / `update_entities`
 * → `{ code }`) and the global Express handler (→ HTTP status). Class identity
 * is nominal, so a locally-declared class with the same shape passes every
 * type-check, fails both narrowings, and turns a 409 slug conflict into an
 * `INTERNAL` 500. That is what this package shipped before the class moved onto
 * the `@c4s/plugin-runtime` facade.
 *
 * The assertion is deliberately made against the FACADE import rather than a
 * deep host path: the facade is what an extracted copy of this package would
 * import, so the test survives extraction unchanged. Re-vendor the class in
 * `host-kit/errors.ts` and this goes red.
 */

import Database from 'better-sqlite3';
import { DomainError as FacadeDomainError } from '@c4s/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { EndpointService } from '../../src/entity/endpoint/backend/services.js';
import { generateProjectionDDL } from '../../../../src/server/db/projection.js';
import { dtoData } from '../../src/entity/dto/schema.js';
import { endpointData } from '../../src/entity/endpoint/schema.js';

/**
 * The collaborators are never reached: every case here throws before the
 * service hydrates a row, which is the only thing that touches them.
 */
function service(): EndpointService {
  const db = new Database(':memory:');
  for (const module of [{ type: 'dto', data: dtoData }, { type: 'endpoint', data: endpointData }]) {
    for (const statement of generateProjectionDDL(module)) db.exec(statement);
  }
  db.prepare(`INSERT INTO endpoint (slug, method, path, summary) VALUES (?, ?, ?, ?)`).run(
    'get-users',
    'GET',
    '/users',
    'List users',
  );
  const unreached = {} as never;
  return new EndpointService(db, unreached, unreached, unreached);
}

describe('DomainError identity across the package boundary', () => {
  it('is the host class, so the host can narrow on what these services throw', () => {
    const svc = service();

    let thrown: unknown;
    try {
      svc.createRaw({ method: 'GET', path: '/users' }, 'user');
    } catch (err) {
      thrown = err;
    }

    // The narrowing the host performs, performed here.
    expect(thrown).toBeInstanceOf(FacadeDomainError);
    expect((thrown as FacadeDomainError).code).toBe('SLUG_CONFLICT');
  });

  it('carries the same identity for validation failures', () => {
    const svc = service();
    expect(() => svc.createRaw({ method: 'GET', path: '' }, 'user')).toThrow(FacadeDomainError);
  });
});
