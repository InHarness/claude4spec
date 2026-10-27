# Scope of this run

```json
{
  "unit": {
    "id": "u01-multi-file-primitive",
    "goal": "Historia wersji plików dostaje opcjonalny identyfikator operacji wieloplikowej (kolumna z indeksem). Prymityw zapisu rekordu (M42) daje wywołującym dwie wspólne reguły. Po pierwsze, wszystkie wiersze historii jednej operacji, także wiersze rollbacku, dzielą ten identyfikator. Po drugie, gdy zapis któregoś pliku zawiedzie, operacja przywraca już zapisane pliki dalszymi zapisami prymitywu (best-effort, to nie transakcja) i zwraca błąd. Znika zapis „atomowości między plikami nie ma i ta runda jej nie wprowadza”."
  },
  "diff": "git diff 4b4a56c0f6ba84df01fd1c3377612aeac641181d..HEAD",
  "portions": [
    "u01-multi-file-primitive/p1-l1-l7"
  ],
  "stateDir": ".c4s-impl/"
}
```
