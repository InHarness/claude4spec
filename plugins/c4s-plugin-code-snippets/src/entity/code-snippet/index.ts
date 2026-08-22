import type { EntityContribution } from '@c4s/plugin-runtime';
import {
  CODE_SNIPPET_DISPLAY_ORDER,
  CODE_SNIPPET_LABEL,
  CODE_SNIPPET_LABEL_PLURAL,
  CODE_SNIPPET_PATH_PREFIX,
  CODE_SNIPPET_TYPE,
} from '../../identity.js';
import { codeSnippetData, codeSnippetSlugPattern } from './schema.js';
import { codeSnippetSystemPrompt } from './system-prompt.js';

/**
 * The `code-snippet` contribution.
 *
 * NO `backend` KEY AT ALL, and its absence is the declaration — the second such
 * package after `c4s-plugin-mcp-tools`. The host generates the write path from
 * `data.schema`, the REST router from `pathPrefix` + `data`, the `code_snippet`
 * projection from the same schema, the search scope from its text leaves, and
 * snapshot / restore / diff from the declaration. Three candidate operations
 * were considered and each was refused for its own reason:
 *
 *   - `validate_code_snippet` (a syntax pre-flight, as `diagram-tools` has) is
 *     POINTLESS. A snippet is by definition a FRAGMENT — incomplete, frequently
 *     containing an elision — so any real parser would reject correct snippets.
 *     The validator would emit nothing but false alarms.
 *   - `search_code_snippets` is REDUNDANT. It would only have a job if `code`
 *     were `contentBearing` and therefore out of `searchableFields`; having
 *     declined that flag, the generic `search_entities` already reaches the code.
 *   - `get_code_lines` (a line window, as spreadsheets have `get_range`) is
 *     REDUNDANT. A window earns its keep only when the whole value cannot be
 *     handed over in one read; the 10 000-character cap guarantees it can, and
 *     `get_entities` returns `code` whole.
 *
 * `slugConflict: 'suffix'`, which is the OPPOSITE of what `mcp-tool` and
 * `diagram` choose, and the difference is about what a duplicate MEANS. Two
 * tools sharing a server and a name are two descriptions of one tool — a
 * mistake, and `-2` would file the mistake as a legal catalogue entry. Two
 * snippets sharing a title are ordinary: "Manifest" is a reasonable name for
 * many manifests. So this type follows `spreadsheet` and `ac`.
 *
 * NO `payloadUpgrades`, because `payloadVersion` is 1. Nothing of this type
 * exists on disk anywhere — the type could not be created at all before this
 * package — so there is no earlier shape to migrate from. The chain starts empty
 * and stays that way until a field changes meaning.
 */
export const codeSnippetEntity: EntityContribution = {
  type: CODE_SNIPPET_TYPE,
  data: codeSnippetData,
  slugPattern: codeSnippetSlugPattern,
  slugConflict: 'suffix',
  payloadVersion: 1,
  label: CODE_SNIPPET_LABEL,
  labelPlural: CODE_SNIPPET_LABEL_PLURAL,
  displayOrder: CODE_SNIPPET_DISPLAY_ORDER,
  pathPrefix: CODE_SNIPPET_PATH_PREFIX,
  systemPrompt: codeSnippetSystemPrompt,
};
