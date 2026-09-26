import type { FieldDeclaration } from '../../settings/field-registry.js';

/**
 * 0.2.113 — the consistency rules' severities, declared by the consistency check.
 * Read per run (`per-operation`). NOT writable through the API and without a card:
 * a project turns a rule on by editing `config.json` by hand.
 */
const severity = (key: string): FieldDeclaration => ({
  key,
  owner: 'consistency',
  type: { enum: ['off', 'warn', 'error'] },
  default: 'off',
  effect: 'per-operation',
  resumeLock: false,
  apiWritable: false,
});

export const CONSISTENCY_SETTINGS_FIELDS: FieldDeclaration[] = [
  severity('consistency.requireAcCoverage'),
  severity('consistency.requireModuleAc'),
  severity('consistency.requireTagConsumer'),
];
