# Scope of this run

```json
{
  "unit": {
    "id": "u1-remove-release-push",
    "goal": "Aplikacja przestaje wypychać wydania na serwer zdalny — znika cała funkcja M25: akcja wypchnięcia na karcie wydania, odznaki „wypchnięte” i baner niezreleasowanych zmian, karta projektu zdalnego w ustawieniach (podgląd, edycja, rozłączenie), dziennik wypchnięć w bazie, trasy REST i operacje specyfikacji pushu oraz klucz powiązania z projektem zdalnym w konfiguracji. Konto zdalne (M24) zostaje, ale nie blokuje już żadnej akcji, a wylogowanie odświeża wyłącznie stan konta.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m25-release-push/m25-release-push.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m25-release-push/L1-db.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m25-release-push/L4-api.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m25-release-push/remote-api-contract.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "ro5xbtxj",
              "mxjqndqv"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "context": {
            "offset": 4,
            "limit": 3,
            "anchors": [
              "86yc873o",
              "c12buble",
              "ux690pt2"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "context": {
            "offset": 9,
            "limit": 1,
            "anchors": [
              "a21tr5i1"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "context": {
            "offset": 14,
            "limit": 1,
            "anchors": [
              "m26usec"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/m24-remote-account.md",
          "context": {
            "offset": 17,
            "limit": 1,
            "anchors": [
              "bvh6rrk4"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/L1-db.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m24-remote-account/L1-db.md",
          "context": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "g0m0pw5b"
            ]
          }
        },
        {
          "key": "pages/modules/m24-remote-account/L1-db.md",
          "context": {
            "offset": 6,
            "limit": 1,
            "anchors": [
              "jko07djm"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "change": {
            "offset": 2,
            "limit": 1,
            "anchors": [
              "kdwo08r9"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "xkpt256d",
              "m17zal001"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 9,
            "limit": 1,
            "anchors": [
              "m17errtx1"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 15,
            "limit": 1,
            "anchors": [
              "kdwo08r9"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L5-ui.md",
          "change": "all",
          "deferred": [
            {
              "what": "otwieranie okna naprawy błędu git po utworzeniu wydania, gdy błąd niesie wynik pushu",
              "to": "u4-push-on-release",
              "why": "wynik pushu w odpowiedzi tworzenia wydania powstaje dopiero w u4"
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
        },
        {
          "key": "pages/SKILL.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "xtp3yuft"
            ]
          }
        },
        {
          "key": "pages/SKILL.md",
          "context": {
            "offset": 15,
            "limit": 1,
            "anchors": [
              "a7bz3max"
            ]
          }
        }
      ],
      "entities": [
        {
          "type": "ac",
          "slugs": [
            "ac-akcja-disconnect-w-sekcji-remote-project",
            "ac-anonim-bez-sesji-konta-zdalnego-przy",
            "ac-baner-you-have-n-unreleased-changes-p",
            "ac-bundle-przekracza-remote-content-length",
            "ac-cleanup-targzpath-zwr-conego-przez-bu",
            "ac-concurrent-edit-projektu-z-innej-karty-p",
            "ac-config-name-zmienione-miedzy-pushami-n",
            "ac-config-remoteprojectid-brak-pola-lub",
            "ac-config-remoteprojectid-recznie-ustawio",
            "ac-config-remoteprojectid-znany-ale-proj",
            "ac-deduplicated-true-zwracane-przez-remo",
            "ac-first-push-config-remoteprojectid",
            "ac-first-push-gdy-projekt-o-tej-nazwie-juz",
            "ac-first-push-z-nazwa-projektu-zawierajaca",
            "ac-get-api-release-pushes-releasename-na-2",
            "ac-get-api-release-pushes-releasename-na",
            "ac-get-api-remote-project-gdy-anonim-brak",
            "ac-get-api-remote-project-gdy-config-remo",
            "ac-get-api-remote-project-gdy-peer-specka-2",
            "ac-get-api-remote-project-gdy-peer-specka",
            "ac-get-api-remote-project-gdy-remoteproje",
            "ac-get-api-remote-project-gdy-zalogowany-n-2",
            "ac-get-api-remote-project-gdy-zalogowany-n",
            "ac-get-api-remote-project-gdy-zalogowany-o-2",
            "ac-get-api-remote-project-gdy-zalogowany-o",
            "ac-get-api-remote-project-zwraca-502-sessi-2",
            "ac-get-api-remote-project-zwraca-502-sessi",
            "ac-konto-z-account-status-deactivated-po",
            "ac-lista-releases-derywuje-badge-pushed",
            "ac-logout-po-sukcesie-patch-api-remote-pro",
            "ac-logout-w-m26-sekcja-user-z-confirmmodal",
            "ac-logout-z-innego-okna-po-sukcesie-pusha",
            "ac-m25-nie-buduje-bundle-a-samodzielnie-s",
            "ac-m25-nie-eksponuje-mcp-toolu-release-pus",
            "ac-m25-nie-modyfikuje-schemy-remote-sessio",
            "ac-na-release-ie-starszym-niz-najnowszy",
            "ac-network-failure-w-polowie-pusha-insert",
            "ac-odmowa-422-invalid-body-z-uslugi-zdal",
            "ac-odmowa-edycji-projektu-zdalnego-kodem",
            "ac-owner-edytuje-pole-name-w-formularzu-rem",
            "ac-owner-wpisuje-description-przekraczajacy",
            "ac-patch-api-remote-project-gdy-peer-speck-2",
            "ac-patch-api-remote-project-gdy-peer-speck",
            "ac-patch-api-remote-project-przez-nie-owne",
            "ac-patch-api-remote-project-z-body-name",
            "ac-patch-api-remote-project-z-descripti",
            "ac-patch-api-remote-project-z-description",
            "ac-patch-api-remote-project-z-name",
            "ac-patch-api-remote-project-z-pustym-body",
            "ac-po-pierwszym-sukcesie-pushu-response-z",
            "ac-po-udanym-pull-in-unreleased-changes",
            "ac-post-api-release-pushes-z-nazwa-curre",
            "ac-post-api-release-pushes-z-nazwa-nieis",
            "ac-post-api-release-pushes-z-releasename",
            "ac-push-blocked-gdy-accountstatus-act",
            "ac-push-blocked-gdy-remoteauthservice-getc",
            "ac-push-frozen-release-u-release-id-max",
            "ac-race-dwoch-kart-przegladarki-pushujacych",
            "ac-release-push-content-sha256-release",
            "ac-response-z-deduplicated-true-peer-sp",
            "ac-sekcja-remote-project-gdy-anonim-brak-r",
            "ac-sekcja-remote-project-gdy-projekt-usunie",
            "ac-sekcja-remote-project-w-settings-dla-sc",
            "ac-sekcja-remote-project-w-settings-pokazu",
            "ac-sekcja-remote-project-z-config-remotepr",
            "ac-sha-256-mismatch-po-stronie-remote-422",
            "ac-subsequent-push-gdy-config-remoteproje",
            "ac-tabela-release-push-ma-insert-per-zako",
            "ac-token-zrewokowany-w-trakcie-pusha-strea",
            "ac-ui-badge-pushed-widoczny-na-wierszu-re",
            "ac-ui-banner-you-have-n-unreleased-changes",
            "ac-ui-przycisk-push-to-remote-zarejestrow",
            "ac-warto-wys-ana-w-header-x-content-sha2",
            "ac-wiersz-release-push-powsta-y-z-first-p",
            "ac-wylogowanie-konta-zdalnego-w-trakcie"
          ]
        },
        {
          "type": "endpoint",
          "slugs": [
            "post-api-release-pushes",
            "get-api-release-pushes",
            "get-api-release-pushes-id",
            "get-api-remote-project",
            "patch-api-remote-project",
            "get-api-remote-account"
          ]
        },
        {
          "type": "dto",
          "slugs": [
            "release-push-request",
            "release-push-response",
            "release-push-list-response",
            "remote-project-info",
            "update-remote-project-request",
            "remote-account-response",
            "app-config-response",
            "patch-config-request"
          ],
          "deferred": [
            {
              "what": "zmiana nazwy przełącznika pushu w obiekcie konfiguracji git (app-config-response, patch-config-request)",
              "to": "u4-push-on-release",
              "why": "należy do nowego modelu pushu przy wydaniu"
            }
          ]
        },
        {
          "type": "database-table",
          "slugs": [
            "release-push",
            "remote-session"
          ]
        },
        {
          "type": "spec-operation",
          "slugs": [
            "push-release",
            "list-release-pushes",
            "get-release-push"
          ]
        },
        {
          "type": "module-dependency",
          "slugs": [
            "m25-requires-m01",
            "m25-requires-m17",
            "m25-requires-m24",
            "m25-requires-m28",
            "m25-requires-m31"
          ]
        },
        {
          "type": "code-snippet",
          "slugs": [
            "config-json-shape"
          ]
        },
        {
          "type": "spreadsheet",
          "slugs": [
            "sub-drzewo-m25"
          ]
        },
        {
          "type": "ui-view",
          "slugs": [
            "release-detail"
          ]
        }
      ]
    },
    "jobs": []
  },
  "portions": [
    {
      "name": "u1-remove-release-push/p1-l1-l3",
      "layers": [
        "L1",
        "L2",
        "L3"
      ],
      "slugs": [
        "m25-requires-m01",
        "m25-requires-m17",
        "m25-requires-m24",
        "m25-requires-m28",
        "m25-requires-m31",
        "release-push",
        "remote-session",
        "ac-deduplicated-true-zwracane-przez-remo",
        "ac-m25-nie-modyfikuje-schemy-remote-sessio",
        "ac-release-push-content-sha256-release",
        "ac-tabela-release-push-ma-insert-per-zako",
        "ac-cleanup-targzpath-zwr-conego-przez-bu",
        "ac-first-push-z-nazwa-projektu-zawierajaca",
        "ac-m25-nie-buduje-bundle-a-samodzielnie-s",
        "ac-response-z-deduplicated-true-peer-sp",
        "get-release-push",
        "list-release-pushes",
        "push-release",
        "ac-m25-nie-eksponuje-mcp-toolu-release-pus"
      ]
    },
    {
      "name": "u1-remove-release-push/p2-l4",
      "layers": [
        "L4"
      ],
      "slugs": [
        "get-api-release-pushes-id",
        "get-api-release-pushes",
        "get-api-remote-account",
        "get-api-remote-project",
        "patch-api-remote-project",
        "post-api-release-pushes",
        "app-config-response",
        "patch-config-request",
        "release-push-list-response",
        "release-push-request",
        "release-push-response",
        "remote-account-response",
        "remote-project-info",
        "update-remote-project-request",
        "ac-bundle-przekracza-remote-content-length",
        "ac-concurrent-edit-projektu-z-innej-karty-p",
        "ac-config-name-zmienione-miedzy-pushami-n",
        "ac-config-remoteprojectid-znany-ale-proj",
        "ac-first-push-gdy-projekt-o-tej-nazwie-juz",
        "ac-get-api-release-pushes-releasename-na-2",
        "ac-get-api-release-pushes-releasename-na",
        "ac-get-api-remote-project-gdy-anonim-brak",
        "ac-get-api-remote-project-gdy-config-remo",
        "ac-get-api-remote-project-gdy-peer-specka-2",
        "ac-get-api-remote-project-gdy-peer-specka",
        "ac-get-api-remote-project-gdy-remoteproje",
        "ac-get-api-remote-project-gdy-zalogowany-n-2",
        "ac-get-api-remote-project-gdy-zalogowany-n",
        "ac-get-api-remote-project-gdy-zalogowany-o-2",
        "ac-get-api-remote-project-gdy-zalogowany-o",
        "ac-get-api-remote-project-zwraca-502-sessi-2",
        "ac-get-api-remote-project-zwraca-502-sessi",
        "ac-konto-z-account-status-deactivated-po",
        "ac-lista-releases-derywuje-badge-pushed",
        "ac-logout-po-sukcesie-patch-api-remote-pro",
        "ac-logout-z-innego-okna-po-sukcesie-pusha",
        "ac-network-failure-w-polowie-pusha-insert",
        "ac-owner-edytuje-pole-name-w-formularzu-rem",
        "ac-owner-wpisuje-description-przekraczajacy",
        "ac-patch-api-remote-project-gdy-peer-speck-2",
        "ac-patch-api-remote-project-gdy-peer-speck",
        "ac-patch-api-remote-project-przez-nie-owne",
        "ac-patch-api-remote-project-z-body-name",
        "ac-patch-api-remote-project-z-descripti",
        "ac-patch-api-remote-project-z-description",
        "ac-patch-api-remote-project-z-name",
        "ac-patch-api-remote-project-z-pustym-body",
        "ac-po-pierwszym-sukcesie-pushu-response-z",
        "ac-post-api-release-pushes-z-nazwa-curre",
        "ac-post-api-release-pushes-z-nazwa-nieis",
        "ac-post-api-release-pushes-z-releasename",
        "ac-push-blocked-gdy-accountstatus-act",
        "ac-push-blocked-gdy-remoteauthservice-getc",
        "ac-push-frozen-release-u-release-id-max",
        "ac-race-dwoch-kart-przegladarki-pushujacych",
        "ac-sekcja-remote-project-gdy-anonim-brak-r",
        "ac-sekcja-remote-project-w-settings-dla-sc",
        "ac-sekcja-remote-project-w-settings-pokazu",
        "ac-sha-256-mismatch-po-stronie-remote-422",
        "ac-subsequent-push-gdy-config-remoteproje",
        "ac-token-zrewokowany-w-trakcie-pusha-strea",
        "ac-warto-wys-ana-w-header-x-content-sha2",
        "ac-wiersz-release-push-powsta-y-z-first-p"
      ]
    },
    {
      "name": "u1-remove-release-push/p3-l5-l18",
      "layers": [
        "L5",
        "L10",
        "L17",
        "L18"
      ],
      "slugs": [
        "release-detail",
        "ac-akcja-disconnect-w-sekcji-remote-project",
        "ac-anonim-bez-sesji-konta-zdalnego-przy",
        "ac-baner-you-have-n-unreleased-changes-p",
        "ac-logout-w-m26-sekcja-user-z-confirmmodal",
        "ac-na-release-ie-starszym-niz-najnowszy",
        "ac-odmowa-422-invalid-body-z-uslugi-zdal",
        "ac-odmowa-edycji-projektu-zdalnego-kodem",
        "ac-po-udanym-pull-in-unreleased-changes",
        "ac-sekcja-remote-project-gdy-projekt-usunie",
        "ac-sekcja-remote-project-z-config-remotepr",
        "ac-ui-badge-pushed-widoczny-na-wierszu-re",
        "ac-ui-banner-you-have-n-unreleased-changes",
        "ac-ui-przycisk-push-to-remote-zarejestrow",
        "ac-wylogowanie-konta-zdalnego-w-trakcie",
        "config-json-shape",
        "ac-config-remoteprojectid-brak-pola-lub",
        "ac-config-remoteprojectid-recznie-ustawio",
        "ac-first-push-config-remoteprojectid",
        "sub-drzewo-m25"
      ]
    }
  ],
  "app": null,
  "stateDir": ".c4s-impl/"
}
```
