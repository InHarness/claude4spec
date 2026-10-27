# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u4-push-on-release",
    "goal": "Push do zdalnego repozytorium gita staje się krokiem tworzenia wydania, a nie akcją wypchnięcia wydania: po commicie wydania o statusie „committed” M17 — już poza blokadą commita — woła best-effort push gałęzi, na którą trafił commit (gałąź utworzona w tym przebiegu dostaje upstream), a wynik zwraca w nowym polu odpowiedzi tworzenia wydania, osobnym od wyniku commita; błąd pushu nie psuje wydania i otwiera okno naprawy na stronie wydania. Przełącznik pushu w konfiguracji git dostaje nową nazwę, bez migracji dawnej wartości. Usunięte: dawne wejście pushu M28 (z rozwiązywaniem gałęzi przez HEAD i regułą detached HEAD) — przyjęcie cienia i edycja wydania nie wypychają.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m28-git-sync.md",
          "change": {
            "offset": 0,
            "limit": 5,
            "anchors": [
              "incf3qhp",
              "dj6r1sam",
              "eu1rffp6",
              "43k2laa1",
              "pbpp4cxm"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "change": {
            "offset": 7,
            "limit": 10,
            "anchors": [
              "sw1u84nn",
              "ezudoqef",
              "rhj0h9rl",
              "8i5qf0xx",
              "u5vl07ch",
              "qdgstq7n",
              "m28l13rt",
              "vlxf9jw8",
              "4cp5vqa6",
              "fxcropku"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "incf3qhp",
              "dj6r1sam",
              "snn15dck"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 5,
            "limit": 1,
            "anchors": [
              "43k2laa1"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 7,
            "limit": 2,
            "anchors": [
              "aqys9dje",
              "pbpp4cxm"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 21,
            "limit": 1,
            "anchors": [
              "sw1u84nn"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 26,
            "limit": 1,
            "anchors": [
              "ezudoqef"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 39,
            "limit": 1,
            "anchors": [
              "rhj0h9rl"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 41,
            "limit": 2,
            "anchors": [
              "8i5qf0xx",
              "u5vl07ch"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 47,
            "limit": 3,
            "anchors": [
              "vlxf9jw8",
              "4cp5vqa6",
              "fxcropku"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "change": {
            "offset": 4,
            "limit": 2,
            "anchors": [
              "w6cocvik",
              "18dkumzo"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "context": {
            "offset": 13,
            "limit": 1,
            "anchors": [
              "hybasevj"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "context": {
            "offset": 18,
            "limit": 1,
            "anchors": [
              "tl7cqrzg"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "context": {
            "offset": 21,
            "limit": 5,
            "anchors": [
              "aybs7x89",
              "w6cocvik",
              "18dkumzo",
              "trr01evi",
              "wh8x023p"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L5-ui.md",
          "change": "all",
          "completes": [
            {
              "what": "otwieranie okna naprawy błędu git po utworzeniu wydania, gdy błąd niesie wynik pushu",
              "from": "u1-remove-release-push"
            }
          ]
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L5-ui.md",
          "context": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "m17ui001"
            ]
          }
        }
      ],
      "entities": [
        {
          "type": "ac",
          "slugs": [
            "ac-b-d-operacji-git-brak-gita-w-path-bra",
            "ac-config-git-enabled-default-false-nadrz",
            "ac-gdy-config-ma-synccommitonrelease-true-l",
            "ac-gdy-gitsync-status-error-operacje",
            "ac-gitservice-push-branch-pushuje-branch",
            "ac-konflikt-odrzucenie-push-przez-remote",
            "ac-patch-pojedynczego-pola-git-w-tym-zagni",
            "ac-przy-config-git-enabled-false-creater",
            "ac-przy-config-git-syncpushonpush-false",
            "ac-przy-detached-head-pushonpush-zwraca",
            "ac-przy-gitsync-status-innym-niz-committ",
            "ac-przy-w-czonym-config-git-syncpushonpush",
            "ac-przyjecie-cienia-nie-wypycha-odpowied",
            "ac-push-bez-upstream-przy-bledzie-sie",
            "ac-push-po-commicie-wydania-na-branch-ut",
            "ac-push-wydania-odrzucony-przez-remote-j",
            "ac-response-createrelease-oraz-release-push",
            "ac-sekcja-git-w-m26-ma-nadrzedny-master-che",
            "ac-updaterelease-z-assignunreleased-nie",
            "ac-wariant-error-gitcommitresult-gitpushres",
            "ac-wariant-error-gitpushresult-niesie-w",
            "ac-wynik-gitsync-inny-niz-status-error-c"
          ]
        },
        {
          "type": "code-snippet",
          "slugs": [
            "git-service-contract"
          ]
        },
        {
          "type": "dto",
          "slugs": [
            "release",
            "app-config-response",
            "patch-config-request"
          ],
          "completes": [
            {
              "what": "zmiana nazwy przełącznika pushu w obiekcie konfiguracji git",
              "from": "u1-remove-release-push"
            }
          ]
        },
        {
          "type": "endpoint",
          "slugs": [
            "get-api-git-status",
            "get-api-git-branches"
          ]
        },
        {
          "type": "module-dependency",
          "slugs": [
            "m17-requires-m28"
          ]
        }
      ]
    },
    "jobs": []
  },
  "portion": {
    "name": "u4-push-on-release/p2-l5-l17",
    "layers": [
      "L5",
      "L10",
      "L13",
      "L17"
    ],
    "slugs": [
      "ac-b-d-operacji-git-brak-gita-w-path-bra",
      "ac-gdy-gitsync-status-error-operacje",
      "ac-wynik-gitsync-inny-niz-status-error-c",
      "ac-gdy-config-ma-synccommitonrelease-true-l",
      "ac-sekcja-git-w-m26-ma-nadrzedny-master-che"
    ],
    "packet": ".c4s-impl/packets/u4-push-on-release-p2-l5-l17.md"
  },
  "only": [],
  "stateDir": ".c4s-impl/"
}
```
