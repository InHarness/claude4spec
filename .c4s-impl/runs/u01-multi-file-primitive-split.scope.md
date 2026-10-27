# Scope of this run

```json
{
  "unit": {
    "id": "u01-multi-file-primitive",
    "goal": "Historia wersji plików dostaje opcjonalny identyfikator operacji wieloplikowej (kolumna z indeksem). Prymityw zapisu rekordu (M42) daje wywołującym dwie wspólne reguły. Po pierwsze, wszystkie wiersze historii jednej operacji, także wiersze rollbacku, dzielą ten identyfikator. Po drugie, gdy zapis któregoś pliku zawiedzie, operacja przywraca już zapisane pliki dalszymi zapisami prymitywu (best-effort, to nie transakcja) i zwraca błąd. Znika zapis „atomowości między plikami nie ma i ta runda jej nie wprowadza”.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m42-record-store.md",
          "change": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "gg7sxih6"
            ]
          }
        },
        {
          "key": "pages/modules/m42-record-store.md",
          "context": {
            "offset": 1,
            "limit": 4,
            "anchors": [
              "b7i91tvp",
              "hu317m75",
              "wsrnp3ab",
              "544jcpq5"
            ]
          }
        },
        {
          "key": "pages/modules/m42-record-store.md",
          "context": {
            "offset": 10,
            "limit": 1,
            "anchors": [
              "0uzd1sug"
            ]
          }
        },
        {
          "key": "pages/modules/m42-record-store.md",
          "context": {
            "offset": 13,
            "limit": 1,
            "anchors": [
              "gg7sxih6"
            ]
          }
        }
      ],
      "entities": [
        {
          "type": "database-table",
          "slugs": [
            "file-version"
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
