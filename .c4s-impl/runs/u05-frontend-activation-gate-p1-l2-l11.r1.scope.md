# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u05-frontend-activation-gate",
    "goal": "Lista typów aktywnych projektu (z konfiguracji encji) jest jedną bramką aktywacji dla backendu i frontendu:\n  - Frontend dostaje listę typów aktywnych, a montowanie frontendu montuje tylko moduły tych typów.\n  - Manifest frontendu projektu ogłasza plugin wnoszący typy encji tylko wtedy, gdy co najmniej jeden z jego typów jest aktywny.\n  - Plugin bez typów encji nie podlega filtrowi.\n  - Kontrakt widziany przez plugin się nie zmienia.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m13-entity-framework/L2-domain.md",
          "change": {
            "offset": 3,
            "limit": 1,
            "anchors": [
              "m13actv0"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-domain.md",
          "context": {
            "offset": 11,
            "limit": 2,
            "anchors": [
              "m13plset",
              "m13actv0"
            ]
          }
        },
        {
          "key": "pages/modules/m33-plugin-loader/m33-plugin-loader.md",
          "change": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "j1jk3ykt"
            ]
          }
        },
        {
          "key": "pages/modules/m33-plugin-loader/m33-plugin-loader.md",
          "context": {
            "offset": 10,
            "limit": 3,
            "anchors": [
              "h71olejg",
              "rki0ykan",
              "j1jk3ykt"
            ]
          }
        },
        {
          "key": "pages/modules/m33-plugin-loader/L11-plugin-runtime-surface.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m33-plugin-loader/L11-plugin-runtime-surface.md",
          "context": {
            "offset": 0,
            "limit": 3,
            "anchors": [
              "m33l5fe0",
              "m33l5man",
              "9g96q3pp"
            ]
          }
        }
      ],
      "entities": []
    },
    "jobs": []
  },
  "portion": {
    "name": "u05-frontend-activation-gate/p1-l2-l11",
    "layers": [
      "L2",
      "L11"
    ],
    "slugs": [
      "section:m13actv0",
      "section:j1jk3ykt",
      "section:9g96q3pp"
    ],
    "packet": ".c4s-impl/packets/u05-frontend-activation-gate-p1-l2-l11.md"
  },
  "only": [],
  "stateDir": ".c4s-impl/"
}
```
