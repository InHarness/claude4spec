---
name: ac-test-implementer
description: Przerabia kolejną porcję niepokrytych AC ze specyfikacji claude4spec na testy Vitest (unit / supertest) albo wpisuje je do skiplisty z powodem. Użyj, gdy user chce zwiększyć pokrycie AC testami ("przerób kolejne AC", "/ac-test-implementer", "pokryj AC testami"). Argument opcjonalny - liczba AC w porcji (domyślnie 5) i/lub filtr po fragmencie sluga/tagu.
---

# AC Test Implementer

Mechanizm "AC po AC": bierze kolejne niepokryte AC ze specyfikacji i zamienia każde na test Vitest albo świadomy skip. Jedno wywołanie = jedna porcja (domyślnie 5 AC, chyba że argument mówi inaczej).

## Konwencje (nienegocjowalne)

- **Traceability:** jeden AC = jeden `it('[ac:<slug>] <krótki opis po angielsku>', ...)`. Marker `[ac:<slug>]` jest jedynym źródłem prawdy o pokryciu — raport grepuje po nim. Uwaga: slugi AC NIE zawsze zaczynają się od `ac-` (część to `m06-...`, `m11-...` itd.), dlatego marker ma prefiks `ac:`.
- **Grupowanie:** testy dopisujemy do plików per obszar (np. `tests/integration/api/plans.test.ts`, `tests/integration/db/serialization.test.ts`), NIGDY plik per AC.
- **Język:** opisy testów i komunikaty po angielsku; komentarze mogą być PL (konwencja repo).
- **Nie naginać testów do kodu ani kodu do AC.** Gdy AC rozjeżdża się z rzeczywistością — patrz "Drift".

## Proces

1. **Stan pokrycia:** `npm run test:ac-coverage` (albo `node scripts/ac-coverage.mjs --uncovered-only`). Weź pierwsze N niepokrytych AC (po filtrze z argumentu, jeśli podany).
2. **Szczegóły AC:** dla każdego sluga, z katalogu głównego repo:
   ```
   npx tsx src/bin/c4s.ts detail --type ac --slug <slug> --project app-spec
   ```
   Pole `verifies[]` wskazuje encje (np. endpoint) — przy potrzebie szerszego kontekstu: `c4s detail --type endpoint --slug <s>` albo `c4s find-references`.
3. **Klasyfikacja:**
   - **API** (AC opisuje request/response/kontrakt HTTP) → test supertest na `createTestApp()` z `tests/helpers/test-app.ts`, plik `tests/integration/api/<obszar>.test.ts`.
   - **DB / serializacja / logika serwera** → test na `createTestDb()` z `tests/helpers/test-db.ts` (+ ewentualnie `PluginRegistryImpl` + `registerAllPlugins`), plik `tests/integration/db/<obszar>.test.ts`; czysta funkcja → unit kolokowany `src/**/<plik>.test.ts`.
   - **Nieautomatyzowalne w Vitest** (UI/React, git, remote-API, chat/agent, watchery, device flow) → wpis do `tests/ac-skiplist.json`: `"<slug>": "<powód po angielsku, np. UI-only / requires git / remote API>"`.
   - `status: deprecated` → skiplist z powodem `deprecated in spec`.
4. **Implementacja:** napisz/dopisz test, odpal `npx vitest run <plik>`, doprowadź do zielonego. Nie startuj watcherów; nie importuj `src/server/workspace/project-context.ts` z testów (side effect przy imporcie).
5. **Drift:** gdy AC jest nieaktualne/niejednoznaczne względem kodu — NIE pisz testu pod kod. Utwórz patch w `.claude4spec/patches/` (konwencja repo: feedback dla autora specyfikacji) i wpisz AC do skiplisty z powodem `drift — see .claude4spec/patches/<plik>`.
6. **Raport końcowy:** `npm run test:ac-coverage` + `npm test` (całość musi być zielona). Podsumuj userowi: ile covered/skipped w tej porcji, co poszło do skiplisty i dlaczego, wykryte drifty.

## Pułapki

- `pool: 'forks'` w vitest.config.ts jest wymagany (natywny better-sqlite3) — nie zmieniać.
- Globalna mapa extension reference types jest czyszczona w `tests/setup.ts` po każdym teście.
- `tests/ac-skiplist.json`: każdy wpis MUSI mieć niepusty powód — raport traktuje braki jako PROBLEM (exit 2).
- Slugi AC bywają obcięte (np. `ac-get-api-plans-zwraca-planslistrespon`) i nie zawsze mają prefiks `ac-` — kopiuj dokładnie z raportu, nie "poprawiaj" ich.
