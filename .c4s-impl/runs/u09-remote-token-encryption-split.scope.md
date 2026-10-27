# Scope of this run

```json
{
  "unit": {
    "id": "u09-remote-token-encryption",
    "goal": "Token sesji konta zdalnego jest przechowywany zaszyfrowany at-rest. Szyfruje go prymityw sekretów z M05, z tym samym algorytmem i plikiem klucza co własny klucz API agenta. Odszyfrowanie odbywa się tylko po stronie serwera, tuż przed wywołaniem zdalnym. Jednorazowa migracja szyfruje wiersze zapisane wcześniej jawnym tekstem. M24 zyskuje zależność od M05.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "change": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "yuhlv2qw"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "ro5xbtxj",
              "mxjqndqv",
              "lmgy08qc"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "context": {
            "offset": 16,
            "limit": 1,
            "anchors": [
              "yuhlv2qw"
            ]
          }
        },
        {
          "key": "pages/modules/m05-agent-runtime.md",
          "context": {
            "offset": 52,
            "limit": 1,
            "anchors": [
              "agcrdinj"
            ]
          }
        },
        {
          "key": "pages/modules/m05-agent-runtime.md",
          "context": {
            "offset": 61,
            "limit": 1,
            "anchors": [
              "agcrdtbl"
            ]
          }
        }
      ],
      "entities": [
        {
          "type": "database-table",
          "slugs": [
            "remote-session"
          ]
        },
        {
          "type": "module-dependency",
          "slugs": [
            "m24-requires-m05"
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
