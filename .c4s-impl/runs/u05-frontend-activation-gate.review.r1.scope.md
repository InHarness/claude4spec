# Scope of this run

```json
{
  "unit": {
    "id": "u05-frontend-activation-gate",
    "goal": "Lista typów aktywnych projektu (z konfiguracji encji) jest jedną bramką aktywacji dla backendu i frontendu:\n  - Frontend dostaje listę typów aktywnych, a montowanie frontendu montuje tylko moduły tych typów.\n  - Manifest frontendu projektu ogłasza plugin wnoszący typy encji tylko wtedy, gdy co najmniej jeden z jego typów jest aktywny.\n  - Plugin bez typów encji nie podlega filtrowi.\n  - Kontrakt widziany przez plugin się nie zmienia."
  },
  "diff": "git diff 9ae39a2cade116a8b1497a7c1bb2fc48aee73939..HEAD",
  "portions": [
    "u05-frontend-activation-gate/p1-l2-l11"
  ],
  "stateDir": ".c4s-impl/"
}
```
