# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u11-consistency-junction",
    "goal": "Reguła spójności „encje bez odwołań” czyta raz na przebieg junction powiązań endpoint↔DTO, więc DTO podpięte strukturalnie do endpointu liczy się jako użyte i znika z ostrzeżeń. To jedyny drugi odczyt obok przejścia po stronach. Trawers wyszukiwania referencji się nie zmienia.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m19-references.md",
          "change": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "q91m4kgl",
              "5tfhxy2p"
            ]
          }
        },
        {
          "key": "pages/modules/m19-references.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "m19cel00",
              "m19dep00",
              "eja05viu"
            ]
          }
        },
        {
          "key": "pages/modules/m19-references.md",
          "context": {
            "offset": 13,
            "limit": 1,
            "anchors": [
              "q91m4kgl"
            ]
          }
        },
        {
          "key": "pages/modules/m19-references.md",
          "context": {
            "offset": 15,
            "limit": 1,
            "anchors": [
              "5tfhxy2p"
            ]
          }
        },
        {
          "key": "pages/modules/m39-discovery-core/L2-domain.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m39-discovery-core/L2-domain.md",
          "context": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "jhdpduny"
            ]
          }
        },
        {
          "key": "pages/modules/m39-discovery-core/L2-domain.md",
          "context": {
            "offset": 80,
            "limit": 1,
            "anchors": [
              "z5cl1q4o"
            ]
          }
        }
      ],
      "entities": []
    },
    "jobs": []
  },
  "portion": {
    "name": "u11-consistency-junction/p1-domain",
    "layers": [
      "domain"
    ],
    "slugs": [
      "section:q91m4kgl",
      "section:5tfhxy2p",
      "section:z5cl1q4o"
    ],
    "packet": ".c4s-impl/packets/u11-consistency-junction-p1-domain.md"
  },
  "only": [],
  "stateDir": ".c4s-impl/"
}
```
