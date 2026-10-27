# Scope of this run

```json
{
  "unit": {
    "id": "u02-multi-file-consumers",
    "goal": "Pięć operacji wieloplikowych przechodzi na wspólne reguły z u01: propagacja zmiany sluga encji (M29 i M19), propagacja zmiany kotwicy (M06), propagacja zmiany sluga tagu (M18) oraz przeniesienie strony z przepisaniem linków (M14). Każda z nich nadaje wierszom historii jeden identyfikator operacji i cofa zapisane pliki przy połowicznym niepowodzeniu. Usuwamy własne, lokalne rutyny rollbacku tych modułów."
  },
  "diff": "git diff edbd655e192218ab42bbe64a373b0deeb25e58f1..HEAD",
  "portions": [
    "u02-multi-file-consumers/p1-domain"
  ],
  "stateDir": ".c4s-impl/"
}
```
