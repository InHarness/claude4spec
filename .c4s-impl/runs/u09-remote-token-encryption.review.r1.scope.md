# Scope of this run

```json
{
  "unit": {
    "id": "u09-remote-token-encryption",
    "goal": "Token sesji konta zdalnego jest przechowywany zaszyfrowany at-rest. Szyfruje go prymityw sekretów z M05, z tym samym algorytmem i plikiem klucza co własny klucz API agenta. Odszyfrowanie odbywa się tylko po stronie serwera, tuż przed wywołaniem zdalnym. Jednorazowa migracja szyfruje wiersze zapisane wcześniej jawnym tekstem. M24 zyskuje zależność od M05."
  },
  "diff": "git diff 101934147508392198a229e818e29b953e64b8c3..HEAD",
  "portions": [
    "u09-remote-token-encryption/p1-l1-l1"
  ],
  "stateDir": ".c4s-impl/"
}
```
