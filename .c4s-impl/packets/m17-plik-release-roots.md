# Packet m17-plik-release-roots
- window: 2.1.13 -> 2.1.14 (delta)
- unit: m17-plik-release-roots
- goal: Lekki plik metadanych release'u zapisuje korzenie jako listę samych identyfikatorów korzeni rodzaju stron, a nie obiekty z nazwą i katalogiem. Bogatszy kształt zostaje tylko w manifeście bundla.
- layers touched: L2 (M17 domain)
- entities: 0 in recipe (1 linked context: dto bundle-manifest)
- criteria: 1 (section m17reldisk)
- jobs: none
- packet size: 19222 bytes

## Change (2.1.13 -> 2.1.14) — pages/modules/m17-snapshots-releases/L2-domain.md, change offset 1 limit 1
### [m17reldisk] Release na dysk — lekki plik metadanych (`.claude4spec/releases/<slug>.json`)

**Motywacja (kierunek spec-first).** Substrat zawsze-obecny to SQLite (pochodny indeks) + pliki tekstowe na dysku (źródło prawdy). Release dołącza do tego wzorca: obok bundle'a `tar.gz` (transport #3, derywowany z version tables — **nietknięty**) i version history w SQLite (#2) release zyskuje **lekką tożsamość na dysku** — pojedynczy plik metadanych `.claude4spec/releases/<slug>.json` (korzeń `releases`), ładowany z dysku przy boot jak encje/pages, commitowalny (współdzielony przez zespół, gdy `git.enabled`).

**Zawartość pliku — WYŁĄCZNIE metadata (decyzja B2):**

```json
{
  "name": "0.2.0",
  "slug": "0-2-0",
  "description": "Git jako opcjonalna augmentacja",
  "createdAt": "2026-07-09T10:00:00.000Z",
  "createdBy": "user",
<before_change>  "roots": [{ "id": "pages", "name": "Pages", "dir": "pages" }]</before_change>
<after_change>  "roots": ["pages"]</after_change>
}
```

- `slug = slugify(name)` — primary key na dysku (stabilny, kebab). Release'y są **niemutowalne** co do treści → plik pojawia się w dokładnie jednym commicie git (kotwica jednoznaczna).
- **Zero treści zmian, zero odniesień do wersji encji/stron, zero manifestu, zero `gitSha`.** Powiązanie „release → które wersje encji/stron" pozostaje **jak dziś w SQLite** (`release_id` na wierszach `entity_version`/`file_version`) — nieodtwarzalny stan runtime. Treść release'u odtwarzana z gita (ON) lub z lokalnych version tables (OFF), **nigdy z tego pliku**.
<before_change>- `roots` = lista korzeni rodzaju `pages` (`{id,name,dir}`) w momencie release'u — informacyjna (jak `manifest.roots` w bundlu), pozwala odtworzyć kontekst przestrzeni stron.</before_change>
<after_change>- `roots` = lista **identyfikatorów** (`rootId`) korzeni rodzaju `pages` w momencie release'u — samych `id`, bez `name`/`dir`; informacyjna, pozwala odtworzyć, które przestrzenie stron weszły do wydania. Celowo uboższa od `manifest.roots` w bundlu (`{id,name,dir}`): kształt pliku jest zamrożony razem z plikami, bo zatwierdzone pliki release'u są niemutowalnymi kotwicami diffu z gita, więc jego zmiana wymagałaby przepisania istniejących plików i migracji czytnika.</after_change>

<before_change>**`spec_release` (SQLite) = pochodny cache metadanych.** Odbudowywany z plików korzenia `releases` przez M29 (reakcja `m29-release-cache`, analogicznie do encji z korzenia `entities`). Cache trzyma metadata; kolumna `release_id` na version rows **NIE** jest odtwarzana z dysku — zostaje runtime. Rekonsyliacja przy boot/pull: pliki release z dysku = prawda dla metadanych, cache dorównywany. Porządek wydań nie zależy od numerycznego `id` przydzielonego przy odbudowie — wyznacza go `createdAt` z pliku (oś wydań, L1 <section_ref anchor="7yko4pyq"/>). Numeryczny `id` ↔ `slug` — patrz Otwarte pytania (stabilność referencji z `release_id`).</before_change>
<after_change>**`spec_release` (SQLite) = pochodny cache metadanych.** Odbudowywany z plików korzenia `releases` przez M29 (reakcja `m29-release-cache`, analogicznie do encji z korzenia `entities`). Cache trzyma metadata; kolumna `release_id` na version rows **NIE** jest odtwarzana z dysku — zostaje runtime. Rekonsyliacja przy boot/pull: pliki release z dysku = prawda dla metadanych, cache dorównywany. Porządek wydań nie zależy od numerycznego `id` przydzielonego przy odbudowie — wyznacza go `createdAt` z pliku (oś wydań, L1 <section_ref anchor="7yko4pyq"/>). Numeryczny `id` ↔ `slug` — patrz otwarte pytanie 54 (<section_ref anchor="e6nqwep9"/>; stabilność referencji z `release_id`).</after_change>

