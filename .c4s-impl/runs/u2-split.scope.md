# Scope of this run

```json
{
  "unit": {
    "id": "u2-remove-project-clone",
    "goal": "Znika klonowanie projektu przy starcie (M27): flaga CLI klonowania (także z listy flag implikujących tworzenie projektu), krok przekazania sterowania do klonu w aktywacji projektu M01 (kolejne kroki przesuwają się o jeden, krok strony powitalnej nie ma już wyjątku dla klonu), uzasadnienie budowy projektu przed nasłuchem oparte na klonie, tabela dziennika importów oraz raport „utworzony czy znaleziony” bloku zarządzanego w `.gitignore` (M28), którego jedynym konsumentem był rollback klonu.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m27-project-clone/m27-project-clone.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m27-project-clone/L1-db.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m01-project.md",
          "change": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "dsh8ezbz",
              "r7ozfsa9"
            ]
          }
        },
        {
          "key": "pages/modules/m01-project.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "85hp4f2v",
              "cri3lyli"
            ]
          }
        },
        {
          "key": "pages/modules/m01-project.md",
          "context": {
            "offset": 14,
            "limit": 1,
            "anchors": [
              "dsh8ezbz"
            ]
          }
        },
        {
          "key": "pages/modules/m01-project.md",
          "context": {
            "offset": 16,
            "limit": 1,
            "anchors": [
              "r7ozfsa9"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "change": {
            "offset": 6,
            "limit": 1,
            "anchors": [
              "2qwi21mw"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "incf3qhp"
            ]
          }
        },
        {
          "key": "pages/modules/m28-git-sync.md",
          "context": {
            "offset": 19,
            "limit": 1,
            "anchors": [
              "2qwi21mw"
            ]
          }
        },
        {
          "key": "pages/SKILL.md",
          "change": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "7lfiuvuu"
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
            "ac-b-d-po-czenia-pobierania-z-remote-h",
            "ac-brak-l4-api-release-imports-w-v1",
            "ac-brak-mcp-toolu-project-clone-releas",
            "ac-clone-draft-slug-lub-nieistniej-cy",
            "ac-clone-restore-odtwarza-wszystkie-releasa",
            "ac-clone-slug-nie-trafia-do-config-j",
            "ac-clone-slug-razem-z-name-s",
            "ac-clone-slug-razem-z-port-p",
            "ac-clone-slug-w-niepustym-cwd-clon",
            "ac-dla-anon-clone-v1-kolumny-imported-by-a",
            "ac-encja-release-import-istnieje-jako-da",
            "ac-ka-dy-fail-w-krokach-2-9-algorytmu-clone",
            "ac-lokalny-release-1-powstaje-przez-creat",
            "ac-migracja-sprzed-m29-entitiesdir-istn",
            "ac-na-cie-ce-error-clone-a-nie-powstaje-tr",
            "ac-npx-claude4spec-clone-slug-projekt",
            "ac-npx-claude4spec-clone-slug-remote",
            "ac-npx-inharness-ai-claude4spec-create",
            "ac-po-clone-kolejny-release-push-m25-id",
            "ac-projekt-published-bez-adnego-release-u",
            "ac-retry-clone-slug-po-wczesniejszym",
            "ac-sha-256-streamowanych-bajt-w-bundla-r-n",
            "ac-snapshot-serwowany-z-content-type-appl",
            "ac-start-z-create-project-lub-flaga-impl",
            "ac-swiezy-bootstrap-onboardingcompleted",
            "ac-wiersz-release-import-po-udanym-clone"
          ]
        },
        {
          "type": "database-table",
          "slugs": [
            "release-import"
          ]
        },
        {
          "type": "module-dependency",
          "slugs": [
            "m27-requires-m01",
            "m27-requires-m17",
            "m27-requires-m29",
            "m27-requires-m31",
            "m27-requires-m41"
          ]
        },
        {
          "type": "spreadsheet",
          "slugs": [
            "flagi-cli-m01",
            "sub-drzewo-m27"
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
