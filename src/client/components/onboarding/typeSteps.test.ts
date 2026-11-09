import { describe, expect, it } from 'vitest';
import { SKILL_DETAILS_STEP, namePrefill } from './typeSteps.js';

// rev-0001 — the detail steps' `skill.name` pre-fill uses the shared slug rule.
describe('typeSteps — skill.name pre-fill from the project name', () => {
  it('transliterates a Polish name, ł included (Właściwości → wlasciwosci)', () => {
    expect(namePrefill('Właściwości')).toBe('wlasciwosci');
    expect(SKILL_DETAILS_STEP.initial({ projectName: 'Właściwości', current: {} })['skill.name']).toBe('wlasciwosci');
  });

  it('leaves the field empty (no x-<hash> fallback) when the name gives no slug, so live validation flags it', () => {
    const values = SKILL_DETAILS_STEP.initial({ projectName: '项目规格', current: {} });
    expect(values['skill.name']).toBe('');
    expect(SKILL_DETAILS_STEP.validate(values)['skill.name']).toBe('Use lowercase letters, digits and hyphens.');
  });
});