**Współistnienie z bundle'em `tar.gz` — bez kolizji.** Plik metadanych (lekka tożsamość na dysku) i bundle (transport derywowany z version tables przez `buildBundleArchive`, kontrakt M25/M27) to **dwie odrębne reprezentacje**. Kontrakt `buildBundleArchive`/`restoreBundleArchive` **bez zmian**; boot/reindex nie próbuje ich godzić.

**Niemutowalność jako inwariant.** Plik `<slug>.json` korzenia `releases` jest niemutowalny co do treści po utworzeniu (fundament kotwicy z historii pliku — <section_ref anchor="m17reldiff"/>). `updateRelease({ name, description })` na najnowszym release'ie jest jedynym wyjątkiem — mutuje metadata najnowszego release'u i przepisuje plik (rename slug repointuje plik). Zamrożone release'y (wszystkie poza najnowszym na osi wydań) plików nie zmieniają.

## Context at 2.1.14 — L2-domain.md offset 7 limit 2
### [m17reldisk] Release na dysk — lekki plik metadanych (`.claude4spec/releases/<slug>.json`)
<after_change>
**Motywacja (kierunek spec-first).** Substrat zawsze-obecny to SQLite (pochodny indeks) + pliki tekstowe na dysku (źródło prawdy). Release dołącza do tego wzorca: obok bundle'a `tar.gz` (transport #3, derywowany z version tables — **nietknięty**) i version history w SQLite (#2) release zyskuje **lekką tożsamość na dysku** — pojedynczy plik metadanych `.claude4spec/releases/<slug>.json` (korzeń `releases`), ładowany z dysku przy boot jak encje/pages, commitowalny (współdzielony przez zespół, gdy `git.enabled`).

**Zawartość pliku — WYŁĄCZNIE metadata (decyzja B2):**

```json
{
  "name": "0.2.0",
  "slug": "0-2-0",
  "description": "Git jako opcjonalna augmentacja",
  "createdAt": "2026-07-09T10:00:00.000Z",
  "createdBy": "user",
  "roots": ["pages"]
}
```

- `slug = slugify(name)` — primary key na dysku (stabilny, kebab). Release'y są **niemutowalne** co do treści → plik pojawia się w dokładnie jednym commicie git (kotwica jednoznaczna).
- **Zero treści zmian, zero odniesień do wersji encji/stron, zero manifestu, zero `gitSha`.** Powiązanie „release → które wersje encji/stron" pozostaje **jak dziś w SQLite** (`release_id` na wierszach `entity_version`/`file_version`) — nieodtwarzalny stan runtime. Treść release'u odtwarzana z gita (ON) lub z lokalnych version tables (OFF), **nigdy z tego pliku**.
- `roots` = lista **identyfikatorów** (`rootId`) korzeni rodzaju `pages` w momencie release'u — samych `id`, bez `name`/`dir`; informacyjna, pozwala odtworzyć, które przestrzenie stron weszły do wydania. Celowo uboższa od `manifest.roots` w bundlu (`{id,name,dir}`): kształt pliku jest zamrożony razem z plikami, bo zatwierdzone pliki release'u są niemutowalnymi kotwicami diffu z gita, więc jego zmiana wymagałaby przepisania istniejących plików i migracji czytnika.

**`spec_release` (SQLite) = pochodny cache metadanych.** Odbudowywany z plików korzenia `releases` przez M29 (reakcja `m29-release-cache`, analogicznie do encji z korzenia `entities`). Cache trzyma metadata; kolumna `release_id` na version rows **NIE** jest odtwarzana z dysku — zostaje runtime. Rekonsyliacja przy boot/pull: pliki release z dysku = prawda dla metadanych, cache dorównywany. Porządek wydań nie zależy od numerycznego `id` przydzielonego przy odbudowie — wyznacza go `createdAt` z pliku (oś wydań, L1 <section_ref anchor="7yko4pyq"/>). Numeryczny `id` ↔ `slug` — patrz otwarte pytanie 54 (<section_ref anchor="e6nqwep9"/>; stabilność referencji z `release_id`).

