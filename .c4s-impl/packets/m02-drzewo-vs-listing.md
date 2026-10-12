# Packet — m02-drzewo-vs-listing
- window: 2.1.13 → 2.1.14 (delta)
- unit: m02-drzewo-vs-listing
- goal: Rozdzielone zostają drzewo korzenia i listing stron. Drzewo podaje wpisy markdown i surowe `.html` z typem pliku i z niego korzysta skan drzewa stron oraz podgląd statycznego HTML. Listing zwraca wyłącznie wpisy markdown i chodzą po nim wszyscy czytelnicy treści: indeksery, kotwice, linki, referencje, synchronizacja wersji i wyszukiwanie. Usunięty jest skan `.html` przez listing markdown.
- layers touched: L13 (page roots; M02 domain + M30 consumer)
- entities: ac 1 (criteria), mcp-tool 1 (linked context: reference-tools-list-pages)
- criteria: 1 (ac-plik-html-lezacy-w-korzeniu-stron-jes)
- jobs: none
- packet size: ~58984 bytes

## Change reads (2.1.13 → 2.1.14)

### m02-pages.md change offset 1 limit 1
#### [pages/modules/m02-pages.md] M02 — Pages > Domain > Page tree resolution (anchor `e16qvg1n`)

<before_change>1. Skanuj `dir/` **każdego korzenia z fasadą** rekurencyjnie po wpisy mapy jego rodzaju — dla rodzaju `pages`: `*.md`, `*.mdx` (markdown) **oraz** `*.html` (surowy) (`listMarkdownFiles(rootId)` per korzeń — walk jest per-korzeń, tożsamość pliku to `(rootId, relPath)`)</before_change>
<after_change>1. Skanuj `dir/` **każdego korzenia z fasadą** rekurencyjnie po wpisy mapy jego rodzaju — dla rodzaju `pages`: `*.md`, `*.mdx` (markdown) **oraz** `*.html` (surowy) (`service(rootId).listTree()` per korzeń — walk jest per-korzeń, tożsamość pliku to `(rootId, relPath)`; `listMarkdownFiles(rootId)` zwraca z tego samego korzenia tylko wpisy markdown, <section_ref anchor="m02multidir"/>)</after_change>
2. Buduj drzewo **per korzeń**: katalogi → foldery, pliki → strony. Do sidebaru drzewo trafia przycięte do poddrzew z tablicy akordeonów korzenia (<section_ref anchor="m02l13001"/>); korzenie rodzajów z `sidebar: hidden` drzewa w sidebarze nie mają — briefy/patche renderują się pod OTHERS przez UI M21/M23
3. Sortuj: `order` z frontmatter (rosnaco), potem alphabetical
4. `index.md` w katalogu → strona domyslna tego katalogu. `index.mdx` rowniez (jezeli brak `index.md`); **tie-break gdy oba istnieja** — `index.md` wygrywa (precedencja jawna).

**Mapowanie wpis mapy → `fileType`.** `fileType` wynika z wpisu mapy rodzaju korzenia; dla rodzaju `pages`: wpis markdown (`.md` **oraz** `.mdx`) → `fileType='markdown'` (jedna klasa); wpis surowy `.html` → `fileType='html'`. `.mdx` jest pelnoprawnym markdownem dla potoku: **trafia** do section indexera (M06), validation referencji (M19) i capture `file_version` (M17) — dokladnie jak `.md`, w przeciwienstwie do `.html`. Rozroznienie `.md`/`.mdx` sluzy **wylacznie ikonie w sidebarze** (derywowanej z `name`/rozszerzenia wezla drzewa, nie z `fileType`); JSX w `.mdx` **nie jest wykonywany** — renderujemy go jako markdown (szczegoly potoku edytora w `@modules/m20-editor-tiptap.md` <section_ref anchor="tx1dyn4w"/>).

**Dyskryminator `fileType` (M30).** Wezel drzewa `type='file'` niesie pole `fileType: 'markdown' | 'html'` (folder bez zmian; patrz DTO `page-node`). Brak pola = `'markdown'` (wsteczna kompatybilnosc). DTO `page-node` **bez zmian** — `.mdx` pozostaje `fileType='markdown'`, wiec nie wnosi nowej wartosci dyskryminatora. Wpis surowy `.html` pomija każda reakcja przyjmująca markdown (section indexer M06), graf referencji (M19 — `references` tylko na markdown) i capture `file_version` (M17 — tor `brak`) — pliki `.html` sa wylacznie podgladane przez M30 (`HtmlViewer`).

### m02-pages.md change offset 3 limit 2
#### [pages/modules/m02-pages.md] M02 — Pages > Korzenie i rodzaje korzeni (L13) > Model korzenia (anchor `l13model0`)

Korzeń jest wpisem rejestru `{ id, name, dir, kind, builtin }`, **nie** encją SQLite ani pluginem M13. Rejestr ma dwa źródła.

**Konfiguracja — korzenie użytkownika.** Wpisy `config.roots[]` (M01 <section_ref anchor="c0nf1g4a"/>) mają zawsze `kind: pages`. Wpis w pliku ma cztery pola:

```
id       — identyfikator korzenia (slug kebab), unikalny w obrębie projektu; wartość rootId
           w file_version i w kluczach (rootId, path). Wybiera go autor projektu — poza
           identyfikatorami korzeni ze źródłem `kod`. Zmienia się wyłącznie
           jawną operacją, nigdy w tle.
name     — wyświetlana etykieta (sidebar accordion, modal briefu), np. "Pages", "Docs".
dir      — katalog względem cwd (resolveSafe z M02, nie escapuje korzenia).
builtin  — boolean; dokładnie jeden wpis roots[] ma true i to on JEST korzeniem podstawowym,
           niezależnie od swojego id. Korzeń użytkownika dodany później ma false.
```

Wpis jest kompletny albo nieważny; pola spoza tych czterech są nieznanymi polami, które czytnik ignoruje (M26 <section_ref anchor="hozcm4w5"/>). Walidację `dir` — path-safety i zakaz nakładania się przestrzeni nazw — opisuje <section_ref anchor="m01rootsval"/>.

**Kod — korzenie systemowe.** Korzenie rodzajów ze źródłem `kod` są wpisami rejestru zarejestrowanymi w kodzie, po jednym na rodzaj: `id = kind` (identyfikator zastrzeżony), stały `dir` = `.claude4spec/<kind>`. Pole `sidebar` i obecność w UI wynikają z deklaracji rodzaju. Nie ma ich w `config.json` i nie da się ich przenieść. Konsument pytający o konkretny korzeń systemowy pyta rejestr o rodzaj, nigdy o katalog.

**Stała mapa korzenia użytkownika.** Każdy korzeń użytkownika ma mapę plików, flagi i reakcje rodzaju `pages` (<section_ref anchor="m02l13001"/>), a plik konfiguracji nie ma pól, które by je zmieniały: każdy korzeń stron ma pełny cykl życia — wydanie, indeks sekcji i graf referencji.

**Rola korzenia podstawowego mieszka we fladze `builtin`, nie w identyfikatorze.** Korzeń podstawowy jest nieusuwalny, ma landing i stronę powitalną. `id`, `name` i `dir` są od siebie niezależne — żadne nie wyprowadza się z pozostałych i żadne nie rozstrzyga, który korzeń jest podstawowy. Konsument pytający „czy to korzeń podstawowy” czyta `builtin`; konsument adresujący przestrzeń czyta `id`. `pages` jest wartością domyślną nadawaną nowemu projektowi, a nie tożsamością wymaganą do działania: projekt, w którym korzeń podstawowy nosi `id: docs`, jest w pełni poprawny.

**Przynależność pliku = położenie plus pierwszy pasujący wzorzec mapy rodzaju — nigdy nazwa ani rola.** Nie ma listy nazw wyjątkowych. Konsekwencja jest **świadoma, nie anomalna**: przy korzeniu o `dir: "."` pliki `CLAUDE.md` i `SKILL.md` leżące w tym katalogu są normalnie częścią przestrzeni stron — walker je indeksuje, a reakcja wstrzykiwania kotwic nadaje im kotwice, tak samo jak każdej innej stronie. To jest poprawne: oba są dokumentami specyfikacji, więc mają być czytelne przez operacje odkrywania i referowalne przez `<section_ref/>`. Gdyby istniała lista nazw wyjątkowych, każdy nowy plik konwencjonalny wymagałby edycji walkera.

