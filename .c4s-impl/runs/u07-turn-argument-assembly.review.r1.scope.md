# Scope of this run

```json
{
  "unit": {
    "id": "u07-turn-argument-assembly",
    "goal": "Właścicielem argumentu wywołania adaptera jest handler tury rejestru typów kontekstu (M44). Składa go w trzech krokach:\n  1. **Pula od hosta.** Pula z budowania serwerów obejmuje: serwer encji, serwery custom oraz hostowe serwery referencji i wydań, rejestrowane w puli jak serwer pluginu. Składanie puli nie zna typu kontekstu.\n  2. **Serwery handlera.** Handler dokleja własne serwery według typu kontekstu. Serwer projektów workspace'u dochodzi do wszystkich czterech typów. Brief bierze z puli tylko serwer wydań. Wątek patcha dostaje zestaw czatu bez transagenta, plus narzędzia patcha. Przy kolizji nazwy wygrywa wpis handlera.\n  3. **Bramka profilu.** Bramka profilu typu kontekstu filtruje narzędzia według klas operacji i zrzuca serwery bez narzędzi. Dzięki temu `ask` staje się read-only przez egzekwowanie, a nie tylko przez prompt.\n\n  Blok inwentarza narzędzi w prompcie zyskuje zastrzeżenie, że ogłoszona nazwa może jeszcze nie mieć załadowanego schematu (odroczone ładowanie po stronie SDK). Kod składania tego nie zmienia."
  },
  "diff": "git diff 04431a957033e4c49fdeb08ccbab33bf709f7524..HEAD",
  "portions": [
    "u07-turn-argument-assembly/p1-l2-l15"
  ],
  "stateDir": ".c4s-impl/"
}
```
