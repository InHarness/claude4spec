# Scope of this run

```json
{
  "unit": {
    "id": "u11-consistency-junction",
    "goal": "Reguła spójności „encje bez odwołań” czyta raz na przebieg junction powiązań endpoint↔DTO, więc DTO podpięte strukturalnie do endpointu liczy się jako użyte i znika z ostrzeżeń. To jedyny drugi odczyt obok przejścia po stronach. Trawers wyszukiwania referencji się nie zmienia."
  },
  "diff": "git diff 6bded41faceae02fccb4af854f78d82ffe23bcf6..HEAD",
  "portions": [
    "u11-consistency-junction/p1-domain"
  ],
  "stateDir": ".c4s-impl/"
}
```
