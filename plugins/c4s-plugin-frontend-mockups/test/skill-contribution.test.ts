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
  // Every part of the PACKAGE, not just the body: a sub-file is served to the
  // same agent by the same tool, so a literal in `principles.md` teaches the
  // forbidden thing exactly as effectively as one in an example in `content`.
  const wholePackage = Object.entries({
    'SKILL.md': body,
    ...(uiViewMockupGeneratorSkill.files ?? {}),
  });

  it('shows no hardcoded hex or px in any example it gives, in any file of the package', () => {
    // The examples are the part an agent is most likely to copy verbatim, so a
    // literal here would teach exactly the thing the rule above forbids.
    for (const [path, text] of wholePackage) {
      expect(text, `${path} carries a hex literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, `${path} carries a px literal`).not.toMatch(/\b\d+px\b/);
    }
  });

  it('never shows the collective form of a composite token, nor a flat update shape', () => {
    // Both are forms the body forbids in prose; a sub-file quietly demonstrating
    // one would be the only example an agent actually copies.
    for (const [path, text] of wholePackage) {
      expect(text, path).not.toContain('var(--shadow-raised)');
      expect(text, path).not.toMatch(/\{ slug: '<slug>', mockupHtml:/);
    }
  });
});

describe('the skill ships as a package, not as one body', () => {
  const files = uiViewMockupGeneratorSkill.files ?? {};

  it('carries exactly the two sub-files, each non-empty', () => {
    // `files` is what `load_skill_file(slug)` advertises as a manifest and what
    // `load_skill_file(slug, file)` serves. A typo'd key registers silently: the
    // manifest lists a path the body never names, and the body names one that
    // 404s — neither is a type error, and neither shows up in `content`.
    expect(Object.keys(files).sort()).toEqual(['principles.md', 'research.md']);
    for (const [path, text] of Object.entries(files)) {
      expect(text.trim().length, `${path} is empty`).toBeGreaterThan(0);
    }
  });

  it('routes to both sub-files from the body, by the exact keys `files` registers', () => {
    // The model reaches a sub-file by asking for it BY PATH. A router naming
    // `research` or `RESEARCH.md` sends it at a key the registry does not hold.
    for (const path of Object.keys(files)) {
      expect(body).toContain(path);
    }
    expect(body).toMatch(/before drawing a NEW mockup/i);
    expect(body).toMatch(/before drawing \*\*and\*\* again before saving/i);
  });

  it('keeps a one-line version of the binding rule in the body, for the turn that opens neither', () => {
    // Sub-files are opt-in: nothing forces the model to fetch them. A router
    // that were a bare pointer would leave a skipped fetch with NO rule at all
    // about what may reach the screen — the exact gap this change closes.
    expect(body).toMatch(/invent VALUES, never FEATURES/i);
    expect(body).toMatch(/no named source does not go on the screen/i);
  });
});

describe('the body still pins the discovery contract the router replaced', () => {
  // Step 1.4 became a router, but the two-tools distinction is a fact about the
  // tools, not about the old step, and it stayed WRONG for a whole release once
  // already (`find_references` called by tags). Moving it into `research.md`
  // would drop it out of every turn that does not fetch the sub-file.
  it('keeps the list_entities-by-tag / find_references-by-target split in the always-on body', () => {
    expect(body).toMatch(/list_entities\(\{[^)]*tags:/);
    expect(body).toContain("find_references({ target: 'entity', type: 'ui-view', slug })");
    expect(body).toMatch(/takes no tags and\s*\n?\s*requires the `target` discriminator/);
  });

  it('names no entity type as guaranteed beyond the two the envelope ships', () => {
    // The skill rides an envelope into ANY project: `endpoint`/`dto`/`ac` exist
    // in some and in none in others. The old step 1.4 named them as the types to
    // query, which reads as an instruction to call `list_entities` on a type
    // this project never registered.
    expect(body).not.toMatch(/\(`endpoint`, `dto`, `ac`\)/);
    expect(body).toContain("list_entities({ type: '<type>', tags: [...], tagFilter: 'or' })");
  });
});

describe('research.md carries the three questions and the variable type roster', () => {
  const research = uiViewMockupGeneratorSkill.files?.['research.md'] ?? '';

  it('sends the agent to the <entities> prompt block rather than to discovery', () => {
    // `chat-context.ts` already puts one row per active type in the system
    // prompt. A skill that told the agent to DISCOVER the roster would spend
    // calls re-deriving what it was handed on turn one — and would still miss
    // the types whose narrative says what they are for.
    expect(research).toContain('<entities>');
    expect(research).toMatch(/describe_entity_type[\s\S]{0,200}Never wholesale/i);
  });

  it('states which two types are guaranteed, and treats every other name as an example', () => {
    expect(research).toMatch(/Exactly two types are guaranteed[\s\S]{0,120}`design-system`/);
    expect(research).toMatch(/never types you may assume are there/i);
  });

  it('asks all three questions and names a channel for each', () => {
    expect(research).toMatch(/## DATA/);
    expect(research).toMatch(/## LOOK/);
    expect(research).toMatch(/## BEHAVIOUR/);
    // Siblings are the only record of the user journey — there is no entity for it.
    expect(research).toContain("list_entities({ type: 'ui-view', filters: { designSystemSlug: '<slug>' } })");
    expect(research).toMatch(/neighbouring views are its only record/i);
    // A criteria-to-entity bond is entity DATA, so the document-edge tool misses it.
    expect(research).toMatch(/find_references\`?\s*\n?\s*will not return it/i);
  });

  it('keeps delegation soft, and the three questions mandatory', () => {
    // `spec-explore` cannot read this file, so handing it the JUDGEMENT would
    // hand it to something that never saw the rules. Locating is all it does.
    expect(research).toMatch(/that is your call, not a rule/i);
    expect(research).toMatch(/mandatory is going through the\s*\n?\s*three questions/i);
  });
});

describe('principles.md carries the four binding rules', () => {
  const principles = uiViewMockupGeneratorSkill.files?.['principles.md'] ?? '';

  it('binds the parent explicitly, because the subagent cannot read it', () => {
    // The whole reason the rules live in the parent's hands: `spec-explore` has
    // Read/Grep/Glob + read-only MCP and NO skill tools, and this file is in the
    // registry, not on disk. Delegating "decide what belongs" is unimplementable.
    expect(principles).toMatch(/cannot read this file/i);
    expect(principles).toMatch(/it never decides what goes on the screen/i);
  });

  it('states all four rules, values-not-features first', () => {
    expect(principles).toMatch(/Invent values, never features/i);
    expect(principles).toMatch(/WHEN IN DOUBT, OMIT/);
    expect(principles).toMatch(/Production fidelity/i);
    expect(principles).toMatch(/concrete, not embellished/i);
    expect(principles).toMatch(/Sample data is coherent/i);
    expect(principles).toMatch(/States are opt-in and spec-driven/i);
  });

  it('separates a proposal (ask and wait) from a discrepancy (report)', () => {
    // Both are "something is off", and collapsing them makes the agent either
    // block on a spec bug it should just report, or silently patch a gap the
    // spec-author needs to see.
    expect(principles).toMatch(/ASK THE USER AND STOP UNTIL THEY\s*\n?\s*ANSWER/);
    expect(principles).toMatch(/REPORT it in your answer/);
    expect(principles).toMatch(/AskUserQuestion` is an ungated built-in/);
  });
});

describe('the body carries what belongs to saving, not to research', () => {
  it('checks the three things before update_entities', () => {
    // Post-hoc: the fragment is written by now, so this is a review pass, not a
    // research one — which is why it stays in the body rather than in a sub-file.
    expect(body).toMatch(/difference you can actually SEE in the fragment/);
    expect(body).toMatch(/Every mode the design system declares\s*\n?\s*still renders/);
    expect(body).toMatch(/Nothing on the screen lacks a named source/);
  });

  it('says a brief thread cannot do the research at all, and why', () => {
    // `brief` gets `diff-explore`, which has release-tools and no entity graph:
    // an agent told to "describe the mockup" there would otherwise go hunting
    // for entities that its toolset cannot reach.
    expect(body).toMatch(/`diff-explore` subagent, which sees NEITHER the entity graph NOR/);
    expect(body).toMatch(/`research.md` cannot be carried out there/);
    expect(body).toMatch(/In `ask` it is the reverse/);
  });
});
