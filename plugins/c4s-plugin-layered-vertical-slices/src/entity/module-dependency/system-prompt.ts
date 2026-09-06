import type { SystemPromptContribution } from '@c4s/plugin-runtime';

/**
 * REQUIRED, and the requirement is not a formality: the system-prompt builder
 * walks the contributions and a type without this slot is omitted from the
 * prompt ENTIRELY. The agent would then be told to record dependencies as
 * entities by `SKILL.md` while never learning that this type exists.
 *
 * No `mcpToolsLine` — the type contributes no MCP server, so there is no tool to
 * name. No `defaultPredicate` — every edge is a claim about the present, and
 * there is no status field to narrow a listing by.
 *
 * `narrativeBlock` carries the four facts that cannot be read off the schema:
 * the unit is the ordered pair, the tag comes from `dependent`, `needs` is
 * about what flows, and incoming edges are a FILTER rather than a tag query.
 * That last one is the whole reason `provider` is a declared scalar.
 */
export const moduleDependencySystemPrompt: SystemPromptContribution = {
  roleNoun: 'Module dependencies',
  narrativeBlock:
    'Zależność moduł→moduł zapisuj JEDNĄ encją module-dependency na uporządkowaną parę, otagowaną ' +
    'krótkim tagiem modułu z pola dependent. Pole needs mówi, co ten moduł by stracił bez tamtego — ' +
    'prozą, bez nazw pól i endpointów, bez identyfikatora modułu w treści. Relacja wzajemna to DWIE ' +
    'encje. Krawędzie przychodzące czytaj zapytaniem list_entities({ type: "module-dependency", ' +
    'filters: { provider: "MNN" } }), nie tagiem.',
};
