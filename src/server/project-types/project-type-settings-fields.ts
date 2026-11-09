import type { FieldDeclaration } from '../settings/field-registry.js';
import { DEFAULT_PROJECT_TYPE } from '../config.js';

/**
 * 2.1.77 — M57 `Project Settings (L17)` › `Plik konfiguracyjny` (`y47yl4xt`).
 *
 * | Klucz | Typ | Default | Walidacja | Klasa efektu | Blokada wznowienia | Zapis przez API |
 * | `projectType` | string | `spec` | slug of the type registry; unknown ⇒ activation refusal `PROJECT_TYPE_UNKNOWN` | `—` | `nie` | `stały` |
 *
 * The type never changes after the project is founded (M57 `zy42cyj7`): a PATCH
 * with the stored value changes nothing, another value is refused with
 * `PROJECT_TYPE_IMMUTABLE`. The key has no control on the settings page.
 */
export const PROJECT_TYPE_IMMUTABLE = 'PROJECT_TYPE_IMMUTABLE';

export const PROJECT_TYPE_SETTINGS_FIELDS: FieldDeclaration[] = [
  {
    key: 'projectType',
    owner: 'project-types',
    type: 'string',
    default: DEFAULT_PROJECT_TYPE,
    // No write-time rule: a `fixed` field reaches the file only with the value
    // already stored. An unknown slug is refused at activation (M57 `zy42cyj7`).
    effect: 'none',
    resumeLock: false,
    apiWritable: 'fixed',
    fixedErrorCode: PROJECT_TYPE_IMMUTABLE,
  },
];
