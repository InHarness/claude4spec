# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u04-plugin-registration-contract",
    "goal": "Kontrakt rejestracji pluginu (M13, M33) zmienia się w czterech punktach:\n  - Tożsamość typu dostaje opcjonalną politykę kolizji sluga wyprowadzonego ze wzorca: domyślnie odmowa, opcjonalnie sufiks. Każdy typ, który dziś dokleja sufiks, deklaruje to w tej samej rundzie.\n  - Duplikat nazwy narzędzia w jednym serwerze albo duplikat nazwy serwera w puli jest odrzucany przy ładowaniu kodem `PLUGIN_TOOL_CONFLICT` (na wzór `PLUGIN_TYPE_CONFLICT`). Znika ciche nadpisywanie fabryki serwera i ciche pomijanie całego serwera na turę.\n  - Ciche last-wins w warstwie bazowej rejestru dostaje termin: trwa do wydzielenia ostatniego typu wbudowanego (`ac`, `diagram`). Teraz nie zmienia się nic w kodzie.\n  - Kontrakt nie ma generycznego helpera tras CRUD: CRUD REST generuje host. Router pluginu niesie wyłącznie trasy domenowe, a typ bez nich routera nie deklaruje.\n\n  `HOST_API_VERSION` zostaje bez bumpu. Wpis changelogu Host API dla tej wersji traci pozycję o polu postaci rejestracji znacznika XML, bo kształt rejestracji znacznika wypada z wersjonowanej powierzchni (M51).",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m13-entity-framework/L2-domain.md",
          "change": {
            "offset": 0,
            "limit": 2,
            "anchors": [
              "z7l89jhf",
              "m13pool0"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-domain.md",
          "context": {
            "offset": 0,
            "limit": 2,
            "anchors": [
              "m13dom00",
              "z7l89jhf"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-domain.md",
          "context": {
            "offset": 5,
            "limit": 1,
            "anchors": [
              "m13pool0"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-entity-composition.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-entity-composition.md",
          "context": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "k4mwv86r"
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
        },
        {
          "key": "pages/modules/m13-entity-framework/m13-entity-framework.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m13-entity-framework/m13-entity-framework.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "m13cel00",
              "m13dep00"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/m13-entity-framework.md",
          "context": {
            "offset": 4,
            "limit": 1,
            "anchors": [
              "fddg85o3"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/m13-entity-framework.md",
          "context": {
            "offset": 13,
            "limit": 1,
            "anchors": [
              "l4crudhl"
            ]
          }
        },
        {
          "key": "pages/modules/m33-plugin-loader/m33-plugin-loader.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "m33load01"
            ]
          }
        },
        {
          "key": "pages/modules/m33-plugin-loader/m33-plugin-loader.md",
          "context": {
            "offset": 1,
            "limit": 4,
            "anchors": [
              "m33purp01",
              "m33deps01",
              "m33l2001",
              "m33load01"
            ]
          }
        },
        {
          "key": "pages/modules/m51-xml-markup-registry.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "klprfawm"
            ]
          }
        },
        {
          "key": "pages/modules/m51-xml-markup-registry.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "ubiy3jsy",
              "cpxu6t9d"
            ]
          }
        },
        {
          "key": "pages/modules/m51-xml-markup-registry.md",
          "context": {
            "offset": 17,
            "limit": 1,
            "anchors": [
              "klprfawm"
            ]
          }
        },
        {
          "key": "plugins/modules/c4s-plugin-api-contracts/endpoint.md",
          "change": "all"
        },
        {
          "key": "plugins/modules/c4s-plugin-api-contracts/endpoint.md",
          "context": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "aaihelh6"
            ]
          }
        },
        {
          "key": "plugins/modules/c4s-plugin-api-contracts/endpoint.md",
          "context": {
            "offset": 16,
            "limit": 1,
            "anchors": [
              "69i6wnvo"
            ]
          }
        }
      ],
      "entities": []
    },
    "jobs": []
  },
  "portion": {
    "name": "u04-plugin-registration-contract/p1-l2-a",
    "layers": [
      "L2"
    ],
    "slugs": [
      "section:z7l89jhf",
      "section:m13pool0",
      "section:x2nr826t",
      "section:l4crudhl"
    ],
    "packet": ".c4s-impl/packets/u04-plugin-registration-contract-p1-l2-a.md"
  },
  "only": [],
  "stateDir": ".c4s-impl/"
}
```
