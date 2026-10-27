# Scope of this run

```json
{
  "mode": "unit",
  "unit": {
    "id": "u02-multi-file-consumers",
    "goal": "Pięć operacji wieloplikowych przechodzi na wspólne reguły z u01: propagacja zmiany sluga encji (M29 i M19), propagacja zmiany kotwicy (M06), propagacja zmiany sluga tagu (M18) oraz przeniesienie strony z przepisaniem linków (M14). Każda z nich nadaje wierszom historii jeden identyfikator operacji i cofa zapisane pliki przy połowicznym niepowodzeniu. Usuwamy własne, lokalne rutyny rollbacku tych modułów.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m29-entity-store.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "m29ren001"
            ]
          }
        },
        {
          "key": "pages/modules/m29-entity-store.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "m29cel001",
              "m29dep001",
              "4p5w4eb1"
            ]
          }
        },
        {
          "key": "pages/modules/m29-entity-store.md",
          "context": {
            "offset": 5,
            "limit": 1,
            "anchors": [
              "m29ren001"
            ]
          }
        },
        {
          "key": "pages/modules/m19-references.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "8n46mdrz"
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
            "offset": 11,
            "limit": 2,
            "anchors": [
              "8n46mdrz",
              "m19xentrn"
            ]
          }
        },
        {
          "key": "pages/modules/m06-sections.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "h556wl8s"
            ]
          }
        },
        {
          "key": "pages/modules/m06-sections.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "1aq60bj4",
              "ko9x8zqw",
              "pb7v6bmz"
            ]
          }
        },
        {
          "key": "pages/modules/m06-sections.md",
          "context": {
            "offset": 37,
            "limit": 1,
            "anchors": [
              "h556wl8s"
            ]
          }
        },
        {
          "key": "pages/modules/m18-tags.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m18-tags.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "m18cel00",
              "m18dep00"
            ]
          }
        },
        {
          "key": "pages/modules/m18-tags.md",
          "context": {
            "offset": 4,
            "limit": 1,
            "anchors": [
              "m18dom00"
            ]
          }
        },
        {
          "key": "pages/modules/m18-tags.md",
          "context": {
            "offset": 9,
            "limit": 1,
            "anchors": [
              "91vuvf2u"
            ]
          }
        },
        {
          "key": "pages/modules/m18-tags.md",
          "context": {
            "offset": 23,
            "limit": 1,
            "anchors": [
              "m18acc00"
            ]
          }
        },
        {
          "key": "pages/modules/m14-page-links.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m14-page-links.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "m14cel01",
              "m14dep01",
              "m14dom01"
            ]
          }
        },
        {
          "key": "pages/modules/m14-page-links.md",
          "context": {
            "offset": 6,
            "limit": 1,
            "anchors": [
              "sjdtpuoo"
            ]
          }
        }
      ],
      "entities": []
    },
    "jobs": []
  },
  "portions": [
    {
      "name": "u02-multi-file-consumers/p1-domain",
      "slugs": [
        "section:m29ren001",
        "section:8n46mdrz",
        "section:h556wl8s",
        "section:91vuvf2u",
        "section:m18acc00",
        "section:sjdtpuoo"
      ]
    }
  ],
  "stateDir": ".c4s-impl/"
}
```
