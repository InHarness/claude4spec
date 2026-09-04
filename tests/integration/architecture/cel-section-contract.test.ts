import { beforeAll, describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../../src/server/services/skill-registry.js';
import { validateWritingStyle } from '../../../src/server/core/plugin-host/manifest-adapter.js';
import { manifest } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/manifest.js';

/**
 * 0.2.67 — the style package's CONTENTS become a contract.
 *
 * Until this release `layered-vertical-slices` was specified as an artifact whose
 * insides were its own business: nothing about them could be asserted, so nothing
 * about them could regress. Two things stopped being taste here — the rules for a
 * module's `Cel` section, and the cross-cutting reading protocol — and the test
 * that says so is the one that reads the package the way the agent does.
 *
 * Read through the registry rather than off the path. What the host serves is the
 * registry ENTRY, and this package has no path at all: it travels as `?raw`
 * literals compiled into its module. Pushing the manifest's own `writingStyles`
 * through the real lowering (`validateWritingStyle`) and then `addPluginSkill` is
 * both the shortest route to the served bytes and a check that the envelope
 * really carries them.
 *
 * The deciding test the specification names for every promise below: can it be
 * settled by reading the package repo, without reaching for anyone's opinion.
 */
describe('the layered-vertical-slices package keeps the content contract it promises', () => {
  const SLUG = 'layered-vertical-slices';

  let skill: string;
  let moduleTemplate: string;
  let files: Record<string, string>;

  /** The body of a `## `-level section, from its heading to the next H2 or EOF. */
  function h2(doc: string, heading: string): string {
    const start = doc.indexOf(`\n## ${heading}`);
    expect(start, `no "## ${heading}" section`).toBeGreaterThan(-1);
    const after = start + 1;
    const next = doc.indexOf('\n## ', after + 1);
    return doc.slice(after, next > -1 ? next : undefined);
  }

  beforeAll(() => {
    const registry = SkillRegistry.load([]);
    for (const style of manifest.contributes.writingStyles ?? []) {
      registry.addPluginSkill(validateWritingStyle(style));
    }
    const resolved = registry.resolve(SLUG);
    skill = resolved.content;
    // `resolve` hands back `SkillPackageFile` records (path/bytes/lines/isText/
    // content); the contract below is about the bytes `load_skill_file` serves,
    // so flatten to the text and assert on that.
    files = Object.fromEntries(
      Object.entries(resolved.files ?? {}).map(([rel, f]) => [rel, f.content]),
    );
    moduleTemplate = files['templates/module.md'] ?? '';
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-3] opens the module template on a literal `## Cel` as its first H2', () => {
    expect(moduleTemplate.length).toBeGreaterThan(100);
    const headings = [...moduleTemplate.matchAll(/^## .*$/gm)].map((m) => m[0]);
    // The heading is a PROTOCOL TOKEN, not prose: §8's sweep matches this exact
    // string, so a translated or reworded heading drops the module out of every
    // cross-cutting read. `## Purpose` is the variant that does it today.
    expect(headings[0]).toBe('## Cel');
    expect(moduleTemplate).not.toMatch(/^## Purpose$/m);
  });

  it('[ac:ac-szablon-templates-module-md-nie-stawi] puts nothing at all between the module template H1 and that H2', () => {
    const h1 = moduleTemplate.search(/^# .*$/m);
    expect(h1).toBeGreaterThan(-1);
    const cel = moduleTemplate.indexOf('\n## Cel');
    expect(cel).toBeGreaterThan(h1);
    const between = moduleTemplate.slice(moduleTemplate.indexOf('\n', h1), cel).trim();
    // A hook block here duplicated the purpose while carrying no anchor of its
    // own — invisible to the section index and to §8. Whitespace is all that is
    // allowed to survive between the two.
    expect(between).toBe('');
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-4] states the `Cel` composition rule with an explicit character budget', () => {
    const section = h2(skill, "7. The module's `Cel` section");
    expect(section).toMatch(/user job/i);
    expect(section).toMatch(/2[–-]4 sentences/i);
    // The budget is checked as a LITERAL NUMBER, not as the rule around it: a
    // budget written as "keep it short" is the thing this criterion exists to
    // refuse.
    expect(section).toMatch(/\b\d{3,}\s*characters\b/i);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-5] prohibits entity embeds, `section_ref` and module/layer identifiers in `Cel`', () => {
    const section = h2(skill, "7. The module's `Cel` section");
    expect(section).toMatch(/no entity embeds/i);
    expect(section).toContain('section_ref');
    expect(section).toMatch(/module or layer identifiers/i);
    // "including its own" is the half that gets dropped, and dropping it turns
    // the rule into one every module can satisfy by naming only itself.
    expect(section).toMatch(/including its own/i);
    // The prohibition NARROWS the host's referential convention rather than
    // fulfilling it: an entity is named neither by a tag nor by bare prose.
    expect(section).toMatch(/untagged prose/i);
    // …while negative scope, which needs no foreign identifier, stays allowed.
    expect(section).toMatch(/[Nn]egative scope is allowed/);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-6] catalogues the mechanically decidable `Cel` rules, each with a named violation symptom', () => {
    const catalogue = skill.slice(skill.indexOf('### Rules decidable on the section text alone'));
    expect(catalogue.length).toBeGreaterThan(0);
    const items = [...catalogue.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)];
    expect(items.length).toBeGreaterThanOrEqual(6);
    // Every item carries the thing you OBSERVE when it is broken — a rule with no
    // symptom cannot be applied by a reader who does not already know the answer.
    const symptoms = [...catalogue.matchAll(/\*Symptom:\*/g)];
    expect(symptoms.length).toBeGreaterThanOrEqual(items.length);
    // Item 7 is the honest one: a yes/no question no machine settles, with the
    // tautology test that catches the usual failure. The spec does not pretend
    // otherwise, and neither does this assertion.
    expect(catalogue).toMatch(/qualitative only/i);
    expect(catalogue).toMatch(/X handles X/);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-7] makes the module main-file path filter a step of the protocol, not a variant', () => {
    const protocol = h2(skill, '8. Cross-cutting reading protocol');
    expect(protocol).toContain('search_pages');
    expect(protocol).toMatch(/mode:\s*"map"/);
    expect(protocol).toContain('pathInclude');
    expect(protocol).toMatch(/step of this protocol, not a variant/i);
    // Why it is a step and not an optimization: without it the sweep still
    // succeeds and answers a different question — the purpose of a FILE.
    expect(protocol).toMatch(/purpose of a \*\*file\*\*/i);
    expect(protocol).toMatch(/parts\*\* of the protocol rather than optimizations/i);
  });

  it('[ac:ac-protokol-odczytu-przekrojowego-w-skil] declares the path match case-insensitive, and spells it that way', () => {
    const protocol = h2(skill, '8. Cross-cutting reading protocol');
    expect(protocol).toMatch(/case-insensitive/i);
    // The declaration alone would be a claim the pattern does not honour:
    // `pathInclude` compiles with no `i` flag and JS has no inline `(?i)`, so the
    // insensitivity has to be in the character classes themselves.
    expect(protocol).toMatch(/no `i` flag/);
    expect(protocol).toContain('[Mm]odules');
  });

  it('[ac:ac-kazdy-z-plikow-workflows-daily-md-wor] points daily, brief and patch at the protocol from their change-locating step', () => {
    for (const file of ['workflows/daily.md', 'workflows/brief.md', 'workflows/patch.md']) {
      const body = files[file] ?? '';
      expect({ file, present: body.length > 0 }).toEqual({ file, present: true });
      expect({ file, ref: /cross-cutting reading protocol/i.test(body) }).toEqual({
        file,
        ref: true,
      });
      expect({ file, section: body.includes('SKILL.md §8') }).toEqual({ file, section: true });
    }
    // The brief thread is the one that cannot RUN the protocol — `search_pages`
    // describes HEAD and a brief is grounded only in `release_diff`. It borrows
    // the path pattern as a classifier over the delta map, and says so, or the
    // reference reads as an invitation to break §E.
    expect(files['workflows/brief.md']).toMatch(/pattern, not the call/i);
  });
});
