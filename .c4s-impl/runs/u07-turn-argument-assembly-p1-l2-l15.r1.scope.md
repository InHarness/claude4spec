# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u07-turn-argument-assembly",
    "goal": "Właścicielem argumentu wywołania adaptera jest handler tury rejestru typów kontekstu (M44). Składa go w trzech krokach:\n  1. **Pula od hosta.** Pula z budowania serwerów obejmuje: serwer encji, serwery custom oraz hostowe serwery referencji i wydań, rejestrowane w puli jak serwer pluginu. Składanie puli nie zna typu kontekstu.\n  2. **Serwery handlera.** Handler dokleja własne serwery według typu kontekstu. Serwer projektów workspace'u dochodzi do wszystkich czterech typów. Brief bierze z puli tylko serwer wydań. Wątek patcha dostaje zestaw czatu bez transagenta, plus narzędzia patcha. Przy kolizji nazwy wygrywa wpis handlera.\n  3. **Bramka profilu.** Bramka profilu typu kontekstu filtruje narzędzia według klas operacji i zrzuca serwery bez narzędzi. Dzięki temu `ask` staje się read-only przez egzekwowanie, a nie tylko przez prompt.\n\n  Blok inwentarza narzędzi w prompcie zyskuje zastrzeżenie, że ogłoszona nazwa może jeszcze nie mieć załadowanego schematu (odroczone ładowanie po stronie SDK). Kod składania tego nie zmienia.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m44-context-types.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m44-context-types.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "x91ni6uh",
              "uovohiu4",
              "kegqwiy9"
            ]
          }
        },
        {
          "key": "pages/modules/m44-context-types.md",
          "context": {
            "offset": 7,
            "limit": 2,
            "anchors": [
              "317cwhlj",
              "3f5ej79s"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-domain.md",
          "change": {
            "offset": 2,
            "limit": 1,
            "anchors": [
              "mbladez6"
            ]
          }
        },
        {
          "key": "pages/modules/m13-entity-framework/L2-domain.md",
          "context": {
            "offset": 8,
            "limit": 1,
            "anchors": [
              "mbladez6"
            ]
          }
        },
        {
          "key": "pages/modules/m11-c4s/m11-c4s.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m11-c4s/m11-c4s.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "m11cel00",
              "m11dep00"
            ]
          }
        },
        {
          "key": "pages/modules/m11-c4s/m11-c4s.md",
          "context": {
            "offset": 10,
            "limit": 1,
            "anchors": [
              "m11askrul"
            ]
          }
        },
        {
          "key": "pages/modules/m11-c4s/m11-c4s.md",
          "context": {
            "offset": 37,
            "limit": 1,
            "anchors": [
              "6exnmup9"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "change": {
            "offset": 2,
            "limit": 1,
            "anchors": [
              "m23akc01"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "context": {
            "offset": 22,
            "limit": 1,
            "anchors": [
              "jbcb06l2"
            ]
          }
        },
        {
          "key": "pages/modules/m23-patches.md",
          "context": {
            "offset": 30,
            "limit": 1,
            "anchors": [
              "m23akc01"
            ]
          }
        },
        {
          "key": "pages/modules/m48-system-prompt-composition.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m48-system-prompt-composition.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "xdnw931t",
              "603o6bq9",
              "kg2e0kqr"
            ]
          }
        },
        {
          "key": "pages/modules/m48-system-prompt-composition.md",
          "context": {
            "offset": 8,
            "limit": 1,
            "anchors": [
              "kaasgyj8"
            ]
          }
        },
        {
          "key": "pages/external/inharness-packages.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "55dy5doq"
            ]
          }
        },
        {
          "key": "pages/external/inharness-packages.md",
          "context": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "inhrnp01"
            ]
          }
        },
        {
          "key": "pages/external/inharness-packages.md",
          "context": {
            "offset": 9,
            "limit": 2,
            "anchors": [
              "inhrepar",
              "55dy5doq"
            ]
          }
        }
      ],
      "entities": []
    },
    "jobs": []
  },
  "portion": {
    "name": "u07-turn-argument-assembly/p1-l2-l15",
    "layers": [
      "L2",
      "M44 Domain",
      "M48 Domain",
      "L15"
    ],
    "slugs": [
      "section:317cwhlj",
      "section:kegqwiy9",
      "section:3f5ej79s",
      "section:mbladez6",
      "section:6exnmup9",
      "section:m23akc01",
      "section:kaasgyj8",
      "section:55dy5doq",
      "ac-mcp-ask-peer-w-posture-plan-mode-c",
      "ac-mcp-server-c4s-tools-jest-whitelistowa",
      "ac-prompt-nie-niesie-osobnego-bloku-inst",
      "ac-serwer-skill-tools-jest-zamontowany-w",
      "ac-serwer-spec-skill-tools-jest-zamontow",
      "ac-watek-context-type-ask-nie-ma-zamonto",
      "ac-watek-context-type-brief-ma-zamontowa",
      "ac-watek-context-type-brief-nie-ma-zamon",
      "ac-watek-context-type-brief-niesie-posta",
      "ac-watek-context-type-chat-ma-zamontowan",
      "ac-watek-context-type-chat-z-parent-thre",
      "ac-watek-context-type-patch-ma-zamontowa",
      "ac-watek-context-type-patch-ma-zamontowa-2",
      "ac-watek-context-type-patch-nie-ma-zamon",
      "ac-watek-dziecko-w-typie-ktorego-wiersz",
      "ac-watki-context-type-chat-brief-ask-nie",
      "ac-wywolanie-narzedzia-spoza-whitelisty",
      "ac-wywolanie-runtransagent-w-watku-conte"
    ],
    "packet": ".c4s-impl/packets/u07-turn-argument-assembly-p1-l2-l15.md"
  },
  "only": [],
  "stateDir": ".c4s-impl/"
}
```