**Współistnienie z bundle'em `tar.gz` — bez kolizji.** Plik metadanych (lekka tożsamość na dysku) i bundle (transport derywowany z version tables przez `buildBundleArchive`, kontrakt M25/M27) to **dwie odrębne reprezentacje**. Kontrakt `buildBundleArchive`/`restoreBundleArchive` **bez zmian**; boot/reindex nie próbuje ich godzić.

**Niemutowalność jako inwariant.** Plik `<slug>.json` korzenia `releases` jest niemutowalny co do treści po utworzeniu (fundament kotwicy z historii pliku — <section_ref anchor="m17reldiff"/>). `updateRelease({ name, description })` na najnowszym release'ie jest jedynym wyjątkiem — mutuje metadata najnowszego release'u i przepisuje plik (rename slug repointuje plik). Zamrożone release'y (wszystkie poza najnowszym na osi wydań) plików nie zmieniają.
</after_change>

### [m17reldiff] Tożsamość i diff release'u z gita (gdy `git.enabled`)
<after_change>
> Cała ta mechanika aktywna **tylko** gdy `config.git.enabled === true`. Przy git OFF `release_diff` działa jak dziś — z SQLite version tables.

**Marker release'u = commit wprowadzający jego plik (STAŁY).** Zamiast tagu git czy zapisanego `gitSha`, tożsamość release'u w gicie wyliczana jest **leniwie z historii pliku**: `resolveReleaseCommit(path) = git log --diff-filter=A -1 --format=%H -- <dir korzenia releases>/<slug>.json` (M28, <section_ref anchor="aqys9dje"/>). Release niemutowalny ⇒ plik pojawia się w dokładnie jednym commicie ⇒ jednoznaczny marker. Marker jest **stały** — zero przesuwania kotwicy, zero re-touch, zero tagów, zero mutowalnego pola w pliku.

**Model reign: release to panowanie, nie punkt.** Diff w trybie git NIE jest diffem marker-do-marker (snapshot z chwili cięcia), lecz **reign** — release obejmuje całość między swoim cięciem a cięciem następnego release'u:

- **`snapshot(vN)` = stan końca reign vN:**
  - vN **zamrożony** (istnieje następca) → stan **tuż przed** commitem `createRelease` następnego release'u: `M_{next}~1`, gdzie `M_{next} = resolveReleaseCommit(successor(vN))`. Obejmuje marker vN **i wszystkie commity-pull do vN** (jawne `commitPull()` oraz implicit — ręczne commity z terminala); wyklucza `current` wchłonięty dopiero przez następne cięcie.
  - vN **najnowszy** → **HEAD**.
- **`release_diff(vA, vB)` = `git diff snapshot(vA) snapshot(vB)`** (przez `diffRefs`, M28) nad pathspekami: `dir` korzeni rodzajów z flagą `release` plus korzeń `releases`.
- **Look-ahead na następcę (krok algorytmu):** `snapshot(vA) = M_{A+1}~1` wymaga (a) ustalenia `successor(vA)` z osi wydań (L1 <section_ref anchor="7yko4pyq"/>), (b) `resolveReleaseCommit(successor)`, (c) `~1`. Markery (`--diff-filter=A` na `*.json` korzenia `releases`) nadal służą do **znalezienia** commitów `createRelease` — zmienia się wyłącznie ich **interpretacja** (granica reign / granica następnika), nie sposób znajdowania.
- **Fallbacki:** git OFF → SQLite version tables (dzisiejsze zachowanie, niezmienione). Plik release'u (własny lub następcy) nie w historii bieżącego HEAD (release z innego brancha / lokalny, niezacommitowany marker) → `resolveReleaseCommit` zwraca `null` → fallback do SQLite version tables.

