# Scope of this run

```json
{
  "unit": {
    "id": "u04-plugin-registration-contract",
    "goal": "Kontrakt rejestracji pluginu (M13, M33) zmienia się w czterech punktach:\n  - Tożsamość typu dostaje opcjonalną politykę kolizji sluga wyprowadzonego ze wzorca: domyślnie odmowa, opcjonalnie sufiks. Każdy typ, który dziś dokleja sufiks, deklaruje to w tej samej rundzie.\n  - Duplikat nazwy narzędzia w jednym serwerze albo duplikat nazwy serwera w puli jest odrzucany przy ładowaniu kodem `PLUGIN_TOOL_CONFLICT` (na wzór `PLUGIN_TYPE_CONFLICT`). Znika ciche nadpisywanie fabryki serwera i ciche pomijanie całego serwera na turę.\n  - Ciche last-wins w warstwie bazowej rejestru dostaje termin: trwa do wydzielenia ostatniego typu wbudowanego (`ac`, `diagram`). Teraz nie zmienia się nic w kodzie.\n  - Kontrakt nie ma generycznego helpera tras CRUD: CRUD REST generuje host. Router pluginu niesie wyłącznie trasy domenowe, a typ bez nich routera nie deklaruje.\n\n  `HOST_API_VERSION` zostaje bez bumpu. Wpis changelogu Host API dla tej wersji traci pozycję o polu postaci rejestracji znacznika XML, bo kształt rejestracji znacznika wypada z wersjonowanej powierzchni (M51)."
  },
  "diff": "git diff 18c09d4e7f10ab8cf4eaddccc26b398e5141d273..HEAD",
  "portions": [
    "u04-plugin-registration-contract/p1-l2-a",
    "u04-plugin-registration-contract/p2-l2-l11"
  ],
  "stateDir": ".c4s-impl/"
}
```
