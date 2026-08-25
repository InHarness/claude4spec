/**
 * `contributes.skills[]` — the envelope's first contribution that is NOT a type.
 *
 * What is worth pinning here is the CONTRACT of the body, not its prose. The
 * skill is the only thing standing between an agent and a mockup that either
 * nests a whole document inside `<body>`, or hardcodes a colour the design
 * system already names. Neither failure is visible in a type check, and neither
 * is caught by the mockup route — it pastes `mockupHtml` verbatim, on purpose.
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { uiViewMockupGeneratorSkill } from '../src/skills/ui-view-mockup-generator.js';

const body = uiViewMockupGeneratorSkill.content;

describe('the envelope contributes the mockup-generator skill', () => {
  it('declares it once, on the manifest, as a contextual skill', () => {
    expect(manifest.contributes.skills).toEqual([uiViewMockupGeneratorSkill]);
    expect(uiViewMockupGeneratorSkill.slug).toBe('ui-view-mockup-generator');
    expect(uiViewMockupGeneratorSkill.scope).toBe('contextual');
    expect(uiViewMockupGeneratorSkill.language).toBe('en');
    expect(uiViewMockupGeneratorSkill.version).toBeGreaterThan(0);
  });

  it('keeps hostApiVersion where it was — filling an existing slot is not new grammar', () => {
    // `contributes.skills[]` has been in the dictionary since the 2.0.0 baseline
    // as an additive change. Bumping the range here would strand the envelope on
    // any host whose own version predates the bump, for no gained surface.
    expect(manifest.hostApiVersion).toBe('^2.0.0');
  });

  it('carries a description — the only thing the model reads before opening it', () => {
    // A contextual plugin skill is never forced: it rides `inlineSkills` and the
    // model opens it itself via `Skill(<slug>)`. An empty or generic description
    // makes it unreachable in practice while everything still "registers".
    expect(uiViewMockupGeneratorSkill.description.length).toBeGreaterThan(40);
    expect(uiViewMockupGeneratorSkill.description).toMatch(/mockup/i);
  });
});

describe('the body states the read contract', () => {
  it('names get_entities for the view and for its design system', () => {
    expect(body).toContain("get_entities({ type: 'ui-view'");
    expect(body).toContain("get_entities({ type: 'design-system'");
  });

  it('routes the existing mockup through get_field_content, and says the document route is not a read channel', () => {
    expect(body).toContain("get_field_content({ type: 'ui-view', slug: '<slug>', field: 'mockupHtml' })");
    expect(body).toMatch(/mockup document route[\s\S]{0,120}not one/i);
  });

  it('warns that a read never emits mockupHtml, only its descriptors', () => {
    expect(body).toContain('hasMockupHtml');
    expect(body).toContain('mockupHtmlBytes');
  });

  it('splits domain context by the tool that can actually answer it', () => {
    // Entities-by-tag is `list_entities`; `find_references` takes no tags and
    // requires the `target` discriminator. The first draft of this skill named
    // `find_references` for both, which is an INVALID_ARGUMENT at worst and a
    // silently empty result at best.
    expect(body).toMatch(/list_entities\(\{[^)]*tags:/);
    expect(body).toContain("find_references({ target: 'entity', type: 'ui-view', slug })");
    expect(body).toMatch(/takes no tags and\s*\n?\s*requires the `target` discriminator/);
  });
});

describe('the body states the three output rules', () => {
  it('demands a body FRAGMENT and forbids the document scaffolding the route composes', () => {
    expect(body).toMatch(/fragment, never a full document/i);
    for (const forbidden of ['<!doctype>', '<html>', '<head>']) {
      expect(body).toContain(forbidden);
    }
  });

  it('allows visual values only through custom properties, and names the no-design-system case', () => {
    expect(body).toContain('var(--color-action-primary)');
    expect(body).toContain('var(--space-4)');
    expect(body).toMatch(/never a literal hex, never a literal px/i);
    expect(body).toMatch(/no `designSystemSlug`[\s\S]{0,160}no token references at all/i);
  });

  /**
   * The naming contract, pinned against the generator it describes. The skill's
   * whole job here is to let the agent DERIVE a property name from the entity
   * record — the record carries no property names — and a derived `var()` that
   * misses fails silently, so a wrong rule in the prose produces no error
   * anywhere, just quietly unstyled markup.
   */
  it('tells the agent to derive property names rather than read them off the record', () => {
    expect(body).toMatch(/DERIVE the property name from the token/i);
    // The record's actual payload, so the agent stops looking for names in it.
    expect(body).toMatch(/does \*\*not\*\* carry custom property names/i);
    expect(body).toContain('--<token>-<fieldKey>');
    expect(body).toMatch(/verbatim/i);
  });

  it('consumes a composite token per field, never by a collective name', () => {
    expect(body).toContain('var(--heading-1-fontSize)');
    expect(body).toContain('var(--heading-1-lineHeight)');
    // Both wrong forms are named as wrong — the collective and the kebab-cased.
    expect(body).toMatch(/Never `var\(--heading-1\)` and never `var\(--heading-1-font-size\)`/);
    // ...and the worked example practises it rather than only preaching it: a
    // `shadow` token is composite, so `var(--shadow-raised)` would be the very
    // form the rule above forbids.
    expect(body).toContain('var(--shadow-raised-offsetX)');
    expect(body).not.toContain('var(--shadow-raised)');
  });

  it('describes modes as token redefinition, which is what the stylesheet actually emits', () => {
    // `stylesheet.ts` emits `[data-preview-mode="<name>"] { --token: … }` — modes
    // rebind custom properties. A skill that taught author-level descendant rules
    // instead would have the agent duplicate every override by hand.
    expect(body).toMatch(/redefines the tokens/i);
    expect(body).toContain('[data-preview-mode="dark"] { --color-surface: … }');
    expect(body).toMatch(/switches modes\s*\n?\s*for free/i);
    // And the escape hatch is still there, for what a token cannot carry.
    expect(body).toContain('[data-preview-mode="dark"] .card { box-shadow: none; }');
  });

  it('teaches states as an attribute selector, and never as a script harness', () => {
    // 0.2.49 replaced the "No state harness" rule. The slot it referred to is
    // gone from the document, so a skill still promising one would send the
    // agent looking for a place to put JavaScript that no longer exists.
    expect(body).not.toMatch(/No state harness/i);
    expect(body).not.toMatch(/`<script>` slot stays empty/);
    expect(body).toContain('[data-preview-state="<name>"]');
    expect(body).toMatch(/never through script/i);
    // Alternative states as SIBLINGS switched off by an ancestor selector — the
    // pattern the document's own composition makes possible, stated as
    // sanctioned so an agent does not read it as the smell it resembles.
    expect(body).toContain('[data-preview-state="empty"] .results { display: none; }');
  });

  it('requires the default state to render a complete screen on its own', () => {
    expect(body).toMatch(/default state must render a complete screen/i);
    expect(body).toMatch(/never a precondition/i);
  });

  it('requires the fragment to work in EVERY mode, because the reviewer picks it', () => {
    // The mode axis moved from the author's wrapper to the preview's variant
    // box, so "looks right in the mode I hard-coded" stopped being enough.
    expect(body).toMatch(/every\*\* mode/i);
    expect(body).toMatch(/reviewer picks the mode/i);
  });
});

