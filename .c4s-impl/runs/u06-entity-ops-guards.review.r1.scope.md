# Scope of this run

```json
{
  "unit": {
    "id": "u06-entity-ops-guards",
    "goal": "Dwie operacje na encjach dostają nowe zachowanie:\n  - **Mutacja:** każda pozycja paczki może nieść numer wersji encji, na którym oparto zmianę. Przy innym bieżącym numerze pozycja kończy się `VERSION_CONFLICT` bez zapisu, a reszta paczki idzie dalej. Sprawdzenie i zapis leżą w jednej sekcji krytycznej prymitywu. Pozycja bez numeru zapisuje bez sprawdzenia.\n  - **Tworzenie:** jawnie podany, zajęty slug daje `SLUG_CONFLICT`. Kolizja sluga wyprowadzonego ze wzorca idzie według polityki typu z u04. Odmowa jednej pozycji nie cofa pozostałych.\n\n  Obie operacje tracą kanał CLI, bo generyczne komendy encji `c4s` są wyłącznie odczytem. Ich powiązanie z trasami REST wskazuje generyczne trasy hosta."
  },
  "diff": "git diff 5525bb8b86546864d7770eb6a88d9f6e851e84b4..HEAD",
  "portions": [
    "u06-entity-ops-guards/p1-l2-l3"
  ],
  "stateDir": ".c4s-impl/"
}
```
