/**
 * `slugPattern` must reproduce what `slugFrom` did — or say plainly where it does not.
 *
 * Slugs are computed once, at create, and never recomputed, so a regression here
 * does not corrupt existing entities; it silently changes how NEW ones are
 * named, which is the kind of drift nobody notices for a release. The retired
 * per-type helpers (`dtoSlug`, `uiViewSlug`, `designSystemSlug`, `endpointSlug`,
 * `acSlug`) are therefore reproduced inline below as the reference, exactly as
 * the projection golden test keeps the retired DDL.
 */

import { describe, expect, it } from 'vitest';
import { evaluateSlugPattern, previewSlugPattern, type SlugPattern } from './slug-pattern.js';
import { slugify } from '../slug.js';
import { acSlugPattern } from '../entities/ac/schema.js';
import { diagramSlugPattern } from '../entities/diagram/schema.js';

/**
 * `ui-view` and `design-system` moved into the `c4s-plugin-frontend-mockups`
 * envelope in 0.2.18, and the host may not import a plugin's source. Both
 * declare exactly this pattern, and the parity claim below is about the STEP —
 * `slugify` with `splitCamelCase` — not about who declares it, so the literal
 * stands in for both. If either type ever changes its pattern, the envelope's
 * own suite is where that has to be caught.
 */
const nameSlugPattern: SlugPattern = [{ op: 'slugify', field: 'name', splitCamelCase: true }];

/**
 * 0.2.22 — the evaluator takes no random source. `nanoid(n)` left the grammar,
 * so every pattern is a pure function of the payload and the stand-in this
 * helper used to inject has nothing left to stand in for.
 */
const evaluate = (pattern: SlugPattern, data: Record<string, unknown>) =>
  evaluateSlugPattern(pattern, data);

/** The retired `uiViewSlug` / `designSystemSlug` / `dtoSlug` — one function, three names. */
function retiredNameSlug(name: string): string {
  return slugify(
    name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2'),
  );
}

describe('slugPattern — parity with the retired per-type helpers', () => {
  const names = ['User Profile Screen', 'UserProfile', 'HTTPServerConfig', 'Brand 2026', 'a'];

  it.each(names)('slugify+splitCamelCase reproduces the retired helper for %j', (name) => {
    expect(evaluate(nameSlugPattern, { name })).toBe(retiredNameSlug(name));
  });

  /**
   * The PascalCase boundary split is why `slugify(field)` carries a parameter
   * rather than being one op. Without it `UserProfile` slugifies to
   * `userprofile`, and every DTO, UI view and design system created after the
   * release would be named differently from every one created before it.
   */
  it('inserts word boundaries only where the pattern asks for them', () => {
    expect(evaluate([{ op: 'slugify', field: 'n', splitCamelCase: true }], { n: 'UserProfile' })).toBe(
      'user-profile',
    );
    expect(evaluate([{ op: 'slugify', field: 'n' }], { n: 'UserProfile' })).toBe('userprofile');
  });
});

