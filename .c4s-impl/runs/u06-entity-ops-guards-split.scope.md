# Scope of this run

```json
{
  "unit": {
    "id": "u06-entity-ops-guards",
    "goal": "Dwie operacje na encjach dostają nowe zachowanie:\n  - **Mutacja:** każda pozycja paczki może nieść numer wersji encji, na którym oparto zmianę. Przy innym bieżącym numerze pozycja kończy się `VERSION_CONFLICT` bez zapisu, a reszta paczki idzie dalej. Sprawdzenie i zapis leżą w jednej sekcji krytycznej prymitywu. Pozycja bez numeru zapisuje bez sprawdzenia.\n  - **Tworzenie:** jawnie podany, zajęty slug daje `SLUG_CONFLICT`. Kolizja sluga wyprowadzonego ze wzorca idzie według polityki typu z u04. Odmowa jednej pozycji nie cofa pozostałych.\n\n  Obie operacje tracą kanał CLI, bo generyczne komendy encji `c4s` są wyłącznie odczytem. Ich powiązanie z trasami REST wskazuje generyczne trasy hosta.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m29-entity-store.md",
          "context": {
            "offset": 4,
            "limit": 1,
            "anchors": [
              "m29wr001"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-entity-composition.md",
          "context": {
            "offset": 9,
            "limit": 1,
            "anchors": [
              "x2nr826t"
            ]
          }
        }
      ],
      "entities": [
        {
          "type": "spec-operation",
          "slugs": [
            "create-entities",
            "update-entities"
          ]
        },
        {
          "type": "mcp-tool",
          "slugs": [
            "entity-tools-update-entities"
          ]
        }
      ]
    },
    "jobs": []
  },
  "stateDir": ".c4s-impl/",
  "mode": "split"
}
```
