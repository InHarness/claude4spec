// @vitest-environment happy-dom
/**
 * 2.1.86 — M52: the `Used skill projects` list of the `#skills` card grouped by
 * the provider's project type (`row.projectType`), in the order and with the
 * names of `GET /api/workspace/project-types`; rows with no type last, unheaded.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExposedProjectRow } from '../../../shared/spec-skills.js';
import { UsedSkillProjectsList } from './specSkillsSettings.js';

/** `GET /api/workspace/project-types` — the registry in its order (2.1.86: by position). */
const TYPES = [
  { slug: 'spec', name: 'Specification', description: 'd' },
  { slug: 'writing-style', name: 'Writing Style', description: 'd' },
  { slug: 'skill', name: 'Skill', description: 'd' },
];

describe('#skills — Used skill projects grouped by the provider\'s type (M52, 2.1.86)', () => {
  const rows: ExposedProjectRow[] = [
    { name: 'a-ghost', uses: true, status: 'unavailable', confirmed: true },
    { name: 'billing-rules', description: 'b', projectId: 'billing', projectType: 'skill', uses: true, status: 'ok', confirmed: true },
    { name: 'docs', uses: false, status: 'ambiguous', confirmed: false },
    { name: 'house-style', description: 'h', projectId: 'house', projectType: 'writing-style', uses: false, status: 'ok', confirmed: true },
    { name: 'legal-terms', description: 'l', projectId: 'legal', projectType: 'skill', uses: false, status: 'ok', confirmed: true },
  ];
  const render = () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      createElement(UsedSkillProjectsList, { rows, types: TYPES, uses: [], onToggle: () => {} }),
    );
    return host;
  };

  it('[ac:ac-lista-used-skill-projects-na-karcie-s] the list is split into groups of the providers\' types in the order of GET /api/workspace/project-types, each headed by the type name; a type with no row has no group', () => {
    const host = render();
    const groups = Array.from(host.querySelectorAll('[data-project-type-group]')).map((g) => [
      g.querySelector('[data-testid="project-type-group-header"]')?.textContent,
      Array.from(g.querySelectorAll('[data-skill-name]')).map((r) => r.getAttribute('data-skill-name')),
    ]);
    expect(groups).toEqual([
      ['Writing Style', ['house-style']],
      ['Skill', ['billing-rules', 'legal-terms']],
    ]);
    expect(host.textContent).not.toContain('Specification');
  });

  it('[ac:ac-wiersz-wiszacy-albo-niejednoznaczny-s] a dangling or ambiguous row stands after every type group, with no group header', () => {
    const host = render();
    const order = Array.from(host.querySelectorAll('[data-skill-name]')).map((r) => r.getAttribute('data-skill-name'));
    expect(order).toEqual(['house-style', 'billing-rules', 'legal-terms', 'a-ghost', 'docs']);
    const tail = host.querySelector('[data-untyped-rows]')!;
    expect(tail.querySelector('[data-testid="project-type-group-header"]')).toBeNull();
    expect(tail.closest('[data-project-type-group]')).toBeNull();
    expect(Array.from(tail.querySelectorAll('[data-skill-name]')).map((r) => r.getAttribute('data-skill-name'))).toEqual([
      'a-ghost',
      'docs',
    ]);
  });
});