describe('slugPattern — the grammar', () => {
  it('concatenates literal, slugify and truncate in declaration order', () => {
    // `ac` slugifies its TITLE since 0.2.22, and `title` defaults to the first
    // 200 characters of `text` — so for any text this short the slug is
    // unchanged, which is the point of deriving rather than replacing.
    expect(evaluate(acSlugPattern, { title: 'The list must stay sorted' })).toBe(
      'ac-the-list-must-stay-sorted',
    );
  });

  /**
   * The brief's `ac` pattern truncates the FINISHED slug; the retired `acSlug`
   * truncated the first 40 characters of the source text and then slugified.
   * The two differ on long text, and the difference is deliberate — a slug
   * bounded at 40 characters is more distinguishable than one built from 40
   * characters of prose. Asserted so the change stays a decision, not an
   * accident.
   */
  it('truncates the accumulated result, not one field of input', () => {
    const title = 'The projection generator must be idempotent across every boot of the server';
    const slug = evaluate(acSlugPattern, { title });

    expect(slug).toHaveLength(40);
    expect(slug.startsWith('ac-the-projection-generator')).toBe(true);
  });

  /**
   * 0.2.22 — `diagram` no longer HAS a chain. Its three alternatives existed
   * because it had no name of its own: a transient caption, then a guess at the
   * first identifier in the DSL, then a random suffix. It slugifies `title` now,
   * so a fallback chain is asserted on a pattern written here instead.
   */
  it('takes the first non-empty alternative of a fallback chain', () => {
    const chain: SlugPattern = [
      [{ op: 'slugify', field: 'preferred' }],
      [{ op: 'slugify', field: 'fallback' }],
      [{ op: 'literal', value: 'unnamed' }],
    ];
    expect(evaluate(chain, { preferred: 'Auth Flow' })).toBe('auth-flow');
    expect(evaluate(chain, { fallback: 'graph_TD' })).toBe('graph-td');
    expect(evaluate(chain, {})).toBe('unnamed');
  });

  /**
   * An ABSENT field is skipped; a PRESENT one that transliterates to nothing is
   * not. `slugify` answers punctuation-only and non-Latin input with a
   * deterministic `x-<hash>` so no caller ever keys a filename off an empty
   * string — a caption of `!!!` is a value the author typed, and it gets that
   * answer here exactly as it would anywhere else in the repo. Only the empty
   * case falls through to the next alternative.
   */
  it('skips an absent field but keeps a present one that transliterates to nothing', () => {
    const chain: SlugPattern = [
      [{ op: 'slugify', field: 'caption' }],
      [{ op: 'literal', value: 'unnamed' }],
    ];
    expect(evaluate(chain, { caption: '' })).toBe('unnamed');
    expect(evaluate(chain, { caption: '!!!' })).toMatch(/^x-[a-z0-9]+$/);
  });

  it('trims dangling separators rather than making each pattern encode the cleanup', () => {
    expect(evaluate(acSlugPattern, { title: '' })).toBe('ac');
    expect(
      evaluate([{ op: 'slugify', field: 'method' }, { op: 'literal', value: '-' }, { op: 'slugify', field: 'path' }], {
        method: 'GET',
        path: '',
      }),
    ).toBe('get');
  });

  it('reads a dotted path into a nested object', () => {
    expect(evaluate([{ op: 'slugify', field: 'meta.title' }], { meta: { title: 'Hello There' } })).toBe(
      'hello-there',
    );
  });

  it('returns empty rather than inventing a slug when every alternative is empty', () => {
    expect(evaluate([{ op: 'slugify', field: 'name' }], {})).toBe('');
    expect(evaluate([{ op: 'slugify', field: 'name' }], { name: '   ' })).toBe('');
  });
});

describe('previewSlugPattern', () => {
  /**
   * The client shows a prospective slug while the user types; the server
   * computes the real one. A real `nanoid` here would produce a preview that is
   * guaranteed wrong — a different value every keystroke, none of them the one
   * stored — so the placeholder says "the host fills this in" instead.
   */
  /**
   * The preview used to substitute `########` for a random step. With `nanoid`
   * out of the grammar there is no random step to substitute for, so preview and
   * evaluation are the same function — asserted on the type whose pattern was
   * the only consumer.
   */
  it('matches evaluation for the pattern that used to carry a random step', () => {
    expect(previewSlugPattern(diagramSlugPattern, { title: 'Auth Flow' })).toBe(
      evaluate(diagramSlugPattern, { title: 'Auth Flow' }),
    );
  });

  it('is identical to full evaluation for a pattern with no random step', () => {
    expect(previewSlugPattern(nameSlugPattern, { name: 'UserProfile' })).toBe(
      evaluate(nameSlugPattern, { name: 'UserProfile' }),
    );
  });
});
