/**
 * The `endpoint` ↔ `dto` join, tested where it now lives.
 *
 * These cases came from the host's `entity-writer.test.ts`, which owned
 * `syncEndpointDtos` until 0.2.2. The behaviour they pin is the reason the two
 * types ship in one envelope, so they belong to the envelope.
 */

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import {
  findDtoEndpoints,
  findEndpointDtos,
  syncEndpointDtos,
  type JunctionCapable,
} from '../../src/entity/junction/index.js';
import { generateProjectionDDL } from '../../../../src/server/db/projection.js';
import { dtoData } from '../../src/entity/dto/schema.js';
import { endpointData } from '../../src/entity/endpoint/schema.js';

function db(): Database.Database {
  const handle = new Database(':memory:');
  // 2.0.0: the tables come from the same generator the host runs at boot, over
  // the same declarations the envelope ships — not from a second copy of the DDL.
  for (const module of [{ type: 'dto', data: dtoData }, { type: 'endpoint', data: endpointData }]) {
    for (const statement of generateProjectionDDL(module)) handle.exec(statement);
  }
  return handle;
}

describe('syncEndpointDtos', () => {
  it('warns instead of throwing when the endpoint service is absent', () => {
    expect(syncEndpointDtos(null, 'e', [])).toEqual({
      linked: 0,
      unlinked: 0,
      warnings: [`entity service for type 'endpoint' not registered`],
    });
  });

  it('links missing and unlinks extras, idempotently', () => {
    const linkDto = vi.fn();
    const unlinkDto = vi.fn();
    const service: JunctionCapable = {
      getBySlug: () => ({
        dtos: [{ dtoSlug: 'stale', dtoName: 'Stale', relation: 'response', statusCode: 200 }],
      }),
      linkDto,
      unlinkDto,
    };

    const result = syncEndpointDtos(service, 'e', [
      { dtoSlug: 'wanted', relation: 'request', statusCode: null },
    ]);

    expect(result).toMatchObject({ linked: 1, unlinked: 1, warnings: [] });
    // Unlink runs FIRST, or the UNIQUE over (endpoint, dto, relation, status)
    // can reject a link against a row that is about to be removed.
    expect(unlinkDto.mock.invocationCallOrder[0]).toBeLessThan(linkDto.mock.invocationCallOrder[0]!);
  });

  it('reports a failing link as a warning rather than aborting the rest', () => {
    const service: JunctionCapable = {
      getBySlug: () => ({ dtos: [] }),
      linkDto: vi.fn((_e, dtoSlug) => {
        if (dtoSlug === 'missing') throw new Error(`dto 'missing' not found`);
      }),
      unlinkDto: vi.fn(),
    };

    const result = syncEndpointDtos(service, 'e', [
      { dtoSlug: 'missing', relation: 'response', statusCode: 404 },
      { dtoSlug: 'present', relation: 'response', statusCode: 200 },
    ]);

    expect(result.linked).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing');
  });
});

describe('junction reads', () => {
  it('orders links by relation, then status code, then the far side’s label', () => {
    // The ORDER BY is part of the L9 output: view projections are handed over
    // unsorted, so a change here changes rendered bytes.
    const handle = db();
    try {
      handle.exec(`
        INSERT INTO dto (slug, name, created_at, updated_at) VALUES
          ('b-dto', 'Bravo', '', ''), ('a-dto', 'Alpha', '', '');
        INSERT INTO endpoint (slug, method, path, created_at, updated_at) VALUES
          ('get-users', 'GET', '/users', '', '');
        INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation, status_code) VALUES
          ('get-users', 'b-dto', 'response', 200),
          ('get-users', 'a-dto', 'response', 200),
          ('get-users', 'a-dto', 'request', NULL);
      `);

      expect(findEndpointDtos(handle, 'get-users').map((l) => `${l.relation}:${l.dtoName}`)).toEqual([
        'request:Alpha',
        'response:Alpha',
        'response:Bravo',
      ]);
      expect(findDtoEndpoints(handle, 'a-dto').map((l) => l.relation)).toEqual(['request', 'response']);
    } finally {
      handle.close();
    }
  });

  it('returns an empty list for an entity with no links', () => {
    const handle = db();
    try {
      expect(findEndpointDtos(handle, 'nobody')).toEqual([]);
      expect(findDtoEndpoints(handle, 'nobody')).toEqual([]);
    } finally {
      handle.close();
    }
  });
});
