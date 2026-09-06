import { describe, expect, it } from 'vitest';
import { evaluateComputedDefault, evaluateSlugPattern } from '../../../src/shared/plugin-host/slug-pattern.js';
import type { ScalarNode } from '../../../src/shared/plugin-host/data-schema.js';
import { moduleDependencyEntity } from '../src/entity/module-dependency/index.js';
import { moduleDependencyData, moduleDependencySlugPattern } from '../src/entity/module-dependency/schema.js';
import { MODULE_DEPENDENCY_PATH_PREFIX } from '../src/entity/module-dependency/identity.js';

const EDGE = { dependent: 'M19', provider: 'M13', needs: 'Bez tamtego nie ma czym zasilić widoku.' };

/** Only the authored fields; `createdAt` / `updatedAt` are the host's. */
const AUTHORED = ['title', 'dependent', 'provider', 'needs'] as const;

describe('module-dependency — identity and derivation', () => {
  it('derives the slug from the ordered pair', () => {
    expect(evaluateSlugPattern(moduleDependencySlugPattern, EDGE)).toBe('m19-requires-m13');
  });

  /**
   * The pair is ORDERED, and this is the assertion that says so in one line: the
   * reverse edge is a different entity with a different slug, so a mutual
   * relation never collides with itself.
   */
  it('never collides with its own reverse — a mutual relation is two entities', () => {
    const forward = evaluateSlugPattern(moduleDependencySlugPattern, EDGE);
    const back = evaluateSlugPattern(moduleDependencySlugPattern, {
      ...EDGE,
      dependent: EDGE.provider,
      provider: EDGE.dependent,
    });
    expect(back).toBe('m13-requires-m19');
    expect(back).not.toBe(forward);
  });

  /**
   * A duplicate pair is SUFFIXED, not refused — so this must be spelled out,
   * because the host's default is the opposite (`'reject'`). Refusing would
   * throw away the second description's prose at the moment of writing.
   */
  it('files a duplicate pair under a suffix rather than refusing it', () => {
    expect(moduleDependencyEntity.slugConflict).toBe('suffix');
  });

  it('computes the title from both parties, so the author never fills it', () => {
    const title = moduleDependencyData.schema.title as ScalarNode;
    expect(title.computedDefault).toBeDefined();
    expect(evaluateComputedDefault(title.computedDefault as never, EDGE)).toBe('M19 wymaga od M13');
  });
});

describe('module-dependency — the schema decisions that carry behaviour', () => {
  /**
   * `dependent` and `provider` must be DECLARED SCALARS or a module's incoming
   * edges become unreadable: `list_entities({ filters })` matches declared
   * scalar leaves and nothing else, and incoming edges carry the other module's
   * tag, so no tag query reaches them.
   */
  it.each(['dependent', 'provider'])('%s is a required scalar — the filter path depends on it', (field) => {
    const node = moduleDependencyData.schema[field] as ScalarNode;
    expect(node.type).toBe('string');
    expect(node.required).toBe(true);
    expect(node.maxLength).toBe(8);
  });

  /**
   * NO `ref` ANYWHERE, and the cost is the point: a module is a party to the
   * edge, not an entity type, so a typo'd module number produces a silent false
   * edge rather than a `broken` marker. That is what consistency rules 15-17
   * exist to cover.
   */
  it.each(AUTHORED)('%s declares no ref', (field) => {
    expect((moduleDependencyData.schema[field] as ScalarNode).ref).toBeUndefined();
  });

  /**
   * `needs` is NOT `contentBearing`. Flagged, its delta would collapse to a byte
   * count and it would drop out of `searchableFields` — for one or two sentences
   * that is a loss with nothing bought.
   */
  it('needs is bounded prose, not content', () => {
    const needs = moduleDependencyData.schema.needs as ScalarNode;
    expect(needs.contentBearing).toBeUndefined();
    expect(needs.required).toBe(true);
    expect(needs.maxLength).toBe(400);
  });

  /**
   * EVERY authored field carries `maxLength`, which is what keeps the delta
   * purely scalar: `field_changed_opaque` fires on `contentBearing` OR on the
   * absence of any value constraint.
   */
  it.each(AUTHORED)('%s is bounded, so the delta stays scalar', (field) => {
    expect((moduleDependencyData.schema[field] as ScalarNode).maxLength).toBeGreaterThan(0);
  });

  /** No collection anywhere — nothing to declare item identity for. */
  it('declares no collection', () => {
    for (const node of Object.values(moduleDependencyData.schema)) {
      expect((node as { type?: string }).type).not.toBe('collection');
    }
  });
});

describe('module-dependency — what the contribution deliberately omits', () => {
  /**
   * The whole write path is host-generated, so there is nothing an operation
   * could add: outgoing edges are a tag read, incoming ones a filter read, and
   * the record itself comes back whole because no field is `contentBearing`.
   */
  it('occupies no backend slot at all', () => {
    expect(moduleDependencyEntity.backend).toBeUndefined();
  });

  /** `payloadVersion: 1` — nothing of this type exists on disk to migrate from. */
  it('starts its payload chain empty', () => {
    expect(moduleDependencyEntity.payloadVersion).toBe(1);
    expect(moduleDependencyEntity.payloadUpgrades).toBeUndefined();
  });

  /**
   * `pathPrefix` carries NO `/api`. The generated router is mounted on a router
   * already sitting at `/api`, so a prefix spelled in full would serve
   * `/api/api/module-dependencies` — every route 404ing while the declaration
   * reads as though it were right.
   */
  it('declares the mount point, not the served URL', () => {
    expect(MODULE_DEPENDENCY_PATH_PREFIX).toBe('/module-dependencies');
    expect(moduleDependencyEntity.pathPrefix).toBe('/module-dependencies');
  });
});

/**
 * REQUIRED, and not as a formality: the system-prompt builder skips a type with
 * no `systemPrompt` entirely, which would leave the agent mandated by `SKILL.md`
 * to record dependencies as entities while never learning the type exists.
 */
describe('module-dependency — system prompt', () => {
  it('names the role and carries the narrative, with no tools to advertise', () => {
    const sp = moduleDependencyEntity.systemPrompt;
    expect(sp.roleNoun).toBe('Module dependencies');
    expect(sp.mcpToolsLine).toBeUndefined();
    expect(sp.defaultPredicate).toBeUndefined();
  });

  it.each([
    ['the unit is the ordered pair', 'JEDNĄ encją module-dependency na uporządkowaną parę'],
    ['the tag comes from dependent', 'tagiem modułu z pola dependent'],
    ['a mutual relation is two entities', 'Relacja wzajemna to DWIE encje'],
    ['incoming edges are a filter', 'filters: { provider: "MNN" }'],
  ])('states %s', (_what, fragment) => {
    expect(moduleDependencyEntity.systemPrompt.narrativeBlock).toContain(fragment);
  });
});
