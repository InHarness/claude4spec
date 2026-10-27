# Scope of this run

```json
{
  "unit": {
    "id": "u12-prompt-block-templates",
    "goal": "Treść zmienia się tylko w szablonie bloku obsługi bieżącej strony:\n  - trasa sekcyjna jest opisana jako zawsze dostępna, bo każdy root stron ma indeks sekcji; znika zastrzeżenie o rootach bez indeksu;\n  - parametr nadpisania całej strony zmienia nazwę.\n\n  Pozostałe 35 szablonów zmienia tylko metadane: dostają znacznik weryfikacji, a szablon bloku adnotacji zmienia moduł-właściciela z M48 na M05. Renderowany tekst promptu tych 35 szablonów jest bez zmian."
  },
  "diff": "git diff a8f56e5c03f773be561969c3a8e330996b8680bc..HEAD",
  "portions": [
    "u12-prompt-block-templates/p1-l15-l15"
  ],
  "stateDir": ".c4s-impl/"
}
```