**Przestrzeń nazw korzenia nie obejmuje poddrzew zaczynających się od kropki.** Przestrzeń korzenia to pliki pod `dir` z wyłączeniem poddrzew przechodzących przez segment zaczynający się od kropki — walker i tak ich nie odwiedza. Dlatego korzeń `.` współistnieje ze stałymi katalogami `.claude4spec/<kind>`, a korzeń `.claude/skills` z korzeniem `.`; nakładanie się przestrzeni nazw liczone w ten sposób jest błędem D4.

<before_change>**`.html` należy do przestrzeni korzenia, ale nie jest stroną.** Plik `.html` jest wpisem surowym mapy rodzaju `pages` — `listMarkdownFiles` zwraca go na potrzeby podglądu (<section_ref anchor="m02multidir"/>) — ale dla `list_pages`, `get_page` i `search_pages` stroną nie jest: nie dostaje kotwic (reakcje M06 przyjmują tylko markdown), nie ma wersji (tor `brak`) i operacje odkrywania nie mają dla niego adresu.</before_change>
<after_change>**`.html` należy do przestrzeni korzenia, ale nie jest stroną.** Plik `.html` jest wpisem surowym mapy rodzaju `pages` — pokazuje go drzewo korzenia (`listTree`) na potrzeby podglądu, a nie listing wpisów markdown `listMarkdownFiles` (<section_ref anchor="m02multidir"/>) — ale dla `list_pages`, `get_page` i `search_pages` stroną nie jest: nie dostaje kotwic (reakcje M06 przyjmują tylko markdown), nie ma wersji (tor `brak`) i operacje odkrywania nie mają dla niego adresu.</after_change>

#### [pages/modules/m02-pages.md] M02 — Pages > Korzenie i rodzaje korzeni (L13) > Root Registry (`roots[]`) — fasada `PagesService` nad prymitywem per root (D9) (anchor `m02multidir`)

M02 trzyma rejestr korzeni `{ id, name, dir, kind, builtin }` (<section_ref anchor="l13model0"/>) — korzenie użytkownika z per-projekt configu (M01) i korzenie systemowe z kodu — i buduje **fasadę `PagesService` per korzeń rodzaju z `sidebar` innym niż `hidden`**, każdą nad **prymitywem `MarkdownFileStore`** (D9), oba **parametryzowane `{ rootId, dir }`** w konstruktorze. Prymityw jest **generyczny** (agnostyczny wobec rodzaju korzenia): `MarkdownFileStore` daje CRUD+frontmatter+sha256 (<section_ref anchor="gnxw0ua1"/>). Obserwację katalogu wnosi **M40** — implementor montuje u niego źródło każdego korzenia, nie konstruuje watchera. `PagesService` to **fasada korzeni z drzewem w sidebarze** dokładająca tree resolution i egzekwowanie flag L13 — **nie istnieją instancje `PagesService` poza korzeniami rodzajów z `sidebar` innym niż `hidden`**.

