/**
 * The errors this package throws must be the HOST's `DomainError`.
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
 *
 * 2.0.0 tier K — the SUBJECT changed, the property did not. `EndpointService` is
 * deleted, and with it every error it threw; what this package still throws is
 * `link-dto.ts`, the collection-write sugar behind `POST /:slug/dtos` and the
 * `link_dto` MCP tool. Both of those reach the host's narrowing, so both need
 * the identity — and this is now the only place in the package that throws at
 * all, which makes it the whole surface rather than a sample of it.
 */

import { DomainError as FacadeDomainError } from '@c4s/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { linkDto, unlinkDto, type LinkDtoDeps } from '../../src/entity/endpoint/backend/link-dto.js';

/** A reader holding one endpoint and one DTO; `update` is never reached here. */
function deps(overrides: Partial<LinkDtoDeps> = {}): LinkDtoDeps {
  return {
    reader: {
      getEntity: (type: string, slug: string) =>
        (type === 'endpoint' && slug === 'get-users') || (type === 'dto' && slug === 'user-dto')
          ? { type, slug }
          : null,
      readCollection: () => [],
    },
    update: () => {
      throw new Error('unreachable — every case below throws before the write');
    },
    ...overrides,
  };
}

describe('DomainError identity across the package boundary', () => {
  it('is the host class, so the host can narrow on a missing target', async () => {
    let thrown: unknown;
    try {
      await linkDto(deps(), 'get-users', 'ghost-dto', 'response', 200);
    } catch (err) {
      thrown = err;
    }

    // The narrowing the host performs, performed here.
    expect(thrown).toBeInstanceOf(FacadeDomainError);
    expect((thrown as FacadeDomainError).code).toBe('NOT_FOUND');
  });

  it('carries the same identity for validation failures', async () => {
    // The cross-field rule that outlived the service: a request body has no
    // status code, which no single field's declaration can say.
    let thrown: unknown;
    try {
      await linkDto(deps(), 'get-users', 'user-dto', 'request', 200);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FacadeDomainError);
    expect((thrown as FacadeDomainError).code).toBe('VALIDATION');
  });

  it('carries it on the unlink path too', async () => {
    await expect(unlinkDto(deps(), 'ghost-endpoint', 'user-dto', 'response', 200)).rejects.toThrow(
      FacadeDomainError,
    );
  });
});
