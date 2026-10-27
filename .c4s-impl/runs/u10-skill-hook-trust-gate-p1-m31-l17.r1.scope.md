# Scope of this run

```json
{
  "mode": "build",
  "unit": {
    "id": "u10-skill-hook-trust-gate",
    "goal": "Podpięcie projektu-skilla zapisane w pliku konfiguracyjnym repozytorium działa dopiero po potwierdzeniu na tej maszynie. Potwierdzenie leży w rejestrze machine-local (rekord workspace'u, obok bramki zaufania pluginów), nie w repozytorium. Niepotwierdzone podpięcie nie rozwiązuje się do dostawcy i daje ostrzeżenie, tak jak podpięcie wiszące. Ta sama jednostka niesie dwie zapisane granice:\n  - podpięcie nie przypina się do wydania dostawcy, bo treść czyta się na żywo;\n  - lokalna kopia stylu nie jest scalana z upstreamem; merge trzystronny jest poza zakresem.\n\n  Specyfikacja zostawia otwarte (TODO w M52): nazwę pola potwierdzenia, miejsce i chwilę pytania oraz zakres potwierdzenia. Tych punktów nie zgaduj, tylko zgłoś je przed budową.",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m52-spec-skills.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m52-spec-skills.md",
          "context": {
            "offset": 1,
            "limit": 3,
            "anchors": [
              "q7uurue4",
              "cppnlv9z",
              "dun7u18f"
            ]
          }
        },
        {
          "key": "pages/modules/m52-spec-skills.md",
          "context": {
            "offset": 5,
            "limit": 2,
            "anchors": [
              "ybbal0vf",
              "9j9cxrsr"
            ]
          }
        },
        {
          "key": "pages/modules/m52-spec-skills.md",
          "context": {
            "offset": 9,
            "limit": 1,
            "anchors": [
              "f1nbs7qy"
            ]
          }
        },
        {
          "key": "pages/modules/m52-spec-skills.md",
          "context": {
            "offset": 21,
            "limit": 1,
            "anchors": [
              "wqvq1esb"
            ]
          }
        },
        {
          "key": "pages/modules/m31-workspace.md",
          "change": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "44viw74p"
            ]
          }
        },
        {
          "key": "pages/modules/m31-workspace.md",
          "context": {
            "offset": 4,
            "limit": 1,
            "anchors": [
              "fjsgq19h"
            ]
          }
        },
        {
          "key": "pages/modules/m31-workspace.md",
          "context": {
            "offset": 6,
            "limit": 1,
            "anchors": [
              "44viw74p"
            ]
          }
        }
      ],
      "entities": []
    },
    "jobs": []
  },
  "portion": {
    "name": "u10-skill-hook-trust-gate/p1-m31-l17",
    "layers": [
      "M31 workspace registry (Domain)",
      "M52 Domain",
      "L17 Project Settings"
    ],
    "slugs": [
      "section:ybbal0vf",
      "section:9j9cxrsr",
      "section:f1nbs7qy",
      "section:44viw74p"
    ],
    "packet": ".c4s-impl/packets/u10-skill-hook-trust-gate-p1-m31-l17.md"
  },
  "only": [],
  "stateDir": ".c4s-impl/"
}
```