Root podstawowy to zwykły wpis `roots[]` z flagą `builtin: true` i identyfikatorem wybranym przez autora — domyślnie `pages`; rejestr rozpoznaje go po tej fladze, nigdy po wartości identyfikatora. Korzenie użytkownika (np. `.claude/skills` jako „Claude skills") dokładają kolejne fasady. **Korzenie systemowe są wpisami tego samego rejestru** — dla rodzajów z wpisami markdown (`plans`, `briefs`, `patches`) implementor buduje skład plików korzenia: instancję prymitywu `MarkdownFileStore` bez fasady, z której korzysta rodzina odczytu M36. Źródła zdarzeń wszystkich korzeni montuje implementor (<section_ref anchor="m02l13001"/>). Orchestracja żyje **przy budowie `ProjectContext`** (M31/L10), nie przy starcie procesu — `dir` korzeni użytkownika rozwiązywany z **per-projekt** configu tego kontekstu, więc każdy projekt workspace dostaje własny zestaw:

<single_element type="code-snippet" slug="page-root-runtime-construction" caption="Pętla po rejestrze korzeni przy budowie ProjectContext"/>

<before_change>`listMarkdownFiles(rootId)` skanuje `dir` konkretnego korzenia po wpisach mapy jego rodzaju (dla rodzaju `pages`: wpisy markdown `*.md`/`*.mdx` oraz wpis surowy `*.html`); walk jest **per-root**, więc ta sama `relPath` w dwóch rootach to dwa różne pliki — **tożsamość pliku to `(rootId, relPath)`**, nie sama `relPath`.</before_change>
<after_change>`listMarkdownFiles(rootId)` skanuje `dir` konkretnego korzenia **wyłącznie po wpisach markdown** mapy jego rodzaju (dla rodzaju `pages`: `*.md`/`*.mdx`). To listing, po którym chodzi każdy czytelnik treści stron — indekser sekcji i wstrzykiwanie kotwic (M06), M08, M14, M19, początkowa synchronizacja `file_version` (M17), indekser frontmattera i wyszukiwanie stron — a żadnemu z nich nie wolno czytać wpisu surowego. Wpis surowy `*.html` (tor `brak`) pokazuje **drzewo korzenia** — `service(rootId).listTree()`, które nadaje węzłom `fileType` z mapy rodzaju (<section_ref anchor="e16qvg1n"/>). Oba walki są **per-root**, więc ta sama `relPath` w dwóch rootach to dwa różne pliki — **tożsamość pliku to `(rootId, relPath)`**, nie sama `relPath`.</after_change>

Wszystkie korzenie z wpisami na torze `file_version` — korzenie `kind: pages` **oraz** korzenie `plans`, `briefs` i `patches` — zasilają **wspólny `FileVersionService` z M17** (D10, keyed `(rootId, path)`, patrz M17). `rootId` to zawsze id wpisu rejestru: id korzenia stron albo `'plans'` / `'briefs'` / `'patches'` dla korzeni systemowych. Tabela `file_version` traktuje plik z dowolnego źródła jednakowo — capture, release assignment, restore działają bez modyfikacji. `M17.releaseService.assignToRelease()` filtruje `WHERE rootId IN (korzenie kind: pages)`, więc przejmuje wpisy wszystkich korzeni stron, a korzenie systemowe — rodzaje bez `release` — są z natury wykluczone.

**Artefakty żyją w korzeniach systemowych** rodzajów z `sidebar: hidden` (poza accordionem); każdy korzeń wchodzi do sidebaru tablicą akordeonów swojego rodzaju (<section_ref anchor="m02l13001"/>). Stały katalog nie może nachodzić na korzeń stron (D4, <section_ref anchor="l13model0"/>), więc `listTree()` żadnego korzenia stron nie filtruje artefaktów.

Separacja per korzeń:
- `service(rootId).listTree()` → drzewo korzenia z fasadą.
- Listing artefaktów **nie** idzie przez fasadę `PagesService` — rodzina odczytu M36 korzysta ze składów korzeni `plans`, `briefs` i `patches`, konsumowanych przez M21/M23/M10, oraz z `findByFrontmatterType('brief'|'patch'|'plan')` na współdzielonym `FrontmatterIndexer`.

**Debounce niezależny per mount** — szybkie zapisy w jednym korzeniu nie blokują reakcji w innym; mechanika należy do M40.


**Przemianowanie przestrzeni — rozstrzygnięcie tożsamości i przełączenie rejestru.** Przemianowanie dotyczy korzeni użytkownika; identyfikatory korzeni systemowych są stałe. Rejestr jest jedynym miejscem, które wie, która przestrzeń odpowiada dziś pod danym adresem, więc jawna zmiana identyfikatora — kontrakt i walidacja należą do M01 (<section_ref anchor="fgt8k6gc"/>) — pyta go o dwie rzeczy: czy przestrzeń źródłowa istnieje i czy docelowy identyfikator jest **wolny**. Wolny znaczy tu „nieobecny w `roots[]` **i** niewycofany wcześniejszym przejściem": adres raz wydany nie może zacząć wskazywać innej przestrzeni, bo `(rootId, relPath)` jest tożsamością pliku i w zapisanych wersjach już tę parę utrwalono.

Przełączenie jest **odmontowaniem i zamontowaniem, nie podmianą pola**: fasada i zamówione dla niej źródło są kluczowane identyfikatorem rootu, więc para pod starym kluczem przestaje istnieć, a nad tym samym `dir` powstaje para pod nowym. Katalog, pliki i wstrzyknięte w nie anchory nie są przy tym dotykane — przemianowanie zmienia adres przestrzeni, nie jej treść, więc żaden zapis pliku się tu nie odbywa. Po przełączeniu zapytanie o identyfikator spoza `roots[]` odpowiada błędem jak dotąd — w szczególności stary identyfikator nie jest cichym aliasem nowego.

Samego kontraktu operacji rejestr nie posiada i nie montuje dla niej trasy: wykonuje rozstrzygnięcie i przełączenie na żądanie właściciela konfiguracji, który odpowiada za walidację wyniku, utrwalenie nowej listy rootów i zapis przejścia.

### m30-static-html.md change all
#### [pages/modules/m30-static-html.md] M30 — Static HTML Pages > Korzenie i rodzaje korzeni (L13) (anchor `m30l13rt`)

M30 to **konsument** L13 (schema: `layers/L13-page-roots.md` <section_ref anchor="l13slice0"/>). Nie wnosi własnego rodzaju ani własnej deklaracji — wpis `**/*.html` należy do mapy plików rodzaju `pages` (<section_ref anchor="fjkog8wx"/>). Podgląd jest więc dostępny w **każdym korzeniu tego rodzaju**, a rezolucja ścieżki liczona jest względem `dir` tego korzenia (model korzenia — <section_ref anchor="l13model0"/>):

- **Keyed flag** — rodzaj `pages`: plik `.html` jest wpisem mapy tego rodzaju, więc jest skanowany i podglądany w każdym jego korzeniu, obok stron markdown. Żadnej z czterech flag M30 nie czyta. Guard rezolwuje względem `dir` korzenia węzła.
<before_change>- **Root iteration** — korzenie rodzaju `pages` (nie tylko korzeń podstawowy); skan `.html` idzie przez `listMarkdownFiles(rootId)` M02 (<section_ref anchor="m02multidir"/>) dla każdego takiego korzenia.</before_change>
<after_change>- **Root iteration** — korzenie rodzaju `pages` (nie tylko korzeń podstawowy); wpis `.html` każdego takiego korzenia pokazuje drzewo korzenia M02 (`service(rootId).listTree()`, `fileType` z mapy rodzaju — <section_ref anchor="m02multidir"/>), nie listing wpisów markdown `listMarkdownFiles(rootId)`.</after_change>
- **Gated behavior** — trasa serwująca surowy plik niesie `:rootId` (`/api/static/:rootId/*`); path-traversal guard resolwuje ścieżkę względem `dir` **rozwiązanego** korzenia, nie jednego katalogu. `HtmlViewer` montuje się na space-aware trasie `/space/:rootId/$` gdy `fileType === 'html'`.
- **Key shape** — tożsamość podglądanego pliku to `(rootId, relPath)`: ta sama `relPath` (`report.html`) może istnieć w wielu korzeniach i wskazuje różne pliki. `:rootId` (segment trasy) + splat (`relPath`) jednoznacznie adresują plik.
- **No-hardcode assert** — M30 nie czyta katalogu z klucza konfiguracji, nie trzyma listy katalogów, nie ma gałęzi `if (dir === 'pages')`, nie rozpoznaje korzenia podstawowego po `id` (tylko po `builtin`) ani korzenia jednokorzeniowego rodzaju po `id` (tylko po `kind`) i nie zakłada pojedynczego korzenia: `staticHtmlService` bierze `dir` z rejestru korzeni M02 po `rootId`, a `rootId` spoza korzeni rodzaju `pages` → `404 ROOT_NOT_FOUND` (bez cichego fallbacku).

`.html` leży w drzewie korzenia jako wpis surowy, ale stroną nie jest (<section_ref anchor="l13model0"/>): pozostaje read-only, w sandboxowanym iframe, **bez** kotwic, wersji i indeksowania (M06/M17/M19) — reakcje tych modułów przyjmują wyłącznie wpisy markdown albo wpisy z torem `file_version`, a tor wersji wpisu `.html` to `brak`.

## Context reads (state at 2.1.14)

### m02-pages.md context offset 1 limit 2
#### [pages/modules/m02-pages.md] M02 — Pages > Cel (anchor `487vmesk`)
<after_change>
Autor specyfikacji trzyma jej treść jako zwykłe pliki markdown na dysku i pracuje na nich zarówno z poziomu aplikacji, jak i poza nią — edytorem, agentem, gitem. Ten moduł odpowiada za odczyt i zapis tych plików, za drzewo nawigacji po nich, za odczyt opcjonalnego frontmatter oraz za to, żeby zmiana wprowadzona poza aplikacją dotarła do otwartego widoku, a zapis własny serwera nie był z nią mylony.

Nie interpretuje treści strony ponad składnię markdown: nie indeksuje sekcji, nie waliduje referencji i nie zna znaczenia osadzonych w prozie znaczników. Nie ma też własnego mechanizmu obserwacji dysku — deklaruje jedynie, które katalogi mają być obserwowane, i reaguje na to, co z nich przychodzi.
</after_change>

#### [pages/modules/m02-pages.md] M02 — Pages > Zależności (anchor `lzt9r2fu`)
<after_change>
Moduł wnosi prymityw plikowy i rejestr korzeni, więc na zewnątrz sięga wyłącznie po to, czego prymityw nie ma sam z siebie: źródło konfiguracji korzeni, nadzór nad zmianą pliku, zakres projektu i widok dla stron, których nie renderuje edytor markdown.

<tagged_list type="module-dependency" tags="m02"/>
</after_change>

### m02-pages.md context offset 8 limit 1
#### [pages/modules/m02-pages.md] M02 — Pages > Domain > Page tree resolution (anchor `e16qvg1n`)
<after_change>
1. Skanuj `dir/` **każdego korzenia z fasadą** rekurencyjnie po wpisy mapy jego rodzaju — dla rodzaju `pages`: `*.md`, `*.mdx` (markdown) **oraz** `*.html` (surowy) (`service(rootId).listTree()` per korzeń — walk jest per-korzeń, tożsamość pliku to `(rootId, relPath)`; `listMarkdownFiles(rootId)` zwraca z tego samego korzenia tylko wpisy markdown, <section_ref anchor="m02multidir"/>)
2. Buduj drzewo **per korzeń**: katalogi → foldery, pliki → strony. Do sidebaru drzewo trafia przycięte do poddrzew z tablicy akordeonów korzenia (<section_ref anchor="m02l13001"/>); korzenie rodzajów z `sidebar: hidden` drzewa w sidebarze nie mają — briefy/patche renderują się pod OTHERS przez UI M21/M23
3. Sortuj: `order` z frontmatter (rosnaco), potem alphabetical
4. `index.md` w katalogu → strona domyslna tego katalogu. `index.mdx` rowniez (jezeli brak `index.md`); **tie-break gdy oba istnieja** — `index.md` wygrywa (precedencja jawna).

**Mapowanie wpis mapy → `fileType`.** `fileType` wynika z wpisu mapy rodzaju korzenia; dla rodzaju `pages`: wpis markdown (`.md` **oraz** `.mdx`) → `fileType='markdown'` (jedna klasa); wpis surowy `.html` → `fileType='html'`. `.mdx` jest pelnoprawnym markdownem dla potoku: **trafia** do section indexera (M06), validation referencji (M19) i capture `file_version` (M17) — dokladnie jak `.md`, w przeciwienstwie do `.html`. Rozroznienie `.md`/`.mdx` sluzy **wylacznie ikonie w sidebarze** (derywowanej z `name`/rozszerzenia wezla drzewa, nie z `fileType`); JSX w `.mdx` **nie jest wykonywany** — renderujemy go jako markdown (szczegoly potoku edytora w `@modules/m20-editor-tiptap.md` <section_ref anchor="tx1dyn4w"/>).

**Dyskryminator `fileType` (M30).** Wezel drzewa `type='file'` niesie pole `fileType: 'markdown' | 'html'` (folder bez zmian; patrz DTO `page-node`). Brak pola = `'markdown'` (wsteczna kompatybilnosc). DTO `page-node` **bez zmian** — `.mdx` pozostaje `fileType='markdown'`, wiec nie wnosi nowej wartosci dyskryminatora. Wpis surowy `.html` pomija każda reakcja przyjmująca markdown (section indexer M06), graf referencji (M19 — `references` tylko na markdown) i capture `file_version` (M17 — tor `brak`) — pliki `.html` sa wylacznie podgladane przez M30 (`HtmlViewer`).
</after_change>

### m02-pages.md context offset 42 limit 4
#### [pages/modules/m02-pages.md] M02 — Pages > Korzenie i rodzaje korzeni (L13) (anchor `m02l13001`)
<after_change>
M02 jest **implementorem L13** i zarazem właścicielem rodzaju `pages`. Sekcja jest czytana w how-mode: rejestr korzeni z dwoma źródłami, enum rodzajów, rozstrzyganie typu pliku, egzekwowanie flag, montaż i podpinanie reakcji, walidacja przestrzeni nazw — oraz deklaracja rodzaju `pages`. Model korzenia opisuje <section_ref anchor="l13model0"/>, a fasadę `PagesService` i tożsamość pliku <section_ref anchor="m02multidir"/>.

**Rejestr i enum rodzajów.** Rejestr składa się z wpisów `{ id, name, dir, kind, builtin }` z dwóch źródeł: `config.roots[]` (rodzaj `pages`, N wpisów) i kod (po jednym wpisie na rodzaj ze źródłem `kod`, `id = kind`). Enum `kind` jest sumą deklaracji modułów: `pages` (M02), `plans` (M10), `briefs` (M21), `patches` (M23), `entities` (M29), `releases` (M17), `skills` (M52 <section_ref anchor="i5frb6it"/>). Typ pliku rozstrzyga mapa plików jego rodzaju — wygrywa pierwszy pasujący wzorzec; typu nie rozstrzyga się z treści pliku.

**Egzekwowanie flag.** Wartości flag są stałe dla rodzaju i stoją w jego deklaracji; operacje czytają je na żądanie, żadna nie bramkuje reakcji. Reguły stosowania: `references` tylko na wpisach markdown, `release` tylko na wpisach z torem wersji innym niż `brak`, `gitignore` i `agentDirectFs` na katalogu korzenia.

| Flaga rodzaju | Miejsce egzekwowania | Konsument |
| --- | --- | --- |
| `release` | udział pliku w wydaniu (snapshot, diff, bundle, restore) jego torem wersji; pathspeki diffu git = `dir` korzeni rodzajów z `release` plus korzeń `releases` | M17 |
| `references` | przynależność pliku do grafu referencji: walidacja, `find_references`, przepisywanie `slug=`/`tags=`, ostrzeżenia przy zapisie, węzły referencji w edytorze | M19, M18, M20 |
| `gitignore` | obecność katalogu korzenia w zarządzanym bloku `.gitignore` przy `git.enabled = false` | M28 |
| `agentDirectFs` | wartość `nie` wprowadza katalog korzenia do niejawnego deny-setu agenta | M05, M48 |

Konsumenci, którzy mają widzieć wyłącznie strony, iterują po rodzaju, nie po fladze — encje też są wydawane, a te listy encji nie obejmują:

| Rodzaj `pages` | Iteracja | Konsument |
| --- | --- | --- |
| filtr `assignToRelease`, filtr ścieżek `file_version`, sanityzacja `roots` w bundle | korzenie rodzaju `pages` | M17 |
| zakres modalu briefu | korzenie rodzaju `pages` | M21 |
| odkrywanie (`list_pages`, `get_page`, `search_pages`, `overview`) — każdy inny `rootId` daje błąd nieznanego korzenia | korzenie rodzaju `pages` | M39, M12, M11 |

Odkrywanie agenta (`list_pages`, `get_page`, `search_pages`, `overview`) iteruje wyłącznie korzenie rodzaju `pages` — także wtedy, gdy korzeń innego rodzaju ma fasadę `PagesService`.

**Montaż i podpinanie.** Przy budowie `ProjectContext` (M31/L10), w swoim build hooku, implementor dla każdego korzenia rejestru, w kolejności rejestru:

1. montuje źródło u M40 — `mountSource({ source, dir, scope })`; nazwą źródła jest `pages:<rootId>` dla korzenia ze źródła konfiguracji, a nazwa rodzaju dla korzenia ze źródłem `kod` (np. `skills` → `skills`); korzenie `plans`, `briefs` i `patches` zachowują zastane nazwy `artifacts:plan|brief|patch`;
2. dla rodzajów z wpisami markdown buduje skład plików korzenia (instancję prymitywu `MarkdownFileStore`), a dla rodzajów z `sidebar` innym niż `hidden` dodatkowo fasadę `PagesService` (dalej: korzeń z fasadą);
3. waliduje wymagania z kontraktów przyjęcia reakcji wybranych przez rodzaj — niespełnione wymaganie (np. `m06-section-indexer` bez `m06-anchor-injection` albo bez `references = tak`) zatrzymuje budowę kontekstu z błędem;
4. wiąże `bindReaction(id, source, scope)` każdą reakcję z listy rodzaju oraz reakcję bazową `m02-file-changed`;
5. dla rodzaju, który w polu `sidebar` deklaruje reduktor, wiąże dodatkowo reakcję `m02-sidebar-reducer` (<section_ref anchor="x6avfb5q"/>) ze źródłem korzenia — bez filtra po stronie M40; glob reduktora stosuje sama reakcja.

Kolejność „mount przed wiązaniem” (M40 <section_ref anchor="zkxf6s7o"/>) jest spełniona per źródło. Dispose zdejmuje mounty i wiązania po `scope`. Źródła `plugins:*` są poza rejestrem — montuje i wiąże je M33. Konstrukcję pokazuje <section_ref anchor="m02multidir"/>.

**Reakcja bazowa `m02-file-changed`.** `file:changed { rootId, path, origin }`, rodzaj `powiadomienie`, wyzwalacz `oba`, każdy wpis mapy. Implementor dokłada ją do każdego korzenia rejestru; rodzaj jej nie wymienia i nie może jej wyłączyć. Znaczy „plik w korzeniu się zmienił” — to sygnał dla tych, którzy czytają sam plik (drzewo, przeładowanie edytora, podgląd HTML). **Nie** znaczy „projekcja gotowa”: faza `powiadomienie` biegnie równolegle z `projekcja` (M40 <section_ref anchor="v90cvq22"/>), więc klient czytający projekcję słucha zdarzeń domenowych (`section:indexed`, `entity:indexed`, `plan:updated`). Korzenie `entities` i `releases` emitują ją tak samo jak pozostałe.

**Reduktory `sidebar` — wywołanie, przeliczanie, fallback, dostarczenie.** Reduktor rodzaju wywołuje reakcja `m02-sidebar-reducer`. Wejściem są ścieżki plików korzenia i frontmatter plików z globu reduktora — z `FrontmatterIndexer`, gdy rodzaj wybrał tę reakcję, a w przeciwnym razie odczytany ze składu plików korzenia. Wynik jest cache'owany per `rootId`. Przeliczenie biegnie przy dodaniu albo usunięciu pliku — handler porównuje ścieżkę ze zbiorem ścieżek korzenia — oraz przy zmianie pliku pasującego do globu, który stosuje handler. Tablice korzeni z `sidebar: hidden` i `sidebar: accordion` implementor wylicza wprost z deklaracji, bez wiązania reakcji. Reguły wyniku L13 egzekwuje implementor: element łamiący regułę jest pomijany z ostrzeżeniem w logu, a przy nakładaniu się poddrzew pomijany jest element późniejszy. Reduktor zgłaszający błąd daje fallback — wynik przypadku `accordion`. Tablicę dostarcza <inline_mention type="endpoint" slug="get-api-sidebar-accordions"/>: najpierw korzenie rodzaju `pages` w kolejności rejestru, potem korzenie pozostałych rodzajów w kolejności rejestracji rodzajów, a w obrębie korzenia w kolejności wyniku reduktora; korzeń `hidden` nie wnosi elementów. Gdy tablica korzenia po przeliczeniu różni się od poprzedniej — także po przebudowie kontekstu — implementor emituje `sidebar:accordions-changed { rootId }`.

**Walidacja przestrzeni nazw.** Przestrzenie nazw korzeni rejestru nie mogą się nakładać (D4); przestrzeń korzenia nie obejmuje poddrzew przechodzących przez segment zaczynający się od kropki (<section_ref anchor="l13model0"/>). Walidację wpisów `roots[]` wykonuje M01 (<section_ref anchor="m01rootsval"/>).

**Korzenie systemowe są wpisami rejestru.** Fasadę `PagesService` dostają korzenie rodzajów z `sidebar` innym niż `hidden`. Skład plików korzeni z wpisami markdown implementor buduje dla każdego rodzaju.

**Root Registry API (per `ProjectContext`):** `listRoots()`, `getRoot(rootId)`, `service(rootId)`, `listMarkdownFiles(rootId)`, `listAccordions()`. `rootId` spoza rejestru w query → błąd (nie cichy fallback na korzeń podstawowy) — dotyczy to tak samo identyfikatora wycofanego przemianowaniem. Uchwytu do watchera rejestr **nie wystawia** — `markOrigin()` woła `MarkdownFileStore` wprost w M40, a wiązania idą przez rejestr M40 po nazwie źródła.

**Anchor-injection frontmatter-safe (D5, uniwersalny inwariant):** reakcja `m06-anchor-injection` wstrzykuje `<!-- anchor -->` **nigdy** nie modyfikując bloku `---` frontmatter — dotyczy wszystkich korzeni rodzajów, które ją wybrały. M02 jedynie ją wiąże; sam inwariant należy do M06.

**No-hardcode assert:** M02 nie czyta katalogu z klucza konfiguracji, nie trzyma listy katalogów, nie rozpoznaje korzenia podstawowego po `id` (tylko po `builtin`) ani korzenia jednokorzeniowego rodzaju po `id` (tylko po `kind`). Rejestr pytany „która fasada jest podstawowa” czyta flagę `builtin`; pytany „która przestrzeń odpowiada dziś pod tym adresem” czyta identyfikator; pytany o korzeń systemowy czyta rodzaj. Literał `pages` zostaje w tym module wyłącznie jako wartość domyślna nowego projektu i jako nazwa rodzaju. Jedyny „live” writer na katalogu każdego korzenia z fasadą to M02 (przez `MarkdownFileStore`); leniwi czytelnicy (rejestr skilli M37 na `.claude/skills`) współistnieją bez konfliktu (D4).
</after_change>

#### [pages/modules/m02-pages.md] M02 — Pages > Korzenie i rodzaje korzeni (L13) > Deklaracja rodzaju korzenia: `pages` (anchor `fjkog8wx`)
<after_change>
- **`kind`** — `pages`.
- **źródło** — konfiguracja: N korzeni użytkownika z `config.roots[]` (`id`, `name`, `dir`, `builtin`).
- **`dir`** — z konfiguracji.
- **sidebar** — `accordion`.
- **mapa plików** (wygrywa pierwszy pasujący wzorzec):
  1. `**/*.{md,mdx}` → markdown; kontrakt zmian: brak pól niezmiennych, frontmatter opcjonalny (<section_ref anchor="79f5jyrk"/>); tor wersji `file_version`;
  2. `**/*.html` → surowy; bez kontraktu; tor wersji `brak` (podgląd M30; nie jest stroną dla odkrywania).
- **flagi** — `release` tak, `references` tak, `gitignore` nie, `agentDirectFs` tak.
- **reakcje** — `m06-anchor-injection`, `m06-section-indexer`, `m02-frontmatter-indexer`, `m08-todos-indexer`, `m14-link-indexer`, `m14-rename-sync`, `m17-capture`.

</after_change>

#### [pages/modules/m02-pages.md] M02 — Pages > Korzenie i rodzaje korzeni (L13) > Model korzenia (anchor `l13model0`)
<after_change>
Korzeń jest wpisem rejestru `{ id, name, dir, kind, builtin }`, **nie** encją SQLite ani pluginem M13. Rejestr ma dwa źródła.

**Konfiguracja — korzenie użytkownika.** Wpisy `config.roots[]` (M01 <section_ref anchor="c0nf1g4a"/>) mają zawsze `kind: pages`. Wpis w pliku ma cztery pola:

```
id       — identyfikator korzenia (slug kebab), unikalny w obrębie projektu; wartość rootId
           w file_version i w kluczach (rootId, path). Wybiera go autor projektu — poza
           identyfikatorami korzeni ze źródłem `kod`. Zmienia się wyłącznie
           jawną operacją, nigdy w tle.
name     — wyświetlana etykieta (sidebar accordion, modal briefu), np. "Pages", "Docs".
dir      — katalog względem cwd (resolveSafe z M02, nie escapuje korzenia).
builtin  — boolean; dokładnie jeden wpis roots[] ma true i to on JEST korzeniem podstawowym,
           niezależnie od swojego id. Korzeń użytkownika dodany później ma false.
```

Wpis jest kompletny albo nieważny; pola spoza tych czterech są nieznanymi polami, które czytnik ignoruje (M26 <section_ref anchor="hozcm4w5"/>). Walidację `dir` — path-safety i zakaz nakładania się przestrzeni nazw — opisuje <section_ref anchor="m01rootsval"/>.

**Kod — korzenie systemowe.** Korzenie rodzajów ze źródłem `kod` są wpisami rejestru zarejestrowanymi w kodzie, po jednym na rodzaj: `id = kind` (identyfikator zastrzeżony), stały `dir` = `.claude4spec/<kind>`. Pole `sidebar` i obecność w UI wynikają z deklaracji rodzaju. Nie ma ich w `config.json` i nie da się ich przenieść. Konsument pytający o konkretny korzeń systemowy pyta rejestr o rodzaj, nigdy o katalog.

**Stała mapa korzenia użytkownika.** Każdy korzeń użytkownika ma mapę plików, flagi i reakcje rodzaju `pages` (<section_ref anchor="m02l13001"/>), a plik konfiguracji nie ma pól, które by je zmieniały: każdy korzeń stron ma pełny cykl życia — wydanie, indeks sekcji i graf referencji.

**Rola korzenia podstawowego mieszka we fladze `builtin`, nie w identyfikatorze.** Korzeń podstawowy jest nieusuwalny, ma landing i stronę powitalną. `id`, `name` i `dir` są od siebie niezależne — żadne nie wyprowadza się z pozostałych i żadne nie rozstrzyga, który korzeń jest podstawowy. Konsument pytający „czy to korzeń podstawowy” czyta `builtin`; konsument adresujący przestrzeń czyta `id`. `pages` jest wartością domyślną nadawaną nowemu projektowi, a nie tożsamością wymaganą do działania: projekt, w którym korzeń podstawowy nosi `id: docs`, jest w pełni poprawny.

**Przynależność pliku = położenie plus pierwszy pasujący wzorzec mapy rodzaju — nigdy nazwa ani rola.** Nie ma listy nazw wyjątkowych. Konsekwencja jest **świadoma, nie anomalna**: przy korzeniu o `dir: "."` pliki `CLAUDE.md` i `SKILL.md` leżące w tym katalogu są normalnie częścią przestrzeni stron — walker je indeksuje, a reakcja wstrzykiwania kotwic nadaje im kotwice, tak samo jak każdej innej stronie. To jest poprawne: oba są dokumentami specyfikacji, więc mają być czytelne przez operacje odkrywania i referowalne przez `<section_ref/>`. Gdyby istniała lista nazw wyjątkowych, każdy nowy plik konwencjonalny wymagałby edycji walkera.

**Przestrzeń nazw korzenia nie obejmuje poddrzew zaczynających się od kropki.** Przestrzeń korzenia to pliki pod `dir` z wyłączeniem poddrzew przechodzących przez segment zaczynający się od kropki — walker i tak ich nie odwiedza. Dlatego korzeń `.` współistnieje ze stałymi katalogami `.claude4spec/<kind>`, a korzeń `.claude/skills` z korzeniem `.`; nakładanie się przestrzeni nazw liczone w ten sposób jest błędem D4.

**`.html` należy do przestrzeni korzenia, ale nie jest stroną.** Plik `.html` jest wpisem surowym mapy rodzaju `pages` — pokazuje go drzewo korzenia (`listTree`) na potrzeby podglądu, a nie listing wpisów markdown `listMarkdownFiles` (<section_ref anchor="m02multidir"/>) — ale dla `list_pages`, `get_page` i `search_pages` stroną nie jest: nie dostaje kotwic (reakcje M06 przyjmują tylko markdown), nie ma wersji (tor `brak`) i operacje odkrywania nie mają dla niego adresu.
</after_change>

#### [pages/modules/m02-pages.md] M02 — Pages > Korzenie i rodzaje korzeni (L13) > Root Registry (`roots[]`) — fasada `PagesService` nad prymitywem per root (D9) (anchor `m02multidir`)
<after_change>
M02 trzyma rejestr korzeni `{ id, name, dir, kind, builtin }` (<section_ref anchor="l13model0"/>) — korzenie użytkownika z per-projekt configu (M01) i korzenie systemowe z kodu — i buduje **fasadę `PagesService` per korzeń rodzaju z `sidebar` innym niż `hidden`**, każdą nad **prymitywem `MarkdownFileStore`** (D9), oba **parametryzowane `{ rootId, dir }`** w konstruktorze. Prymityw jest **generyczny** (agnostyczny wobec rodzaju korzenia): `MarkdownFileStore` daje CRUD+frontmatter+sha256 (<section_ref anchor="gnxw0ua1"/>). Obserwację katalogu wnosi **M40** — implementor montuje u niego źródło każdego korzenia, nie konstruuje watchera. `PagesService` to **fasada korzeni z drzewem w sidebarze** dokładająca tree resolution i egzekwowanie flag L13 — **nie istnieją instancje `PagesService` poza korzeniami rodzajów z `sidebar` innym niż `hidden`**.

Root podstawowy to zwykły wpis `roots[]` z flagą `builtin: true` i identyfikatorem wybranym przez autora — domyślnie `pages`; rejestr rozpoznaje go po tej fladze, nigdy po wartości identyfikatora. Korzenie użytkownika (np. `.claude/skills` jako „Claude skills") dokładają kolejne fasady. **Korzenie systemowe są wpisami tego samego rejestru** — dla rodzajów z wpisami markdown (`plans`, `briefs`, `patches`) implementor buduje skład plików korzenia: instancję prymitywu `MarkdownFileStore` bez fasady, z której korzysta rodzina odczytu M36. Źródła zdarzeń wszystkich korzeni montuje implementor (<section_ref anchor="m02l13001"/>). Orchestracja żyje **przy budowie `ProjectContext`** (M31/L10), nie przy starcie procesu — `dir` korzeni użytkownika rozwiązywany z **per-projekt** configu tego kontekstu, więc każdy projekt workspace dostaje własny zestaw:

<single_element type="code-snippet" slug="page-root-runtime-construction" caption="Pętla po rejestrze korzeni przy budowie ProjectContext"/>

`listMarkdownFiles(rootId)` skanuje `dir` konkretnego korzenia **wyłącznie po wpisach markdown** mapy jego rodzaju (dla rodzaju `pages`: `*.md`/`*.mdx`). To listing, po którym chodzi każdy czytelnik treści stron — indekser sekcji i wstrzykiwanie kotwic (M06), M08, M14, M19, początkowa synchronizacja `file_version` (M17), indekser frontmattera i wyszukiwanie stron — a żadnemu z nich nie wolno czytać wpisu surowego. Wpis surowy `*.html` (tor `brak`) pokazuje **drzewo korzenia** — `service(rootId).listTree()`, które nadaje węzłom `fileType` z mapy rodzaju (<section_ref anchor="e16qvg1n"/>). Oba walki są **per-root**, więc ta sama `relPath` w dwóch rootach to dwa różne pliki — **tożsamość pliku to `(rootId, relPath)`**, nie sama `relPath`.

Wszystkie korzenie z wpisami na torze `file_version` — korzenie `kind: pages` **oraz** korzenie `plans`, `briefs` i `patches` — zasilają **wspólny `FileVersionService` z M17** (D10, keyed `(rootId, path)`, patrz M17). `rootId` to zawsze id wpisu rejestru: id korzenia stron albo `'plans'` / `'briefs'` / `'patches'` dla korzeni systemowych. Tabela `file_version` traktuje plik z dowolnego źródła jednakowo — capture, release assignment, restore działają bez modyfikacji. `M17.releaseService.assignToRelease()` filtruje `WHERE rootId IN (korzenie kind: pages)`, więc przejmuje wpisy wszystkich korzeni stron, a korzenie systemowe — rodzaje bez `release` — są z natury wykluczone.

**Artefakty żyją w korzeniach systemowych** rodzajów z `sidebar: hidden` (poza accordionem); każdy korzeń wchodzi do sidebaru tablicą akordeonów swojego rodzaju (<section_ref anchor="m02l13001"/>). Stały katalog nie może nachodzić na korzeń stron (D4, <section_ref anchor="l13model0"/>), więc `listTree()` żadnego korzenia stron nie filtruje artefaktów.

Separacja per korzeń:
- `service(rootId).listTree()` → drzewo korzenia z fasadą.
- Listing artefaktów **nie** idzie przez fasadę `PagesService` — rodzina odczytu M36 korzysta ze składów korzeni `plans`, `briefs` i `patches`, konsumowanych przez M21/M23/M10, oraz z `findByFrontmatterType('brief'|'patch'|'plan')` na współdzielonym `FrontmatterIndexer`.

**Debounce niezależny per mount** — szybkie zapisy w jednym korzeniu nie blokują reakcji w innym; mechanika należy do M40.


**Przemianowanie przestrzeni — rozstrzygnięcie tożsamości i przełączenie rejestru.** Przemianowanie dotyczy korzeni użytkownika; identyfikatory korzeni systemowych są stałe. Rejestr jest jedynym miejscem, które wie, która przestrzeń odpowiada dziś pod danym adresem, więc jawna zmiana identyfikatora — kontrakt i walidacja należą do M01 (<section_ref anchor="fgt8k6gc"/>) — pyta go o dwie rzeczy: czy przestrzeń źródłowa istnieje i czy docelowy identyfikator jest **wolny**. Wolny znaczy tu „nieobecny w `roots[]` **i** niewycofany wcześniejszym przejściem": adres raz wydany nie może zacząć wskazywać innej przestrzeni, bo `(rootId, relPath)` jest tożsamością pliku i w zapisanych wersjach już tę parę utrwalono.

Przełączenie jest **odmontowaniem i zamontowaniem, nie podmianą pola**: fasada i zamówione dla niej źródło są kluczowane identyfikatorem rootu, więc para pod starym kluczem przestaje istnieć, a nad tym samym `dir` powstaje para pod nowym. Katalog, pliki i wstrzyknięte w nie anchory nie są przy tym dotykane — przemianowanie zmienia adres przestrzeni, nie jej treść, więc żaden zapis pliku się tu nie odbywa. Po przełączeniu zapytanie o identyfikator spoza `roots[]` odpowiada błędem jak dotąd — w szczególności stary identyfikator nie jest cichym aliasem nowego.

Samego kontraktu operacji rejestr nie posiada i nie montuje dla niej trasy: wykonuje rozstrzygnięcie i przełączenie na żądanie właściciela konfiguracji, który odpowiada za walidację wyniku, utrwalenie nowej listy rootów i zapis przejścia.
</after_change>

### m30-static-html.md context offset 1 limit 4
#### [pages/modules/m30-static-html.md] M30 — Static HTML Pages > Cel (anchor `z7k52855`)
<after_change>
Użytkownik ogląda statyczne pliki HTML leżące obok stron markdown — makiety i prototypy interfejsu, wygenerowane raporty, zaimportowaną dokumentację, treść nie do wyrażenia w markdown — w tym samym drzewie plików, bez wychodzenia z aplikacji. Klik na taki plik montuje w środkowym panelu sandboksowany iframe z surową treścią zamiast edytora.

Podgląd jest read-only w każdym calu: moduł nie wprowadza tworzenia, edycji ani usuwania takich plików w interfejsie i nie uczestniczy w wydaniach specyfikacji.
</after_change>

#### [pages/modules/m30-static-html.md] M30 — Static HTML Pages > Zależności (anchor `zqehkg0f`)
<after_change>
Ten moduł jest bezstanowym serwerem plików statycznych — nie wnosi własnego składu ani własnego nasłuchu, więc każdy element jego działania bierze z zewnątrz.

<tagged_list type="module-dependency" tags="m30"/>
</after_change>

#### [pages/modules/m30-static-html.md] M30 — Static HTML Pages > Domain (L2) (anchor `iqp1idox`)
<after_change></after_change>

#### [pages/modules/m30-static-html.md] M30 — Static HTML Pages > Domain (L2) > `staticHtmlService` (anchor `1he8gddx`)
<after_change>
**Own L2 M30** (nie współdzielony helper M02). Odpowiada za rezolucję ścieżki pliku względem `dir` **rootu wskazanego przez `:rootId`** (L13) z **path-traversal guard**: reuse jedynie *wzorca* `resolveSafe` z M02 `pages.ts` — skopiowana konwencja, nie wspólna funkcja (czysta granica slice'a). `dir` bierze z Root Registry M02 (<section_ref anchor="m02multidir"/>) po `rootId`, nigdy nie hardcoduje jednego `pagesDir`. Serwuje **dowolny** plik spod `dir` tego rootu z `Content-Type` ustalanym przez **mime lookup po rozszerzeniu** — bez zamkniętej whitelisty rozszerzeń.

- Wejście: `rootId` (segment trasy) + relatywna ścieżka pliku (splat trasy `/api/static/:rootId/*`).
- `rootId` spoza `roots[]` → `404 ROOT_NOT_FOUND` (bez cichego fallbacku na `pages`).
- Guard: ścieżka rozwiązana i znormalizowana musi pozostać wewnątrz `dir` rozwiązanego rootu; próba wyjścia (`../`, ścieżki absolutne) → błąd 403.
- Plik nieistniejący → 404.
- Sukces → surowe bajty + `Content-Type` z mime lookup po rozszerzeniu.

</after_change>

### m30-static-html.md context offset 12 limit 1
#### [pages/modules/m30-static-html.md] M30 — Static HTML Pages > Korzenie i rodzaje korzeni (L13) (anchor `m30l13rt`)
<after_change>
M30 to **konsument** L13 (schema: `layers/L13-page-roots.md` <section_ref anchor="l13slice0"/>). Nie wnosi własnego rodzaju ani własnej deklaracji — wpis `**/*.html` należy do mapy plików rodzaju `pages` (<section_ref anchor="fjkog8wx"/>). Podgląd jest więc dostępny w **każdym korzeniu tego rodzaju**, a rezolucja ścieżki liczona jest względem `dir` tego korzenia (model korzenia — <section_ref anchor="l13model0"/>):

- **Keyed flag** — rodzaj `pages`: plik `.html` jest wpisem mapy tego rodzaju, więc jest skanowany i podglądany w każdym jego korzeniu, obok stron markdown. Żadnej z czterech flag M30 nie czyta. Guard rezolwuje względem `dir` korzenia węzła.
- **Root iteration** — korzenie rodzaju `pages` (nie tylko korzeń podstawowy); wpis `.html` każdego takiego korzenia pokazuje drzewo korzenia M02 (`service(rootId).listTree()`, `fileType` z mapy rodzaju — <section_ref anchor="m02multidir"/>), nie listing wpisów markdown `listMarkdownFiles(rootId)`.
- **Gated behavior** — trasa serwująca surowy plik niesie `:rootId` (`/api/static/:rootId/*`); path-traversal guard resolwuje ścieżkę względem `dir` **rozwiązanego** korzenia, nie jednego katalogu. `HtmlViewer` montuje się na space-aware trasie `/space/:rootId/$` gdy `fileType === 'html'`.
- **Key shape** — tożsamość podglądanego pliku to `(rootId, relPath)`: ta sama `relPath` (`report.html`) może istnieć w wielu korzeniach i wskazuje różne pliki. `:rootId` (segment trasy) + splat (`relPath`) jednoznacznie adresują plik.
- **No-hardcode assert** — M30 nie czyta katalogu z klucza konfiguracji, nie trzyma listy katalogów, nie ma gałęzi `if (dir === 'pages')`, nie rozpoznaje korzenia podstawowego po `id` (tylko po `builtin`) ani korzenia jednokorzeniowego rodzaju po `id` (tylko po `kind`) i nie zakłada pojedynczego korzenia: `staticHtmlService` bierze `dir` z rejestru korzeni M02 po `rootId`, a `rootId` spoza korzeni rodzaju `pages` → `404 ROOT_NOT_FOUND` (bez cichego fallbacku).

`.html` leży w drzewie korzenia jako wpis surowy, ale stroną nie jest (<section_ref anchor="l13model0"/>): pozostaje read-only, w sandboxowanym iframe, **bez** kotwic, wersji i indeksowania (M06/M17/M19) — reakcje tych modułów przyjmują wyłącznie wpisy markdown albo wpisy z torem `file_version`, a tor wersji wpisu `.html` to `brak`.
</after_change>

## Criteria (ac)
```json
[
 {
  "type": "ac",
  "slug": "ac-plik-html-lezacy-w-korzeniu-stron-jes",
  "name": "Plik `.html` leżący w korzeniu stron jest widoczny w drzewie tego korzenia, ale `list_pages` go nie zwraca.",
  "op": "update",
  "before": {
   "slug": "ac-plik-html-lezacy-w-korzeniu-stron-jes",
   "title": "Plik `.html` leżący w korzeniu stron jest widoczny w drzewie tego korzenia, ale `list_pages` go nie zwraca.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "m02"
   ],
   "createdAt": "2026-10-05T15:23:25.238Z",
   "updatedAt": "2026-10-05T15:23:25.238Z"
  },
  "after": {
   "slug": "ac-plik-html-lezacy-w-korzeniu-stron-jes",
   "title": "Plik `.html` leżący w korzeniu stron jest widoczny w drzewie tego korzenia, ale `list_pages` go nie zwraca.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "type": "mcp-tool",
     "slug": "reference-tools-list-pages"
    }
   ],
   "tags": [
    "m02"
   ],
   "createdAt": "2026-10-05T15:23:25.238Z",
   "updatedAt": "2026-10-09T09:54:40.642Z"
  }
 }
]
```

## Linked entities at 2.1.14 (context, not built)
```json
[
 {
  "type": "mcp-tool",
  "slug": "reference-tools-list-pages",
  "name": "list_pages",
  "op": "create",
  "after": {
   "slug": "reference-tools-list-pages",
   "title": "reference-tools · list_pages",
   "name": "list_pages",
   "server": "reference-tools",
   "description": "List the pages of one root, paginated — the domain replacement for globbing the specification. Give it a `rootId`, narrow with `prefix`, order with `sort`. Use it to find out what pages exist before reading any of them. It lists what the index knows: files sitting on disk that the index has never seen are not reported here, and that drift question belongs to `check_consistency` instead. There is no `view` parameter — view projections apply to entity operations only. Read `total` and `hasMore`: the result is a page of a list, not the list.",
   "params": [
    {
     "description": "Which page root to list.",
     "name": "rootId",
     "required": true,
     "type": "string"
    },
    {
     "description": "Restrict to paths starting with this prefix.",
     "name": "prefix",
     "required": false,
     "type": "string"
    },
    {
     "description": "Ordering of the result: by path or by modification time.",
     "name": "sort",
     "required": false,
     "type": "enum(path, modified)"
    },
    {
     "description": "Page size.",
     "name": "limit",
     "required": false,
     "type": "number"
    },
    {
     "description": "Page offset.",
     "name": "offset",
     "required": false,
     "type": "number"
    }
   ],
   "returns": "Strona listy stron danego roota wraz z `total` i `hasMore`. Zwrotka nie niesie treści stron, ich sekcji ani plików nieznanych indeksowi — rozjazd dysk↔indeks raportuje `check_consistency`.",
   "sampleReturn": null,
   "readOnlyHint": null,
   "destructiveHint": null,
   "idempotentHint": null,
   "openWorldHint": null,
   "logic": "Operacja stronowa rdzenia M39; `reference-tools` jest wyłącznie jej transportem MCP — reżimy tożsamości, paginacja, budżet i adresowalność wyłącznie korzeni `kind: pages` są własnością rdzenia, serwer może zestaw operacji zawęzić, nigdy rozszerzyć. Wymaga `rootId`; `prefix` zawęża po ścieżce, `sort` wybiera porządek między ścieżką a czasem modyfikacji. Świadomie brak parametru `view` — projekcje widoku dotyczą wyłącznie operacji na encjach. Świadomie brak trybu wykrywania rozjazdu dysk↔indeks: to pytanie ma dom w `check_consistency`, nie w narzędziu listującym strony.",
   "tags": [
    "m39"
   ],
   "createdAt": "2026-08-19T12:56:19.406Z",
   "updatedAt": "2026-10-05T16:36:14.911Z"
  }
 }
]
```

## Conventions — L13 (Korzenie i rodzaje korzeni)
#### [pages/layers/L13-page-roots.md]  > L13 — Korzenie i rodzaje korzeni (anchor `l13top001`)
<after_change>
> Konwencja, w której moduł obsługujący pliki specyfikacji albo **wnosi rodzaj korzenia** — dopisuje wartość do enumu rodzajów i deklaruje jej mapę plików, flagi i reakcje L7 — albo deklaruje, **którą flagę lub który rodzaj czyta**, zamiast wskazywać katalog.

</after_change>
#### [pages/layers/L13-page-roots.md] L13 — Korzenie i rodzaje korzeni > Role in the system (anchor `l13role01`)
<after_change>
L13 jest warstwą framework-shaped. Implementor:

- trzyma rejestr korzeni — korzenie z konfiguracji oraz korzenie zarejestrowane w kodzie;
- składa enum rodzajów z deklaracji modułów;
- rozstrzyga typ pliku z mapy rodzaju;
- egzekwuje flagi w jednym miejscu;
- montuje źródło zdarzeń każdego korzenia, podpina do niego reakcje L7 wybrane przez rodzaj, waliduje ich wymagania i dokłada reakcję bazową o zmianie pliku.

Warstwa nie definiuje transportu, routingu, wersjonowania ani indeksowania. Ustala wyłącznie kontrakt: **każde zachowanie per plik jest bramkowane flagą albo rodzajem korzenia, nigdy katalogiem ani identyfikatorem**.

</after_change>
#### [pages/layers/L13-page-roots.md] L13 — Korzenie i rodzaje korzeni > Module slice schema (anchor `l13slice0`)
<after_change>
Sekcja `## Korzenie i rodzaje korzeni (L13)` modułu odpowiada na poniższe pola. Wariant `## Korzenie i rodzaje korzeni (L13) — n/d` zachowuje sufiks. Każde pole to deklaracja „jaki rodzaj korzenia wnoszę” albo „którą flagę lub który rodzaj czytam”, nie opis funkcjonalny modułu.

```
Deklaracja rodzaju korzenia — wypełnia WYŁĄCZNIE moduł wnoszący rodzaj; jeden blok na rodzaj:
  kind         — nowa wartość enumu rodzajów (kebab, liczba mnoga), unikalna w enumie.
                 Rodzaj o jednym korzeniu: kind = id korzenia, identyfikator zastrzeżony.
  źródło       — konfiguracja (N korzeni użytkownika: id, name, dir, builtin)
                 | kod (dokładnie jeden korzeń)
  dir          — dla źródła „kod”: stały `.claude4spec/<kind>`, poza plikiem konfiguracji
  sidebar      — hidden | accordion | reduktor. Reduktor podaje glob wejścia i regułę
                 wyliczenia akordeonów; kontrakt w akapicie „Pole sidebar” pod blokiem.
  mapa plików  — uporządkowana lista: wzorzec → format (markdown | json | surowy),
                 kontrakt zmian (markdown: pola nagłówka niezmienne / zmienne;
                 json: schemat rekordu albo odesłanie do jego źródła),
                 tor wersji (file_version | entity_version | HEAD | brak).
                 Wygrywa pierwszy pasujący wzorzec.
  flagi        — cztery wiersze: release / references / gitignore / agentDirectFs → tak | nie.
                 Stałe dla rodzaju, nie ma ich w konfiguracji. Polityki czytane na żądanie;
                 żadna nie bramkuje reakcji.
  reakcje      — lista stabilnych identyfikatorów reakcji L7, które biegną na plikach
                 korzeni rodzaju. Każda przyjmuje format co najmniej jednego wpisu mapy,
                 a jej wymagania (inne reakcje, flagi) są spełnione w tej samej deklaracji.
                 Reakcji bazowej się nie wymienia.

Keyed flag         — którą flagę (release / references / gitignore / agentDirectFs), który
                     rodzaj (kind) albo które źródło rodzaju (konfiguracja | kod) czyta
                     konsument. Wymienić konkretną.
Root iteration     — „korzenie rodzaju K”, „korzenie rodzajów ze źródłem Z”
                     (Z = konfiguracja | kod), „korzenie rodzajów z flagą F” albo „korzenie
                     rodzajów, które wybrały reakcję R”.
                     NIGDY samo „pages”, katalog, lista katalogów ani wyliczenie
                     identyfikatorów korzeni ze źródłem kod.
Gated behavior     — co flaga albo rodzaj włącza lub wyłącza per plik albo per katalog korzenia;
                     obserwowalny efekt, nie flaga.
Key shape          — gdy moduł keyuje stan per plik: klucz niesie rootId, np. (rootId, path).
No-hardcode assert — jedno zdanie: moduł nie czyta katalogu z klucza konfiguracji, nie trzyma
                     listy katalogów, nie rozpoznaje korzenia podstawowego po id (tylko builtin)
                     ani korzenia jednokorzeniowego rodzaju po id (tylko kind). Obowiązkowe.
```

**Słownik flag** — po jednym zdaniu na flagę:

- `release` — plik wchodzi do wydania swoim torem wersji.
- `references` — plik należy do grafu referencji do encji i sekcji: jest walidowany, przeszukiwany i przepisywany przy zmianie nazwy. Działa wyłącznie na wpisach w formacie markdown.
- `gitignore` — przy wyłączonej synchronizacji git katalog korzenia trafia do zarządzanego bloku ignorowanych.
- `agentDirectFs` — wartość `nie` wyłącza katalog korzenia z bezpośredniego dostępu plikowego agenta.

**Reguły stosowania.** `references` dotyczy wyłącznie wpisów mapy w formacie markdown. `release` dotyczy wyłącznie wpisów z torem wersji innym niż `brak`. Reakcja wybrana przez rodzaj działa wyłącznie na wpisach mapy w formatach, które przyjmuje, a jej kontrakt przyjęcia stoi w jej wierszu warstwy L7.

**Pole `sidebar`.** Wartość mówi, jak korzeń rodzaju wchodzi do drzewa stron w sidebarze. Postacią ogólną jest reduktor: reguła, która z zawartości korzenia wylicza uporządkowaną tablicę akordeonów. `hidden` i `accordion` to jej przypadki szczególne i nie deklarują reguły.

- **Wejście:** ścieżki wszystkich plików korzenia oraz sparsowany frontmatter plików pasujących do globu, który deklaruje reduktor. Treść plików nie wchodzi do wejścia.
- **Wynik:** uporządkowana tablica elementów `{ key, label, path }`:
  - `key` — stabilny identyfikator akordeonu; trzyma stan rozwinięcia w UI;
  - `label` — etykieta akordeonu;
  - `path` — poddrzewo w korzeniu; `''` oznacza cały korzeń;
  - kolejność tablicy jest kolejnością akordeonów w sidebarze.
- **Przypadki szczególne:** `hidden` daje pustą tablicę, a `accordion` jeden element `{ key: id korzenia, label: name korzenia, path: '' }`.
- **Reguły wyniku:**
  - `path` leży w obrębie korzenia, `key` jest unikalny w tablicy, a poddrzewa są rozłączne;
  - element łamiący regułę jest pomijany z ostrzeżeniem;
  - plik poza wszystkimi poddrzewami nie ma miejsca w sidebarze, ale nadal należy do korzenia: ma swój tor wersji i podlega flagom rodzaju.
- **Wymagania wypełniania:**
  - właściciel rodzaju z reduktorem podaje w bloku deklaracji glob wejścia oraz regułę wyliczenia `key`, `label`, `path` i kolejności;
  - reguła wylicza wynik wyłącznie z wejścia;
  - ikona, opis i znaczniki akordeonu nie są polami wyniku.

**Obowiązkowość pól:**

- Moduł wnoszący rodzaj wypełnia `Deklaracja rodzaju korzenia`, w tym `reakcje`, oraz `No-hardcode assert`.
- Konsument wypełnia `Keyed flag`, `Root iteration` i `No-hardcode assert`. `Key shape` jest wymagany tylko przy stanie kluczowanym per plik.
- Moduł bywa jednocześnie właścicielem rodzaju i konsumentem cudzego.
- Moduł, którego reakcję wybiera rodzaj, nie staje się przez to konsumentem L13: jego wiersz L7 niesie kontrakt przyjęcia. Konsumentem jest, jeśli czyta flagę albo iteruje korzenie.
- Moduł, który nie spełnia żadnego z powyższych, ma `— n/d` z jednym zdaniem.
- Moduł, który tylko przenosi klucz `(rootId, path)` nadany gdzie indziej, sekcji nie ma; jego tekst nazywa wtedy klucz, nie warstwę.

**Wymagania wypełniania:** konsument nie przepisuje wartości flag ani mapy plików cudzego rodzaju — odsyła do deklaracji rodzaju u jej właściciela.

**Reading mode — implementor.** Sekcja tej warstwy w module-implementorze jest czytana w how-mode, nie jako wypełnienie schematu. Opisuje:

- rejestr korzeni z dwoma źródłami;
- enum rodzajów jako sumę deklaracji;
- rozstrzyganie typu pliku z mapy;
- egzekwowanie flag z regułami stosowania;
- montaż źródeł, wiązanie reakcji z deklaracji, walidację wymagań i reakcję bazową o zmianie pliku;
- walidację nakładania się przestrzeni nazw;
- wywołanie reduktorów `sidebar`, przeliczanie ich wyniku, fallback i dostarczenie tablicy akordeonów do UI.

> **Implementor module:** `M02 — Pages (Root Registry)`
</after_change>

## Stubs
None to close; none opened.

## Not yet
None.

## Completes
None.

## Remove
- The `.html` scan through the markdown listing (`listMarkdownFiles(rootId)`): m02 `e16qvg1n` and m30 `m30l13rt` before-texts — `.html` entries now come from `service(rootId).listTree()`; `listMarkdownFiles` returns markdown entries only.
