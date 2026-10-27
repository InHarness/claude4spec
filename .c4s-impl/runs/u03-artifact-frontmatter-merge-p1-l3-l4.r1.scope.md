# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u03-artifact-frontmatter-merge",
    "goal": "Zapis frontmattera artefaktu (plan, brief, patch) scala tylko przesłane klucze z bieżącym frontmatterem pliku. Odczyt i zapis są jedną sekcją krytyczną pod blokadą per ścieżka. Guard hasha w tym zapisie nie istnieje. Równoległy zapis treści albo drugi zapis frontmattera nie gubi zmian. W kodzie trzeba dołączyć do blokady zapis frontmattera patcha, bo plan i brief już ją biorą. Zapis treści planu z edytora świadomie nie niesie podsumowania zmiany: wersję użytkownika odróżnia autor `user` na osi wersji pliku.\n\nUwaga z briefu (endpoint patch-api-artifacts-kind-path-frontmatter): snapshot `after` tego endpointu ma pustą listę podpiętych DTO, choć okno zmieniło tylko opisy. Nie zdejmuj na tej podstawie wiązania request/response, zanim nie sprawdzisz go w odczycie stanu przy `2.1.57`.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m36-chat-artifacts/m36-chat-artifacts.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m36-chat-artifacts/m36-chat-artifacts.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "m36cel01",
              "m36dep01",
              "m36reg01"
            ]
          }
        },
        {
          "key": "pages/modules/m36-chat-artifacts/m36-chat-artifacts.md",
          "context": {
            "offset": 8,
            "limit": 1,
            "anchors": [
              "m36l4fam"
            ]
          }
        },
        {
          "key": "pages/modules/m36-chat-artifacts/m36-chat-artifacts.md",
          "context": {
            "offset": 12,
            "limit": 1,
            "anchors": [
              "m36rest1"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "change": {
            "offset": 0,
            "limit": 2,
            "anchors": [
              "m23mcp01",
              "m23edg01"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "m23cel01",
              "m23dep01"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "context": {
            "offset": 6,
            "limit": 1,
            "anchors": [
              "m23fmt01"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "context": {
            "offset": 13,
            "limit": 1,
            "anchors": [
              "m23mcp01"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "context": {
            "offset": 29,
            "limit": 1,
            "anchors": [
              "m23edg01"
            ]
          }
        },
        {
          "key": "pages/modules/m10-plans.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m10-plans.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "m10cel00",
              "m10dep00",
              "m10dom00"
            ]
          }
        },
        {
          "key": "pages/modules/m10-plans.md",
          "context": {
            "offset": 7,
            "limit": 1,
            "anchors": [
              "bctqi8sw"
            ]
          }
        }
      ],
      "entities": [
        {
          "type": "dto",
          "slugs": [
            "artifact-frontmatter-update-request"
          ]
        },
        {
          "type": "endpoint",
          "slugs": [
            "patch-api-artifacts-kind-path-frontmatter"
          ]
        }
      ]
    },
    "jobs": []
  },
  "portion": {
    "name": "u03-artifact-frontmatter-merge/p1-l3-l4",
    "layers": [
      "L3",
      "L4"
    ],
    "slugs": [
      "artifact-frontmatter-update-request",
      "patch-api-artifacts-kind-path-frontmatter",
      "m36l4fam",
      "m23mcp01",
      "m23edg01",
      "bctqi8sw",
      "ac-artefakt-rozbieznosci-bez-zadeklarowa",
      "ac-c4s-mark-brief-implemented-brief-path",
      "ac-frontmatter-planu-ma-pole-applied-boo",
      "ac-get-patch-z-range-poza-koncem-pliku-w",
      "ac-header-plans-slug-niesie-badge-applie",
      "ac-jedynym-mutable-polem-frontmatteru-br",
      "ac-mark-patch-applied-z-applied-false-je",
      "ac-patch-api-artifacts-plan-path-frontma",
      "ac-patch-dluzszy-niz-budzet-odpowiedzi-w",
      "ac-patch-legacy-ze-status-completed-i-be",
      "ac-patch-przekraczajacy-budzet-wolany-be",
      "ac-po-autozapisie-patcha-dluzszego-niz-b",
      "ac-settings-popover-na-patches-path-zawi",
      "ac-ustawienie-implemented-true-przez-c4s",
      "ac-watek-patch-ktory-stwierdza-ze-patch"
    ],
    "packet": ".c4s-impl/packets/u03-artifact-frontmatter-merge-p1-l3-l4.md"
  },
  "only": [],
  "stateDir": ".c4s-impl/"
}
```