**Przekład filtrów stron na oba tory.** `opts.roots` i `opts.paths` zawężają zbiór stron, zanim silnik sięgnie po źródło, a każdy tor realizuje to zawężenie własnym mechanizmem. W **torze git** filtr staje się listą pathspeców podawaną `diffRefs` za `--`: root wchodzi jako swój `root.dir`, a element `paths` jako `<root.dir>/<relPath>`, przy czym `dir` brany jest z **bieżącego** rejestru korzeni — stąd asymetria opisana w przypadkach brzegowych (<section_ref anchor="d8871ce9"/>). Bez filtra pathspeki to, jak wyżej, `dir` korzeni rodzajów z flagą `release` plus korzeń `releases`. W **torze SQLite** filtr staje się predykatem nad `file_version`: `roots` jako przynależność `rootId` do łańcucha identyfikatorów wskazanych przestrzeni, `paths` jako członkostwo pary `(rootId, path)` w zbiorze rozbitych elementów filtra. **Oba tory dają ten sam zbiór stron dla tego samego filtra** — to zdanie jest wiążące, nie opisowe: rozjazd między torami przy `roots` bywa niezauważalny, ale przy wskazaniu jednej strony wychodzi natychmiast, jako pustka w jednym trybie i wynik w drugim. Okno sekcji i rozmiary w mapie delty (<section_ref anchor="1ycgn8bx"/>, <section_ref anchor="sw9bn6qu"/>) nie mają przekładu na tory: liczy się je po diffie sekcyjnym i po projekcji, więc tor git i tor SQLite dziedziczą je bez własnego mechanizmu.

**Dwie nazwy, dwa byty.** `paths` to parametr narzędzia — lista pełnych kluczy stron. `pathspecs` to trzeci argument `diffRefs` (M28 <section_ref anchor="eu1rffp6"/>) — to, co trafia za `--` do `git diff`, i dla czego katalog i plik są jedną kategorią. Zejście jest jednokierunkowe: oba filtry narzędzia zasilają tę samą listę pathspeców, ale pathspec nigdy nie wraca jako adres strony w zwrotce.

**Payoff cross-machine — główna motywacja modelu reign.** Model reign to **jedyny sposób policzenia historycznego `release_diff` na klonie projektu**:

- `release_id` na `entity_version`/`file_version` to **nieodtwarzalny runtime** — `db.sqlite` jest gitignored, a M29 odbudowuje z tekstu wyłącznie **stan bieżący**, nie historię wersji. Na świeżym klonie version-tables są **puste**, więc SQLite-owy historyczny diff jest **niemożliwy**.
- Git niesie historię: markery `<slug>.json` korzenia `releases` w historii → `resolveReleaseCommit` + reign działają na klonie **bez żadnego runtime'u**.
- Świeży klon nie ma też historii `current` — bo nie ma zmian: `current` = niezakomitowany working tree, a tuż po klonie working tree jest czysty (`current` pusty). Jedyne, co istnieje po klonie, to git history — i z niej liczone są wszystkie historyczne release'y; `current` napełnia się dopiero przy lokalnych edycjach.

**`release_diff` — jawne amendowanie inwariantu „from version tables, not from disk" (<section_ref anchor="m17bndiv1"/>).** Inwariant ten dotyczy **wyłącznie `buildBundleArchive`** (bundle pozostaje derywowany z version tables — niezmienione). Dla `getReleaseDiff` źródło rozstrzygane jest per tryb jak wyżej: git ON + markery w historii → refy git (reign); inaczej → SQLite version tables.
</after_change>

## Context at 2.1.14 — bundle-archive-format.md offset 3 limit 1
### [m17bndmf1] `manifest.json` shape
<after_change>
<single_element type="dto" slug="bundle-manifest"/>

`serializerVersions` to kopia <inline_mention type="dto" slug="spec-snapshot"/>`.serializer_versions` z capture (po jednym kluczu na aktywny typ encji — lista pochodzi z registry hosta, nie z zamknietej unii — plus `page` dla toru plikow) — M27 clone/import czyta wersje per typ i deleguje do odpowiedniego deserializatora. **Nazwa klucza jest historyczna** — mapa niesie `payloadVersion` per typ (M47 <section_ref anchor="fs2aay6l"/>), nie wersje slotu `serializer`.

`bundleSchemaVersion` w wartosci `3` (literalny typ; bump z `2` przy przejściu encji na plik-per-encja `entities/<type>/<slug>.json` + `entities/tags.json`) — semantyka bump'a w <section_ref anchor="m17bndsv1"/>. `manifest.roots` (po jednym wpisie na publikowaną przestrzeń — kształt w encji wyżej) pozwala M27 odtworzyć `config.roots[]`. `c4sVersion` jest informacyjny (debugging, audit) — M27 clone/import NIE odrzuca bundle'a po `c4sVersion`, tylko po `bundleSchemaVersion`.
</after_change>

