# Scope of this run

```json
{
  "unit": {
    "id": "u10-skill-hook-trust-gate",
    "goal": "Podpięcie projektu-skilla zapisane w pliku konfiguracyjnym repozytorium działa dopiero po potwierdzeniu na tej maszynie. Potwierdzenie leży w rejestrze machine-local (rekord workspace'u, obok bramki zaufania pluginów), nie w repozytorium. Niepotwierdzone podpięcie nie rozwiązuje się do dostawcy i daje ostrzeżenie, tak jak podpięcie wiszące. Ta sama jednostka niesie dwie zapisane granice:\n  - podpięcie nie przypina się do wydania dostawcy, bo treść czyta się na żywo;\n  - lokalna kopia stylu nie jest scalana z upstreamem; merge trzystronny jest poza zakresem.\n\n  Specyfikacja zostawia otwarte (TODO w M52): nazwę pola potwierdzenia, miejsce i chwilę pytania oraz zakres potwierdzenia. Tych punktów nie zgaduj, tylko zgłoś je przed budową."
  },
  "diff": "git diff fcc802ddaa43f20b1c3a40c7662b3f68044d4eca..HEAD",
  "portions": [
    "u10-skill-hook-trust-gate/p1-m31-l17"
  ],
  "stateDir": ".c4s-impl/"
}
```
