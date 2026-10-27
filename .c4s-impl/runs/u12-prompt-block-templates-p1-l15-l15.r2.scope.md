# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u12-prompt-block-templates",
    "goal": "Treść zmienia się tylko w szablonie bloku obsługi bieżącej strony:\n  - trasa sekcyjna jest opisana jako zawsze dostępna, bo każdy root stron ma indeks sekcji; znika zastrzeżenie o rootach bez indeksu;\n  - parametr nadpisania całej strony zmienia nazwę.\n\n  Pozostałe 35 szablonów zmienia tylko metadane: dostają znacznik weryfikacji, a szablon bloku adnotacji zmienia moduł-właściciela z M48 na M05. Renderowany tekst promptu tych 35 szablonów jest bez zmian.",
    "recipe": {
      "pages": [],
      "entities": [
        {
          "type": "code-snippet",
          "slugs": [
            "szablon-current-page-handling",
            "szablon-agent-filesystem-access",
            "szablon-agent-path-scope",
            "szablon-annotation-handling",
            "szablon-annotations",
            "szablon-available-skills-spec-skills",
            "szablon-available-skills",
            "szablon-brief-scope",
            "szablon-brief-tools-usage",
            "szablon-claude4spec-identity",
            "szablon-claude4spec-plan-mode",
            "szablon-conversational-language",
            "szablon-current-patch-rama",
            "szablon-current-patch-tresc",
            "szablon-current-skill",
            "szablon-diagram-references",
            "szablon-discovery-and-impact",
            "szablon-entities-rama",
            "szablon-entities-wiersz-diagram",
            "szablon-entities-wiersz",
            "szablon-entity-embeds",
            "szablon-interaction-context-ask",
            "szablon-interaction-context-brief",
            "szablon-interaction-context-patch",
            "szablon-interaction-context-rama",
            "szablon-project-writing-skill",
            "szablon-project",
            "szablon-sections-and-anchors",
            "szablon-spec-language",
            "szablon-tags",
            "szablon-todo-markers",
            "szablon-tooling-c4s-tools",
            "szablon-tooling-patch-tools",
            "szablon-tooling-plan-tools",
            "szablon-tooling",
            "szablon-workspace-projects"
          ]
        }
      ]
    },
    "jobs": []
  },
  "portion": {
    "name": "u12-prompt-block-templates/p1-l15-l15",
    "layers": [
      "L15"
    ],
    "slugs": [
      "szablon-current-page-handling",
      "szablon-agent-filesystem-access",
      "szablon-agent-path-scope",
      "szablon-annotation-handling",
      "szablon-annotations",
      "szablon-available-skills-spec-skills",
      "szablon-available-skills",
      "szablon-brief-scope",
      "szablon-brief-tools-usage",
      "szablon-claude4spec-identity",
      "szablon-claude4spec-plan-mode",
      "szablon-conversational-language",
      "szablon-current-patch-rama",
      "szablon-current-patch-tresc",
      "szablon-current-skill",
      "szablon-diagram-references",
      "szablon-discovery-and-impact",
      "szablon-entities-rama",
      "szablon-entities-wiersz-diagram",
      "szablon-entities-wiersz",
      "szablon-entity-embeds",
      "szablon-interaction-context-ask",
      "szablon-interaction-context-brief",
      "szablon-interaction-context-patch",
      "szablon-interaction-context-rama",
      "szablon-project-writing-skill",
      "szablon-project",
      "szablon-sections-and-anchors",
      "szablon-spec-language",
      "szablon-tags",
      "szablon-todo-markers",
      "szablon-tooling-c4s-tools",
      "szablon-tooling-patch-tools",
      "szablon-tooling-plan-tools",
      "szablon-tooling",
      "szablon-workspace-projects"
    ],
    "packet": ".c4s-impl/packets/u12-prompt-block-templates-p1-l15-l15.md"
  },
  "only": [
    {
      "finding": "rev-0001"
    }
  ],
  "stateDir": ".c4s-impl/"
}
```