## Linked entity at 2.1.14 — dto bundle-manifest (context, not built here)
```json
[
 {
  "type": "dto",
  "slug": "bundle-manifest",
  "name": "BundleManifest",
  "op": "create",
  "after": {
   "slug": "bundle-manifest",
   "title": "BundleManifest",
   "description": "manifest.json w tar.gz bundle'a release'a (M17 bundle archive format). bundleSchemaVersion to literal 3 — bump = breaking change layoutu/shape'u (2→3: encje jako plik-per-encja entities/<type>/<slug>.json bez pola op, plus entities/tags.json); M27 clone/import odrzuca po bundleSchemaVersion (NIE po c4sVersion). serializerVersions per typ — bundle self-contained wzgledem schematu encji. roots[].formerIds niesie identyfikatory wycofane przez przemianowania przestrzeni: pole jest OPCJONALNE i dodane additive, wiec NIE bumpuje bundleSchemaVersion — manifest bez niego jest poprawny i znaczy 'zadnych przejsc', nie 'przejscia nieznane'.",
   "fields": [
    {
     "name": "bundleSchemaVersion",
     "type": "3",
     "required": true,
     "description": "Literal 3. Bump = breaking change shape'u bundle'a. Czytnik obsluguje takze shimy v2 i v1 (remote trzyma bloby append-only, bez retencji)."
    },
    {
     "name": "release",
     "type": "{ id: number, name: string, description: string, createdAt: string }",
     "required": true,
     "description": "Meta release'a (camelCase; DAO mapuje spec_release.created_at)."
    },
    {
     "name": "roots",
     "type": "Array<{ id: string, name: string, dir: string, formerIds?: string[] }>",
     "required": true,
     "description": "Korzenie rodzaju `pages` opublikowane w bundlu (layout A, D6). M27 restore odtwarza z tej listy config.roots[] w swiezym cwd. `id` to identyfikator BIEZACY w chwili budowania paczki — ten sam, ktorym nazwany jest prefiks `<rootId>/` stron tej przestrzeni. `formerIds` to identyfikatory tej przestrzeni WYCOFANE przez przemianowania, od najstarszego do ostatnio wycofanego: lacznie z `id` tworza lancuch, po ktorym czytelnik rozpoznaje prefiks zapisany pod dawnym adresem i po ktorym klon dziedziczy zbior adresow zajetych (M01: identyfikator raz uzyty nie wraca do innej przestrzeni). Pole opcjonalne — brak znaczy 'ta przestrzen nigdy nie byla przemianowana'; pusta tablica znaczy to samo. Manifest jest jedynym nosnikiem przejsc w paczce: sanityzowany config.json ich nie publikuje, wiec nie ma drugiej kopii do rozjechania."
    },
    {
     "name": "c4sVersion",
     "type": "string",
     "required": true,
     "description": "Wersja claude4spec ktora zbudowala bundle (z package.json). Informacyjny — NIE odrzuca importu."
    },
    {
     "name": "createdAt",
     "type": "string",
     "required": true,
     "description": "ISO 8601 momentu budowania bundle'a (≠ release.createdAt). Powod, dla ktorego bundle nie jest bajt-reprodukowalny."
    },
    {
     "name": "serializerVersions",
     "type": "Record<string, string>",
     "required": true,
     "description": "Wersja serializera per typ z momentu capture. Klucze wyprowadzone z registry hosta (aktywne typy, w tym pluginowe) + 'page' dla toru plikow — bez zaszytej listy. Katalogi w entities/ sa podzbiorem tych kluczy minus 'page'."
    }
   ],
   "examples": [],
   "tags": [
    "m17"
   ],
   "createdAt": "2026-06-19T11:14:00.000Z",
   "updatedAt": "2026-10-05T16:46:35.079Z"
  }
 }
]
```

## Criteria
No `ac` entities in the recipe. Criterion = the changed section's expected behaviour, named by anchor: [section:m17reldisk] — release metadata file `roots` is a list of page-root ids (strings), not {id,name,dir}; bundle manifest.roots keeps {id,name,dir}.

## Not yet / Completes / Remove
Not yet: none. Completes: none. Remove: the `{id,name,dir}` object shape of `roots` in `.claude4spec/releases/<slug>.json` (replaced by string ids).

## Stubs: none. Jobs: none.