describe('the body states the write contract', () => {
  it('writes through update_entities as a partial update', () => {
    expect(body).toContain('update_entities');
    expect(body).toMatch(/A partial update\./);
  });

  it('saves states[] and mockupHtml in ONE call', () => {
    // Two calls would leave the entity inconsistent in between: a mockup
    // illustrating a state the view does not declare, or the reverse.
    expect(body).toMatch(/go in ONE call/);
    expect(body).toMatch(/leave the\s+entity inconsistent/i);
  });

  it('wraps the field in `data`, the shape the tool schema actually requires', () => {
    // `entity-tools.ts` declares `updates: [{ slug, data, newSlug? }]` and zod
    // strips anything else, so a field placed beside `slug` is not a partial
    // update — it is a no-op the agent cannot see. Every example must carry the
    // wrapper, and the prose must say why.
    expect(body).toContain("update_entities({ type: 'ui-view', updates: [{ slug: '<slug>', data: {");
    expect(body).toContain("mockupHtml: '<fragment>',");
    expect(body).toContain('data: { mockupHtml: null }');
    expect(body).toMatch(/\*\*inside `data`\*\*/);
    // No example may show the flat shape.
    expect(body).not.toMatch(/\{ slug: '<slug>', mockupHtml:/);
  });

  it('says null clears and omission means no change', () => {
    expect(body).toMatch(/`data: \{ mockupHtml: null \}` clears the mockup/i);
    expect(body).toMatch(/Omitting the field means "no\s+change"/i);
  });

  it('forbids both escape hatches: a file on disk and the mockup route', () => {
    expect(body).toMatch(/do \*\*not\*\* write a file to disk/i);
    expect(body).toMatch(/do \*\*not\*\* call the mockup route/i);
  });
});

describe('the body handles the contexts that cannot write', () => {
  it('names ask (plan mode) and brief (no entity-tools) and tells the agent to describe instead', () => {
    expect(body).toMatch(/`ask`[\s\S]{0,80}plan mode/i);
    expect(body).toMatch(/`brief`[\s\S]{0,140}entity-tools/i);
    expect(body).toMatch(/\*\*describe\*\* the mockup you would write/i);
  });
});

describe('the skill practises what it prescribes', () => {
  it('shows no hardcoded hex or px in any example it gives', () => {
    // The examples are the part an agent is most likely to copy verbatim, so a
    // literal here would teach exactly the thing the rule above forbids.
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b\d+px\b/);
  });
});
