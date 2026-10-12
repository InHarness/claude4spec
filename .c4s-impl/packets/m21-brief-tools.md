# Packet — unit m21-brief-tools

- window: 2.1.13 → 2.1.14 (delta)
- unit: m21-brief-tools
- goal: Narzędzia briefu w wątku briefu tracą parametr ścieżki, bo zakres wątku niesie sam brak parametru. Kanały cli, mcp i rest nadal wymagają ścieżki. Edycja briefu przyjmuje dokładnie jeden z dwóch kształtów: akcję z treścią albo listę dosłownych podmian. Oba naraz albo żaden to błąd walidacji przed dotknięciem pliku. Przy podmianach odpowiedź niesie liczbę zastąpień, a podsumowanie zmiany jest opcjonalne. Usunięty jest parametr ścieżki w kanale wewnętrznym.
- layers touched: L2 (briefService), L3 (operation catalog / profiles, MCP brief-tools), L4 (REST), L14 (CLI); L13 context (briefs root)
- entities: 4 mcp-tool (built), 1 spreadsheet per-entity (katalog-operacji-m21, 7 built items), 2 ac, 1 linked database-table (context)
- criteria: 2 (ac; spreadsheet part is built, no criteria items)
- jobs: none
- packet size: ~117182 bytes

## Change (2.1.13 → 2.1.14) — pages/modules/m21-briefs.md

### change offset 0 limit 1 (m21srvct)

#### [m21srvct] M21 — Briefs > Domain (L2)


`briefService` (5 metod) to **cienki wrapper slice'u** nad składem plików korzenia `briefs` — storage (`MarkdownFileStore`) buduje implementor L13 (<section_ref anchor="m02l13001"/>), a wersjonowanie (`FileVersionService`, `file_version`) i indeks (`FrontmatterIndexer`) to reakcje wybrane przez rodzaj `briefs` (<section_ref anchor="m21l13rt"/>); generyczne CRUD (read/write content, PATCH frontmatter, versions) idzie przez rodzinę REST `/api/artifacts/brief/...` (<section_ref anchor="m36l4001"/>). `briefService` dokłada **tylko logikę briefu** (slug, okno release'ów, `roots`, walidacja release'ów) i wiązanie wątków. Zero wlasnej tabeli, zero wlasnego storage'u:

| Metoda | Sygnatura | Implementacja |
|--------|-----------|---------------|
| `createBrief` | `({ fromReleaseName?, toReleaseName, roots?, content?, suffix? }) → { briefPath }` | **File-only** (NIE tworzy watku). Generuje slug (**scope `roots` wchodzi do sluga**, patrz <section_ref anchor="m21fmtct"/>), zapis przez skład plików korzenia `briefs` z frontmatter (**`roots`** gdy przekazane, inaczej omit = caly release; **explicit `implemented: false`** jako default state) + `content` (jezeli podany — pelne cialo briefu zapisywane **verbatim**, niepuste po trim albo `VALIDATION` i plik nie powstaje; pominiete = plik z samym `# Heading`, ktorego tresc dopisze osobna tura), capture `create` przez `FileVersionService` (`rootId = 'briefs'`). **`roots` (L13, <section_ref anchor="m21l13rt"/>):** opcjonalna tablica rootId-ow (scope przestrzeni stron z modala tryb b) — zapisywana **verbatim** do frontmatter jako immutable identity; `createBrief` **NIE** partycjonuje na N plikow (jeden brief = jeden plik, niezaleznie od liczby rootow). **Walidacja:** `from===null && to===null` → 400 `VALIDATION`; `BRIEF_SAME_RELEASE` **tylko gdy oba non-null** i rowne; `fromReleaseName` domyslnie = **latest** przez `releaseService.list()` gdy nieprzekazany; `to===null` jest **poprawne samo z siebie** — znaczy „okno otwarte do stanu biezacego", nie brak danych (<section_ref anchor="m21fmtct"/>). Tworzenie watku — osobno przez `createThreadForBrief` (rozszczepienie, patrz <section_ref anchor="m21m17ax"/> i M05 dispatcher) |
| `getBrief` | `({ path }) → { frontmatter, body, content, hash }` | Read ze składu plików korzenia `briefs` + sha256 contentu |
<before_change>| `updateBrief` | `({ path, action, content, anchor?, heading?, expectedHash?, changeSummary?, changedBy: 'agent' \| 'user' }) → { newHash }` | Wrapper na zapis składu plików korzenia `briefs` + capture `update` przez `FileVersionService`. Walidacja immutable frontmatter fields (w tym **`roots`** — L13 scope, chroniony jak `from_release`/`to_release`) **plus blokada `implemented`** gdy `changedBy='agent'` (analog immutable fields — agent w UI nie deklaruje "skonczone"). Optimistic concurrency po `expectedHash` (sha256 contentu) — niezgodnosc → 409 |</before_change>
<after_change>| `updateBrief` | `({ path, action?, content?, textEdits?, anchor?, heading?, expectedHash?, changeSummary?, changedBy: 'agent' \| 'user' }) → { newHash, replacements? }` | Dokładnie jeden kształt wejścia: `action` + `content` albo `textEdits` (<section_ref anchor="01ytpznn"/>). Wrapper na zapis składu plików korzenia `briefs` + capture `update` przez `FileVersionService`. Walidacja immutable frontmatter fields (w tym **`roots`** — L13 scope, chroniony jak `from_release`/`to_release`) **plus blokada `implemented`** gdy `changedBy='agent'` (analog immutable fields — agent w UI nie deklaruje "skonczone"). Optimistic concurrency po `expectedHash` (sha256 contentu) — niezgodnosc → 409 |</after_change>
| `listBriefs` | `({ implemented? }) → BriefListItem[]` | Query `frontmatterIndexer.findByFrontmatterType('brief')` (zawężone do korzenia rodzaju `briefs`) + opcjonalny filter po `implemented` z odczytanego frontmatter. Brak pola `implemented` we frontmatter → traktowane jako `false`. `implemented` nieprzekazane → zwraca wszystkie. Zwraca listę w porządku osi wydań (<section_ref anchor="0kz2u8g7"/>) — kolejność liczy serwis, nie kanał |
| `createThreadForBrief` | `({ path, name?, parentThreadId?, spawnedByToolUseId? }) → { threadId }` | Insert `chat_thread` z `context_type='brief'`, `brief_path=path`. **Invariant:** kazdy thread tworzony z `brief_path` ma `context_type='brief'`. `parentThreadId` / `spawnedByToolUseId` (oba opcjonalne, default NULL) — gdy watek jest **banka** zrodzona przez <inline_mention type="mcp-tool" slug="transagent-tools-runtransagent"/> (M46), linkuja go z rodzicem (render nested live-join, reconstruction; <section_ref anchor="us5ee75g"/> w `modules/m46-transagent.md`). Bez nich → watek top-level (klasyczny brief-thread z UI). **Jedyne miejsce zakladajace brief-thread** — UI „New brief" i dispatcher M05 obie ida tedy (po rozszczepieniu `createBrief`) |


**`BRIEF_SAME_RELEASE` porównuje NAZWY — i to jest porównanie tożsamości, nie porównanie napisów.** Okno briefu adresuje release'y wyłącznie nazwą: `fromReleaseName` / `toReleaseName` w L2, to samo w <inline_mention type="dto" slug="brief-create-request"/> i <inline_mention type="endpoint" slug="post-api-briefs"/>, to samo we flagach `--from` / `--to` w CLI (<section_ref anchor="xqksf67f"/>) i w modalu „Generate brief" (<section_ref anchor="m21m17ax"/>). Numerycznego końca okna **nie ma w żadnym z tych kanałów** — okno briefu adresuje release'y nazwą, tak jak każda operacja release'owa, z <inline_mention type="mcp-tool" slug="release-tools-release-diff"/> włącznie (M17 <section_ref anchor="m17api001"/>), więc „ten sam release podany raz numerem, raz nazwą" nie jest tu stanem osiągalnym. A ponieważ `spec_release.name` jest `UNIQUE NOT NULL` i jest **publicznym identyfikatorem** release'u (M17 <section_ref anchor="34xy2eei"/>), dwie równe nazwy **są** jednym release'em. Walidacja porównuje zatem nazwy **bez resolucji na id**: rozwiązywanie obu końców tylko po to, żeby je zestawić, kosztowałoby dwa lookupy przed walidacją i odwróciłoby kolejność błędów — „release nie istnieje" wyprzedzałoby `BRIEF_SAME_RELEASE`, choć wołający pomylił się wcześniej i w czym innym. Równość jest **case-sensitive**, bo `UNIQUE` na `name` też jest (brak `COLLATE NOCASE`), i liczona **po trim**, bo trim jest normalizacją zapisu nazwy w M17 (<section_ref anchor="hybasevj"/>) — dzięki temu walidacja okna i unikalność nazwy rozstrzygają **tę samą** równość, a nie dwie podobne.

**`to === null` nie jest luką w walidacji, tylko znaczeniem otwartego okna.** `null` po stronie `to` nie jest brakującym release'em — jest **stanem bieżącym** (<section_ref anchor="m21fmtct"/>), punktem osi czasu, który z definicji nie jest żadnym release'em, więc nie ma z czym go zrównać. Pominięcie porównania przy `to===null` jest więc konsekwencją kontraktu okna, nie przeoczeniem: brief `from=latest, to=null` — jedyna droga briefu wobec stanu bieżącego — ma tę walidację przechodzić (<inline_mention type="ac" slug="ac-brief-source-analysis-utworzony-przez-di"/>). Sytuacja, której `BRIEF_SAME_RELEASE` faktycznie broni, to okno **domknięte** o zerowej rozpiętości; przy otwartym końcu rozpiętość jest niepusta z definicji.


### change offset 2 limit 1 (01ytpznn)

#### [01ytpznn] M21 — Briefs


M21 jest rdzeniem-właścicielem **operacji nad briefem** — odczytu, listowania, edycji, osi wersji i jedynego mutable pola frontmatteru.

<single_element type="spreadsheet" slug="katalog-operacji-m21" caption="Siedem operacji briefu, wszystkie bezpośrednie — treść briefu podaje ten, kto ma kontekst, a nie tura powołana po to, żeby go zgadnąć"/>

<before_change>**`get_brief` przyjmuje `path` opcjonalnie: `get_brief({ path? })`.** Opcjonalność jest **obroną ergonomii kanału wewnętrznego** — agent wbudowany pracuje wewnątrz wątku zakotwiczonego w briefie, więc default pochodzi z `chat_thread.brief_path` i schemat nie niesie pola, którego agent nie potrzebuje. Jawność jest **warunkiem wołalności z zewnątrz** — wołający z `cli`, `mcp` i `rest` nie ma wątku, z którego dałoby się wyprowadzić adres, więc podaje `path` wprost. Wiązanie artefaktu przez wątek jest renderowaniem kanału `internal`, nie kontraktem operacji (reguła `explicit-addressing`, <section_ref anchor="bpejzx03"/>); ta sama reguła obejmuje `update_brief`, `mark_brief_implemented` i obie operacje wersji.</before_change>
<after_change>**Adres briefu: w kanale `internal` nieobecny, w kanałach zewnętrznych wymagany — wyjątek izolacji.** M21 deklaruje, że wątek `context_type='brief'` **widzi wyłącznie brief, do którego jest przypięty** (`chat_thread.brief_path`). Dlatego schemat wewnętrzny operacji briefu **nie ma** parametru `path`: adres jest domknięty z wątku, a izolację niesie właśnie brak parametru — parametr opcjonalny byłby defaultem, a default nie izoluje (reguła `explicit-addressing`, wyjątek izolacji, <section_ref anchor="bpejzx03"/>). Izolacja jest tu tym samym mechanizmem jakości co wąska powierzchnia profilu: agent-autor ma widzieć swój brief i historyczny diff, a nie inne artefakty. Wołający z `cli`, `mcp` i `rest` nie ma wątku, z którego dałoby się wyprowadzić adres, więc podaje `path` wprost — kanałów zewnętrznych wyjątek nie dotyczy. Deklaracja obejmuje `get_brief`, `update_brief`, `mark_brief_implemented` i obie operacje wersji.</after_change>

<before_change>**`get_brief` ma okno odczytu — `get_brief({ path?, range? })`.** `range` jest **oknem linii** rodziny odczytu artefaktów (M36 <section_ref anchor="9p8nltkf"/>): rodzaj `briefs` nie wybiera `m06-section-indexer` (<section_ref anchor="m21l13rt"/>), więc brief nie ma indeksu sekcji, a droga wznowienia `get_page_outline` + `get_sections` dla niego nie istnieje. To jest powód, dla którego okno jest tu **częścią kontraktu, a nie ergonomią do pominięcia**: bez niego duży brief nie ma żadnej drogi dobrania reszty. Pozycja rodziny odczytu artefaktu, mechanizm w M36 (<section_ref anchor="jg79a7q4"/>).</before_change>
<after_change>**`get_brief` ma okno odczytu — `range?`.** `range` jest **oknem linii** rodziny odczytu artefaktów (M36 <section_ref anchor="9p8nltkf"/>): rodzaj `briefs` nie wybiera `m06-section-indexer` (<section_ref anchor="m21l13rt"/>), więc brief nie ma indeksu sekcji, a droga wznowienia `get_page_outline` + `get_sections` dla niego nie istnieje. To jest powód, dla którego okno jest tu **częścią kontraktu, a nie ergonomią do pominięcia**: bez niego duży brief nie ma żadnej drogi dobrania reszty. Pozycja rodziny odczytu artefaktu, mechanizm w M36 (<section_ref anchor="jg79a7q4"/>).</after_change>

**`create_brief` przyjmuje gotowe ciało — i dlatego jest operacją bezpośrednią.** Wołający podaje dwie rzeczy: **okno**, czyli parę release'ów z dopuszczalnym otwartym końcem (<section_ref anchor="m21fmtct"/>), i **treść** w `content`, niepustą po trim — inaczej `VALIDATION` i plik nie powstaje. Rozstrzyga o tym **kto ma kontekst**. Brief o domkniętym `to` jest funkcją diffu i turę stać na napisanie go z samego `release_diff`; brief o **otwartym `to`** funkcją diffu nie jest, więc tura powołana tylko po to, żeby go napisać, dostaje kontekst wołającego skompresowany do jednego prompta i nie widzi ani kodu, ani bieżącej specyfikacji — pisze więc gorzej niż wołający, który właśnie te dwie rzeczy przeczytał, a w najgorszym razie odmawia i zostawia plik z samym nagłówkiem. Pośrednik nie wnosi tu jakości, którą miała wnosić mediacja (<section_ref anchor="l3media0"/>), tylko punkt awarii. Kanonicznym wołającym tej trasy jest zewnętrzny agent po analizie kodu (M22 <section_ref anchor="r428qll1"/>).

**`content` pozostaje opcjonalne — i to jest cała trasa modala.** Pominięte zostawia plik z frontmatterem i nagłówkiem, a treść dopisuje osobnym `update_brief` tura wątku `context_type='brief'` (<section_ref anchor="m21bauth"/>), którą odpala konsument po utworzeniu briefu (<section_ref anchor="m21m17ax"/>). Sama operacja tury **nie zleca w żadnym z wariantów** — auto-start jest kompozycją po stronie konsumenta, nie mediacją tej operacji, i właśnie dlatego klasa mediacji wiersza jest `direct`. Zwrotka to `{ briefPath, hash }`: `hash` jest jedyną rzeczą, której wołający nie mógł przewidzieć, a musi ją mieć, żeby uzbroić pierwszą edycję — parytet ze `{ newHash }` z `update_brief`. Renderowania: <inline_mention type="endpoint" slug="post-api-briefs"/> w `rest` (<section_ref anchor="ms03kkq5"/>), `c4s create-brief` w `cli` (<section_ref anchor="xqksf67f"/>).

<todo comment="c4s agent --ct brief w create-mode kończący turę pustym ciałem briefu jest dziś cichą porażką: exit 0 i briefPath przy pliku z samym nagłówkiem. Rozstrzygnąć, czy komenda ma to sygnalizować (exit != 0 albo ostrzeżenie o niezapisanej treści) — osobny plan."/>

**`mark_brief_implemented` mutuje jedyne mutable pole frontmatteru.** `implemented` to fakt implementacyjny, nie narracyjny — dlatego jego producentem jest agent-implementer w terminalu albo człowiek w UI, nie tura w wątku `context_type='brief'` pisząca treść. Profil kontekstu `brief` tej operacji **nie eksponuje** (bramka profilu, <section_ref anchor="l3route0"/>), co jest zawężeniem na poziomie profilu, a nie wartością komórki: operacja jest w katalogu i dostępna z każdego kanału, a to profil wybiera z katalogu, nie odwrotnie. Renderowania: UI Settings popover i <inline_mention type="endpoint" slug="patch-api-artifacts-kind-path-frontmatter"/> w `rest`, `c4s mark-brief-implemented` w `cli` (<section_ref anchor="xqksf67f"/>).

<before_change>**Zwrotka `update_brief` to `{ newHash }`, nie zserializowany brief** — wołający właśnie tę treść wysłał, a hash jest jedyną rzeczą, której nie mógł przewidzieć i którą musi mieć, żeby uzbroić następną edycję.</before_change>
<after_change>**Zwrotka `update_brief` to `{ newHash, replacements? }`, nie zserializowany brief** — wołający właśnie tę treść wysłał, a hash jest jedyną rzeczą, której nie mógł przewidzieć i którą musi mieć, żeby uzbroić następną edycję. `replacements` jedzie wyłącznie w kształcie `textEdits` (reguła `replacements-returned`, <section_ref anchor="z4m9jx20"/>).</after_change>

- **Budżet odpowiedzi.** `get_brief` podlega budżetowi rdzenia (M39 <section_ref anchor="b7dg3xq2"/>): brief przekraczający budżet wraca z `truncated: true` i `truncationHint` wskazującym `range`, **nigdy nie wypada do transportu bez sygnału**. Bez tej reguły agent-autor dostawałby treść uciętą przez warstwę, która nie ma jak go o tym powiadomić, i pisał brief na fragmencie, który wygląda jak całość. Podpowiedź jest tu **bezwarunkowa** — inaczej niż w `get_page`, gdzie bramkuje ją rodzaj rootu — bo brief ma dokładnie jedną drogę wznowienia (<section_ref anchor="n9qp5ja7"/>).
- **Guard, którego nie da się nie przejść, nie jest guardem.** Implementacja `update_brief`, która przy braku `expectedHash` podstawia świeżo odczytany hash, spełnia schemat i **nie spełnia kontraktu** — to jest jedyna ochrona, jaką brief ma przed trzema równoległymi pisarzami (reguła `guard-declared`, <section_ref anchor="3s8b933r"/>).
- **`IMMUTABLE_FIELD` jest kodem wspólnym dla wszystkich kindów artefaktu**, nie wariantem `BRIEF_…`: guard mieszka w generycznej rodzinie M36, która nie zna nazw pól konkretnego kinda (<section_ref anchor="m36l4fam"/>).
- **`create_brief` zakłada dodatkowo wątek initial** (top-level, bez tury) — skutek, którego żadna kolumna wiersza nie niesie, bo dotyczy bytu spoza artefaktu. Wątek powstaje **niezależnie od `content`**, a przy podanym `content` jest wyłącznie **kotwicą UI**: powłoka `brief-detail` wymaga zakotwiczenia (<section_ref anchor="m21ctxreg"/>), więc brief bez wątku otwierałby się bez panelu czatu.

**Wartości rodziny odczytu artefaktu.** Warstwa wymaga od właściciela kinda deklaracji dla każdej z czterech pozycji, bo milczenie w tym miejscu jest luką na prawach pustej komórki kanału (L3 <section_ref anchor="l3slice0"/>); mechanizm każdej z nich należy do M36 (<section_ref anchor="jg79a7q4"/>).

| Pozycja | Wartość M21 |
|---|---|
| `list_briefs` | wiersz katalogu wyżej; pokrycie w `cli` (`c4s list-briefs`) i `rest`; **porządek: oś wydań** (<section_ref anchor="0kz2u8g7"/>) |
| `get_brief` z oknem | `range?` — kształt i uzasadnienie wyżej |
| budżet odpowiedzi | obowiązuje `get_brief`; `truncated` + `truncationHint` wskazujący `range` |
| `search_briefs` | **brief nie ma operacji wyszukiwania w żadnym kanale** — pytanie „który brief opisywał zmianę X" nie ma dziś odpowiedzi wewnątrz katalogu operacji |

Ostatni wiersz jest **zapisaną luką, nie zapisanym powodem** — i różnica jest istotna. `n/a` wymaga zdania o semantyce operacji (<section_ref anchor="l3route0"/>), a takiego zdania dla briefu nie ma: wyszukiwanie po treści niczego tu nie psuje i ma realnego konsumenta — agent-autor i jego fan-out `diff-explore` pracują na artefaktach, których nie umieją przeszukać. Luka jest więc nazwana, żeby przestała być nieodróżnialna od decyzji.

<todo comment="search_briefs oraz pokrycie list_briefs w kanałach agentowych (internal/mcp) — operacje zbiorowe nad briefami rozstrzyga osobny plan"/>

**Renderowanie w kanałach agentowych.** Zestaw narzędzi brief-owych jest montowany wyłącznie wątkom `context_type='brief'` (enforcement przy konstruowaniu agent runtime — <section_ref anchor="m21ctxreg"/>). Wąska powierzchnia profilu jest tu mechanizmem jakości: agent-autor ma widzieć brief i historyczny diff, a nie bieżący stan specyfikacji.

**Komendy `list-briefs` i `get-brief` są `server-delegating`.** Wykonanie każdej operacji katalogu należy do procesu serwera (<section_ref anchor="l3locus0"/>), więc oba readery idą tą samą drogą co reszta — bin nie czyta plików projektu bezpośrednio. Test spójności trybów (pole „Tryb wykonania" w slice schema L14, <section_ref anchor="flt0hm9r"/>) trzyma to w ryzach: komenda w katalogu z trybem innym niż `server-delegating` jest błędem specyfikacji.

<before_change>**Czym wołający opisuje nową treść — akcjami, dosłownie.** `update_brief` przyjmuje pełną treść adresowanego zakresu w parametrze `content`; trybu różnicowego (`textEdits`) ta wersja **nie oferuje** (<section_ref anchor="z4m9jx20"/>). Deklaracja stoi tu jawnie, bo warstwa traktuje milczenie w tym miejscu jak lukę, nie jak „nie oferuje". Brief jest — obok planu — naturalnym drugim konsumentem wzorca, bo jego słownik akcji ma ten sam kształt; dopisanie mu trybu różnicowego jest osobną zmianą.</before_change>
<after_change>**Czym wołający opisuje nową treść — dosłownie albo różnicowo.** `update_brief` przyjmuje **dokładnie jeden z dwóch kształtów**: akcję (`replace` / `append` / `insert_after_section`) z pełną treścią adresowanego zakresu w `content` albo listę dosłownych podmian `textEdits` liczonych na całym briefie, według wspólnego kontraktu trybu różnicowego (<section_ref anchor="z4m9jx20"/>). Oba kształty naraz albo żaden to `VALIDATION`, zanim plik zostanie dotknięty. Deklaracja stoi tu jawnie, bo warstwa traktuje milczenie w tym miejscu jak lukę. Brief jest — obok planu — drugim konsumentem wzorca, bo jego słownik akcji ma ten sam kształt; jego kształt jest przy tym węższy niż planu: paczki edycji sekcji brief nie ma. Opcjonalne `changeSummary` opisuje zmianę jednym zdaniem w obu kształtach.</after_change>

**Kontrakt wire renderowań agentowych — encje.** W kanale `internal` operacje briefu renderuje serwer `brief-tools`: cztery narzędzia — `get_brief`, `update_brief`, `list_brief_versions`, `get_brief_version`. Dokładnie tyle, ile rejestr kontekstów M05 montuje wątkom `context_type='brief'` (<section_ref anchor="m05ctxreg"/>), i ani jednego więcej — encja `mcp-tool` jest **zapisem istniejącego renderowania, nigdy jego powołaniem** (<section_ref anchor="p3th8bt4"/>). `mark_brief_implemented` pozycją tego serwera nie jest z powodu zapisanego wyżej (bramka profilu); `list_briefs` nie jest nią **bez** zapisanego powodu, więc jej komórka `internal` jest dziś deklaracją bez pokrycia i czeka na rozstrzygnięcie tą samą regułą, którą stosuje reguła routingu (<section_ref anchor="l3route0"/>).

<tagged_list type="mcp-tool" tags="m21"/>

## Context at 2.1.14 — pages/modules/m21-briefs.md

### context offset 1 limit 2

#### [m21cel001] M21 — Briefs

<after_change>
Zespół po zamknięciu wydania potrzebuje opowiedzianej różnicy — dokumentu, który mówi, co się w specyfikacji zmieniło i co z tego wynika dla kogoś, kto ma to zaimplementować. Ten moduł dostarcza taki dokument: narracyjny plik markdown wywiedziony z różnicy dwóch wydań, redagowany wspólnie przez autora i agenta w kolejnych rozmowach prowadzonych przeciw temu samemu tekstowi.

Trzyma go jako zwykły plik na dysku, bo ma dwóch czytelników: człowieka w aplikacji i agenta kodującego w terminalu, dla którego dokument jest samowystarczalnym wsadem — i to ten drugi czytelnik uzasadnia trzymanie treści poza bazą. Autor poprawia ją w edytorze aplikacji, w czacie albo dowolnym edytorem tekstu, a każda z tych dróg prowadzi do tego samego pliku.

Nie wprowadza własnych tabel ani własnego mechanizmu wersjonowania, nie liczy sam różnicy wydań i nie odpowiada za to, co wraca z implementacji jako zgłoszenie rozbieżności.
</after_change>

#### [m21zal001] M21 — Briefs

<after_change>
Ten moduł wnosi wyłącznie cykl życia briefu — wspólną maszynerię artefaktu, metodologię pisania i materiał, z którego brief powstaje, bierze z zewnątrz.

<tagged_list type="module-dependency" tags="m21"/>
</after_change>

### context offset 5 limit 1

#### [a5ur9rmr] M21 — Briefs

<after_change></after_change>

### context offset 8 limit 1

#### [m21srvct] M21 — Briefs > Domain (L2)

<after_change>
`briefService` (5 metod) to **cienki wrapper slice'u** nad składem plików korzenia `briefs` — storage (`MarkdownFileStore`) buduje implementor L13 (<section_ref anchor="m02l13001"/>), a wersjonowanie (`FileVersionService`, `file_version`) i indeks (`FrontmatterIndexer`) to reakcje wybrane przez rodzaj `briefs` (<section_ref anchor="m21l13rt"/>); generyczne CRUD (read/write content, PATCH frontmatter, versions) idzie przez rodzinę REST `/api/artifacts/brief/...` (<section_ref anchor="m36l4001"/>). `briefService` dokłada **tylko logikę briefu** (slug, okno release'ów, `roots`, walidacja release'ów) i wiązanie wątków. Zero wlasnej tabeli, zero wlasnego storage'u:

| Metoda | Sygnatura | Implementacja |
|--------|-----------|---------------|
| `createBrief` | `({ fromReleaseName?, toReleaseName, roots?, content?, suffix? }) → { briefPath }` | **File-only** (NIE tworzy watku). Generuje slug (**scope `roots` wchodzi do sluga**, patrz <section_ref anchor="m21fmtct"/>), zapis przez skład plików korzenia `briefs` z frontmatter (**`roots`** gdy przekazane, inaczej omit = caly release; **explicit `implemented: false`** jako default state) + `content` (jezeli podany — pelne cialo briefu zapisywane **verbatim**, niepuste po trim albo `VALIDATION` i plik nie powstaje; pominiete = plik z samym `# Heading`, ktorego tresc dopisze osobna tura), capture `create` przez `FileVersionService` (`rootId = 'briefs'`). **`roots` (L13, <section_ref anchor="m21l13rt"/>):** opcjonalna tablica rootId-ow (scope przestrzeni stron z modala tryb b) — zapisywana **verbatim** do frontmatter jako immutable identity; `createBrief` **NIE** partycjonuje na N plikow (jeden brief = jeden plik, niezaleznie od liczby rootow). **Walidacja:** `from===null && to===null` → 400 `VALIDATION`; `BRIEF_SAME_RELEASE` **tylko gdy oba non-null** i rowne; `fromReleaseName` domyslnie = **latest** przez `releaseService.list()` gdy nieprzekazany; `to===null` jest **poprawne samo z siebie** — znaczy „okno otwarte do stanu biezacego", nie brak danych (<section_ref anchor="m21fmtct"/>). Tworzenie watku — osobno przez `createThreadForBrief` (rozszczepienie, patrz <section_ref anchor="m21m17ax"/> i M05 dispatcher) |
| `getBrief` | `({ path }) → { frontmatter, body, content, hash }` | Read ze składu plików korzenia `briefs` + sha256 contentu |
| `updateBrief` | `({ path, action?, content?, textEdits?, anchor?, heading?, expectedHash?, changeSummary?, changedBy: 'agent' \| 'user' }) → { newHash, replacements? }` | Dokładnie jeden kształt wejścia: `action` + `content` albo `textEdits` (<section_ref anchor="01ytpznn"/>). Wrapper na zapis składu plików korzenia `briefs` + capture `update` przez `FileVersionService`. Walidacja immutable frontmatter fields (w tym **`roots`** — L13 scope, chroniony jak `from_release`/`to_release`) **plus blokada `implemented`** gdy `changedBy='agent'` (analog immutable fields — agent w UI nie deklaruje "skonczone"). Optimistic concurrency po `expectedHash` (sha256 contentu) — niezgodnosc → 409 |
| `listBriefs` | `({ implemented? }) → BriefListItem[]` | Query `frontmatterIndexer.findByFrontmatterType('brief')` (zawężone do korzenia rodzaju `briefs`) + opcjonalny filter po `implemented` z odczytanego frontmatter. Brak pola `implemented` we frontmatter → traktowane jako `false`. `implemented` nieprzekazane → zwraca wszystkie. Zwraca listę w porządku osi wydań (<section_ref anchor="0kz2u8g7"/>) — kolejność liczy serwis, nie kanał |
| `createThreadForBrief` | `({ path, name?, parentThreadId?, spawnedByToolUseId? }) → { threadId }` | Insert `chat_thread` z `context_type='brief'`, `brief_path=path`. **Invariant:** kazdy thread tworzony z `brief_path` ma `context_type='brief'`. `parentThreadId` / `spawnedByToolUseId` (oba opcjonalne, default NULL) — gdy watek jest **banka** zrodzona przez <inline_mention type="mcp-tool" slug="transagent-tools-runtransagent"/> (M46), linkuja go z rodzicem (render nested live-join, reconstruction; <section_ref anchor="us5ee75g"/> w `modules/m46-transagent.md`). Bez nich → watek top-level (klasyczny brief-thread z UI). **Jedyne miejsce zakladajace brief-thread** — UI „New brief" i dispatcher M05 obie ida tedy (po rozszczepieniu `createBrief`) |


**`BRIEF_SAME_RELEASE` porównuje NAZWY — i to jest porównanie tożsamości, nie porównanie napisów.** Okno briefu adresuje release'y wyłącznie nazwą: `fromReleaseName` / `toReleaseName` w L2, to samo w <inline_mention type="dto" slug="brief-create-request"/> i <inline_mention type="endpoint" slug="post-api-briefs"/>, to samo we flagach `--from` / `--to` w CLI (<section_ref anchor="xqksf67f"/>) i w modalu „Generate brief" (<section_ref anchor="m21m17ax"/>). Numerycznego końca okna **nie ma w żadnym z tych kanałów** — okno briefu adresuje release'y nazwą, tak jak każda operacja release'owa, z <inline_mention type="mcp-tool" slug="release-tools-release-diff"/> włącznie (M17 <section_ref anchor="m17api001"/>), więc „ten sam release podany raz numerem, raz nazwą" nie jest tu stanem osiągalnym. A ponieważ `spec_release.name` jest `UNIQUE NOT NULL` i jest **publicznym identyfikatorem** release'u (M17 <section_ref anchor="34xy2eei"/>), dwie równe nazwy **są** jednym release'em. Walidacja porównuje zatem nazwy **bez resolucji na id**: rozwiązywanie obu końców tylko po to, żeby je zestawić, kosztowałoby dwa lookupy przed walidacją i odwróciłoby kolejność błędów — „release nie istnieje" wyprzedzałoby `BRIEF_SAME_RELEASE`, choć wołający pomylił się wcześniej i w czym innym. Równość jest **case-sensitive**, bo `UNIQUE` na `name` też jest (brak `COLLATE NOCASE`), i liczona **po trim**, bo trim jest normalizacją zapisu nazwy w M17 (<section_ref anchor="hybasevj"/>) — dzięki temu walidacja okna i unikalność nazwy rozstrzygają **tę samą** równość, a nie dwie podobne.

**`to === null` nie jest luką w walidacji, tylko znaczeniem otwartego okna.** `null` po stronie `to` nie jest brakującym release'em — jest **stanem bieżącym** (<section_ref anchor="m21fmtct"/>), punktem osi czasu, który z definicji nie jest żadnym release'em, więc nie ma z czym go zrównać. Pominięcie porównania przy `to===null` jest więc konsekwencją kontraktu okna, nie przeoczeniem: brief `from=latest, to=null` — jedyna droga briefu wobec stanu bieżącego — ma tę walidację przechodzić (<inline_mention type="ac" slug="ac-brief-source-analysis-utworzony-przez-di"/>). Sytuacja, której `BRIEF_SAME_RELEASE` faktycznie broni, to okno **domknięte** o zerowej rozpiętości; przy otwartym końcu rozpiętość jest niepusta z definicji.

</after_change>

### context offset 15 limit 1

#### [01ytpznn] M21 — Briefs

<after_change>
M21 jest rdzeniem-właścicielem **operacji nad briefem** — odczytu, listowania, edycji, osi wersji i jedynego mutable pola frontmatteru.

<single_element type="spreadsheet" slug="katalog-operacji-m21" caption="Siedem operacji briefu, wszystkie bezpośrednie — treść briefu podaje ten, kto ma kontekst, a nie tura powołana po to, żeby go zgadnąć"/>

**Adres briefu: w kanale `internal` nieobecny, w kanałach zewnętrznych wymagany — wyjątek izolacji.** M21 deklaruje, że wątek `context_type='brief'` **widzi wyłącznie brief, do którego jest przypięty** (`chat_thread.brief_path`). Dlatego schemat wewnętrzny operacji briefu **nie ma** parametru `path`: adres jest domknięty z wątku, a izolację niesie właśnie brak parametru — parametr opcjonalny byłby defaultem, a default nie izoluje (reguła `explicit-addressing`, wyjątek izolacji, <section_ref anchor="bpejzx03"/>). Izolacja jest tu tym samym mechanizmem jakości co wąska powierzchnia profilu: agent-autor ma widzieć swój brief i historyczny diff, a nie inne artefakty. Wołający z `cli`, `mcp` i `rest` nie ma wątku, z którego dałoby się wyprowadzić adres, więc podaje `path` wprost — kanałów zewnętrznych wyjątek nie dotyczy. Deklaracja obejmuje `get_brief`, `update_brief`, `mark_brief_implemented` i obie operacje wersji.

**`get_brief` ma okno odczytu — `range?`.** `range` jest **oknem linii** rodziny odczytu artefaktów (M36 <section_ref anchor="9p8nltkf"/>): rodzaj `briefs` nie wybiera `m06-section-indexer` (<section_ref anchor="m21l13rt"/>), więc brief nie ma indeksu sekcji, a droga wznowienia `get_page_outline` + `get_sections` dla niego nie istnieje. To jest powód, dla którego okno jest tu **częścią kontraktu, a nie ergonomią do pominięcia**: bez niego duży brief nie ma żadnej drogi dobrania reszty. Pozycja rodziny odczytu artefaktu, mechanizm w M36 (<section_ref anchor="jg79a7q4"/>).

**`create_brief` przyjmuje gotowe ciało — i dlatego jest operacją bezpośrednią.** Wołający podaje dwie rzeczy: **okno**, czyli parę release'ów z dopuszczalnym otwartym końcem (<section_ref anchor="m21fmtct"/>), i **treść** w `content`, niepustą po trim — inaczej `VALIDATION` i plik nie powstaje. Rozstrzyga o tym **kto ma kontekst**. Brief o domkniętym `to` jest funkcją diffu i turę stać na napisanie go z samego `release_diff`; brief o **otwartym `to`** funkcją diffu nie jest, więc tura powołana tylko po to, żeby go napisać, dostaje kontekst wołającego skompresowany do jednego prompta i nie widzi ani kodu, ani bieżącej specyfikacji — pisze więc gorzej niż wołający, który właśnie te dwie rzeczy przeczytał, a w najgorszym razie odmawia i zostawia plik z samym nagłówkiem. Pośrednik nie wnosi tu jakości, którą miała wnosić mediacja (<section_ref anchor="l3media0"/>), tylko punkt awarii. Kanonicznym wołającym tej trasy jest zewnętrzny agent po analizie kodu (M22 <section_ref anchor="r428qll1"/>).

**`content` pozostaje opcjonalne — i to jest cała trasa modala.** Pominięte zostawia plik z frontmatterem i nagłówkiem, a treść dopisuje osobnym `update_brief` tura wątku `context_type='brief'` (<section_ref anchor="m21bauth"/>), którą odpala konsument po utworzeniu briefu (<section_ref anchor="m21m17ax"/>). Sama operacja tury **nie zleca w żadnym z wariantów** — auto-start jest kompozycją po stronie konsumenta, nie mediacją tej operacji, i właśnie dlatego klasa mediacji wiersza jest `direct`. Zwrotka to `{ briefPath, hash }`: `hash` jest jedyną rzeczą, której wołający nie mógł przewidzieć, a musi ją mieć, żeby uzbroić pierwszą edycję — parytet ze `{ newHash }` z `update_brief`. Renderowania: <inline_mention type="endpoint" slug="post-api-briefs"/> w `rest` (<section_ref anchor="ms03kkq5"/>), `c4s create-brief` w `cli` (<section_ref anchor="xqksf67f"/>).

<todo comment="c4s agent --ct brief w create-mode kończący turę pustym ciałem briefu jest dziś cichą porażką: exit 0 i briefPath przy pliku z samym nagłówkiem. Rozstrzygnąć, czy komenda ma to sygnalizować (exit != 0 albo ostrzeżenie o niezapisanej treści) — osobny plan."/>

**`mark_brief_implemented` mutuje jedyne mutable pole frontmatteru.** `implemented` to fakt implementacyjny, nie narracyjny — dlatego jego producentem jest agent-implementer w terminalu albo człowiek w UI, nie tura w wątku `context_type='brief'` pisząca treść. Profil kontekstu `brief` tej operacji **nie eksponuje** (bramka profilu, <section_ref anchor="l3route0"/>), co jest zawężeniem na poziomie profilu, a nie wartością komórki: operacja jest w katalogu i dostępna z każdego kanału, a to profil wybiera z katalogu, nie odwrotnie. Renderowania: UI Settings popover i <inline_mention type="endpoint" slug="patch-api-artifacts-kind-path-frontmatter"/> w `rest`, `c4s mark-brief-implemented` w `cli` (<section_ref anchor="xqksf67f"/>).

**Zwrotka `update_brief` to `{ newHash, replacements? }`, nie zserializowany brief** — wołający właśnie tę treść wysłał, a hash jest jedyną rzeczą, której nie mógł przewidzieć i którą musi mieć, żeby uzbroić następną edycję. `replacements` jedzie wyłącznie w kształcie `textEdits` (reguła `replacements-returned`, <section_ref anchor="z4m9jx20"/>).

- **Budżet odpowiedzi.** `get_brief` podlega budżetowi rdzenia (M39 <section_ref anchor="b7dg3xq2"/>): brief przekraczający budżet wraca z `truncated: true` i `truncationHint` wskazującym `range`, **nigdy nie wypada do transportu bez sygnału**. Bez tej reguły agent-autor dostawałby treść uciętą przez warstwę, która nie ma jak go o tym powiadomić, i pisał brief na fragmencie, który wygląda jak całość. Podpowiedź jest tu **bezwarunkowa** — inaczej niż w `get_page`, gdzie bramkuje ją rodzaj rootu — bo brief ma dokładnie jedną drogę wznowienia (<section_ref anchor="n9qp5ja7"/>).
- **Guard, którego nie da się nie przejść, nie jest guardem.** Implementacja `update_brief`, która przy braku `expectedHash` podstawia świeżo odczytany hash, spełnia schemat i **nie spełnia kontraktu** — to jest jedyna ochrona, jaką brief ma przed trzema równoległymi pisarzami (reguła `guard-declared`, <section_ref anchor="3s8b933r"/>).
- **`IMMUTABLE_FIELD` jest kodem wspólnym dla wszystkich kindów artefaktu**, nie wariantem `BRIEF_…`: guard mieszka w generycznej rodzinie M36, która nie zna nazw pól konkretnego kinda (<section_ref anchor="m36l4fam"/>).
- **`create_brief` zakłada dodatkowo wątek initial** (top-level, bez tury) — skutek, którego żadna kolumna wiersza nie niesie, bo dotyczy bytu spoza artefaktu. Wątek powstaje **niezależnie od `content`**, a przy podanym `content` jest wyłącznie **kotwicą UI**: powłoka `brief-detail` wymaga zakotwiczenia (<section_ref anchor="m21ctxreg"/>), więc brief bez wątku otwierałby się bez panelu czatu.

**Wartości rodziny odczytu artefaktu.** Warstwa wymaga od właściciela kinda deklaracji dla każdej z czterech pozycji, bo milczenie w tym miejscu jest luką na prawach pustej komórki kanału (L3 <section_ref anchor="l3slice0"/>); mechanizm każdej z nich należy do M36 (<section_ref anchor="jg79a7q4"/>).

| Pozycja | Wartość M21 |
|---|---|
| `list_briefs` | wiersz katalogu wyżej; pokrycie w `cli` (`c4s list-briefs`) i `rest`; **porządek: oś wydań** (<section_ref anchor="0kz2u8g7"/>) |
| `get_brief` z oknem | `range?` — kształt i uzasadnienie wyżej |
| budżet odpowiedzi | obowiązuje `get_brief`; `truncated` + `truncationHint` wskazujący `range` |
| `search_briefs` | **brief nie ma operacji wyszukiwania w żadnym kanale** — pytanie „który brief opisywał zmianę X" nie ma dziś odpowiedzi wewnątrz katalogu operacji |

Ostatni wiersz jest **zapisaną luką, nie zapisanym powodem** — i różnica jest istotna. `n/a` wymaga zdania o semantyce operacji (<section_ref anchor="l3route0"/>), a takiego zdania dla briefu nie ma: wyszukiwanie po treści niczego tu nie psuje i ma realnego konsumenta — agent-autor i jego fan-out `diff-explore` pracują na artefaktach, których nie umieją przeszukać. Luka jest więc nazwana, żeby przestała być nieodróżnialna od decyzji.

<todo comment="search_briefs oraz pokrycie list_briefs w kanałach agentowych (internal/mcp) — operacje zbiorowe nad briefami rozstrzyga osobny plan"/>

**Renderowanie w kanałach agentowych.** Zestaw narzędzi brief-owych jest montowany wyłącznie wątkom `context_type='brief'` (enforcement przy konstruowaniu agent runtime — <section_ref anchor="m21ctxreg"/>). Wąska powierzchnia profilu jest tu mechanizmem jakości: agent-autor ma widzieć brief i historyczny diff, a nie bieżący stan specyfikacji.

**Komendy `list-briefs` i `get-brief` są `server-delegating`.** Wykonanie każdej operacji katalogu należy do procesu serwera (<section_ref anchor="l3locus0"/>), więc oba readery idą tą samą drogą co reszta — bin nie czyta plików projektu bezpośrednio. Test spójności trybów (pole „Tryb wykonania" w slice schema L14, <section_ref anchor="flt0hm9r"/>) trzyma to w ryzach: komenda w katalogu z trybem innym niż `server-delegating` jest błędem specyfikacji.

**Czym wołający opisuje nową treść — dosłownie albo różnicowo.** `update_brief` przyjmuje **dokładnie jeden z dwóch kształtów**: akcję (`replace` / `append` / `insert_after_section`) z pełną treścią adresowanego zakresu w `content` albo listę dosłownych podmian `textEdits` liczonych na całym briefie, według wspólnego kontraktu trybu różnicowego (<section_ref anchor="z4m9jx20"/>). Oba kształty naraz albo żaden to `VALIDATION`, zanim plik zostanie dotknięty. Deklaracja stoi tu jawnie, bo warstwa traktuje milczenie w tym miejscu jak lukę. Brief jest — obok planu — drugim konsumentem wzorca, bo jego słownik akcji ma ten sam kształt; jego kształt jest przy tym węższy niż planu: paczki edycji sekcji brief nie ma. Opcjonalne `changeSummary` opisuje zmianę jednym zdaniem w obu kształtach.

**Kontrakt wire renderowań agentowych — encje.** W kanale `internal` operacje briefu renderuje serwer `brief-tools`: cztery narzędzia — `get_brief`, `update_brief`, `list_brief_versions`, `get_brief_version`. Dokładnie tyle, ile rejestr kontekstów M05 montuje wątkom `context_type='brief'` (<section_ref anchor="m05ctxreg"/>), i ani jednego więcej — encja `mcp-tool` jest **zapisem istniejącego renderowania, nigdy jego powołaniem** (<section_ref anchor="p3th8bt4"/>). `mark_brief_implemented` pozycją tego serwera nie jest z powodu zapisanego wyżej (bramka profilu); `list_briefs` nie jest nią **bez** zapisanego powodu, więc jej komórka `internal` jest dziś deklaracją bez pokrycia i czeka na rozstrzygnięcie tą samą regułą, którą stosuje reguła routingu (<section_ref anchor="l3route0"/>).

<tagged_list type="mcp-tool" tags="m21"/>
</after_change>

### context offset 24 limit 1

#### [i0w83n73] M21 — Briefs > System Prompt Contribution (L16)

<after_change>
**Warunek emisji.** Tylko gdy serwer operacji briefu jest w tej turze zarejestrowany, i wtedy zawsze — kontrakt narzędziowy stoi w prompcie niezależnie od tego, czy zakotwiczony artefakt daje się odczytać. Bez zarejestrowanego serwera bloku nie ma w ogóle, bo nie ma wtedy operacji, o których on mówi.

Wkład opisuje, jak agent ma się posługiwać operacjami briefu. Powód, dla którego kontrakt jedzie promptem, zamiast być zostawiony do wywnioskowania z katalogu narzędzi: ścieżka briefu odbiera agentowi built-iny plikowe i serwery encji, więc operacje briefu są tam jedyną drogą do artefaktu i z powrotem — zawężenie, które deklaruje <section_ref anchor="m21ctxreg"/>.

**Szablon.**

<single_element type="code-snippet" slug="szablon-brief-tools-usage"/>
</after_change>

## Entities (change 2.1.13 → 2.1.14)

### mcp-tool `brief-tools-get-brief-version` (op: update) — built

before:
```json
{
 "slug": "brief-tools-get-brief-version",
 "title": "brief-tools · get_brief_version",
 "name": "get_brief_version",
 "server": "brief-tools",
 "description": "Read one historical snapshot of the brief, addressed by version number from `list_brief_versions`. Use it to see what the brief said before an edit — it does not restore anything and does not touch the live file. `path` is optional: omit it to address the brief of the current thread.",
 "params": [
  {
   "name": "version",
   "type": "number",
   "required": true,
   "description": "Version number, from list_brief_versions."
  },
  {
   "name": "path",
   "type": "string",
   "required": false,
   "description": "Brief path relative to the briefs directory. Omit to address the brief of the current thread."
  }
 ],
 "returns": "Snapshot wskazanej wersji: treść markdown zapisana w `file_version` wraz z numerem wersji i znacznikiem czasu. Czysty odczyt historii — bieżący plik pozostaje nietknięty.",
 "sampleReturn": null,
 "readOnlyHint": 1,
 "destructiveHint": null,
 "idempotentHint": null,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `get_brief_version` (M21).\n\nOperacja jest odczytem osi wersji, nie przywróceniem: przywrócenie treści historycznej to zwykły `update_brief` z `expectedHash` bieżącej wersji, i tak ma pozostać — cofnięcie jest zmianą, więc ma zostawić własny ślad w historii.\n\nOdmowa: nieznana ścieżka → `BRIEF_NOT_FOUND`; numer wersji spoza historii → błąd walidacji z zakresem dostępnych wersji.",
 "tags": [
  "m21-briefs"
 ],
 "createdAt": "2026-08-20T18:42:43.591Z",
 "updatedAt": "2026-08-20T18:42:43.591Z"
}
```
after:
```json
{
 "slug": "brief-tools-get-brief-version",
 "title": "brief-tools · get_brief_version",
 "name": "get_brief_version",
 "server": "brief-tools",
 "description": "Read one historical snapshot of the brief, addressed by version number from `list_brief_versions`. Use it to see what the brief said before an edit — it does not restore anything and does not touch the live file. There is no `path` parameter: the tool addresses the brief of this thread only.",
 "params": [
  {
   "name": "version",
   "type": "number",
   "required": true,
   "description": "Version number, from list_brief_versions."
  }
 ],
 "returns": "Snapshot wskazanej wersji: treść markdown zapisana w `file_version` wraz z numerem wersji i znacznikiem czasu. Czysty odczyt historii — bieżący plik pozostaje nietknięty.",
 "sampleReturn": null,
 "readOnlyHint": 1,
 "destructiveHint": null,
 "idempotentHint": null,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `get_brief_version` (M21).\n\nOperacja jest odczytem osi wersji, nie przywróceniem: przywrócenie treści historycznej to zwykły `update_brief` z `expectedHash` bieżącej wersji, i tak ma pozostać — cofnięcie jest zmianą, więc ma zostawić własny ślad w historii.\n\nOdmowa: nieznana ścieżka → `BRIEF_NOT_FOUND`; numer wersji spoza historii → błąd walidacji z zakresem dostępnych wersji.",
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-20T18:42:43.591Z",
 "updatedAt": "2026-10-08T21:24:27.674Z"
}
```

### mcp-tool `brief-tools-get-brief` (op: update) — built

before:
```json
{
 "slug": "brief-tools-get-brief",
 "title": "brief-tools · get_brief",
 "name": "get_brief",
 "server": "brief-tools",
 "description": "Read the brief this thread is anchored in — content, frontmatter and hash. This is the ONLY way to the brief's content: the system prompt carries the brief's path and frontmatter, never its body and never its hash. `path` is optional here: omit it and the brief of the current thread is resolved for you; that is the normal call. For a long brief, or when a response comes back truncated, read it in windows with `range`. The returned `hash` is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write. Call it before editing, and again after a system reminder says the file changed underneath you.",
 "params": [
  {
   "name": "path",
   "type": "string",
   "required": false,
   "description": "Brief path relative to the briefs directory. Omit to address the brief of the current thread."
  },
  {
   "name": "range",
   "type": "object",
   "required": false,
   "description": "Line window { start, end }, 1-based and inclusive. Use it to read a long brief in parts or to fetch the rest after a truncated response. A start past the end of the file is refused with the file size."
  }
 ],
 "returns": "Rekord briefu: ścieżka, pola frontmatteru (m.in. `from_release`, `to_release`, `implemented`), treść markdown (całość albo wskazane okno) i sha256 treści; po przekroczeniu budżetu `truncated: true` i `truncationHint` wskazujący `range`.",
 "sampleReturn": null,
 "readOnlyHint": 1,
 "destructiveHint": null,
 "idempotentHint": null,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `get_brief` (M21); serwer jest transportem i nie dokłada semantyki.\n\nBrak `path` nie jest błędem: adres pochodzi z `chat_thread.brief_path` wątku zamkniętego w closure serwera. Opcjonalność jest obroną ergonomii kanału wewnętrznego — wiązanie artefaktu przez wątek jest renderowaniem kanału, nie kontraktem operacji.\n\nTreść i `hash` wracają z konieczności, nie z uprzejmości: prompt nie niesie ani jednego, ani drugiego, więc to jedyne wejście, z którego wołający bierze je przed pierwszą edycją w sesji — a `update_brief` żąda `expectedHash`.\n\nNieznana ścieżka albo okno poza plikiem kończy się odmową z kodem operacji.",
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-20T18:42:43.577Z",
 "updatedAt": "2026-10-08T14:36:24.900Z"
}
```
after:
```json
{
 "slug": "brief-tools-get-brief",
 "title": "brief-tools · get_brief",
 "name": "get_brief",
 "server": "brief-tools",
 "description": "Read the brief this thread is anchored in — content, frontmatter and hash. This is the ONLY way to the brief's content: the system prompt carries the brief's path and frontmatter, never its body and never its hash. There is no `path` parameter: the tool is scoped to the brief of this thread and cannot reach another one. For a long brief, or when a response comes back truncated, read it in windows with `range`. The returned `hash` is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write. Call it before editing, and again after a system reminder says the file changed underneath you.",
 "params": [
  {
   "name": "range",
   "type": "object",
   "required": false,
   "description": "Line window { start, end }, 1-based and inclusive. Use it to read a long brief in parts or to fetch the rest after a truncated response. A start past the end of the file is refused with the file size."
  }
 ],
 "returns": "Rekord briefu: ścieżka, pola frontmatteru (m.in. `from_release`, `to_release`, `implemented`), treść markdown (całość albo wskazane okno) i sha256 treści; po przekroczeniu budżetu `truncated: true` i `truncationHint` wskazujący `range`.",
 "sampleReturn": null,
 "readOnlyHint": 1,
 "destructiveHint": null,
 "idempotentHint": null,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `get_brief` (M21); serwer jest transportem i nie dokłada semantyki.\n\nBrak `path` nie jest błędem: adres pochodzi z `chat_thread.brief_path` wątku zamkniętego w closure serwera. Opcjonalność jest obroną ergonomii kanału wewnętrznego — wiązanie artefaktu przez wątek jest renderowaniem kanału, nie kontraktem operacji.\n\nTreść i `hash` wracają z konieczności, nie z uprzejmości: prompt nie niesie ani jednego, ani drugiego, więc to jedyne wejście, z którego wołający bierze je przed pierwszą edycją w sesji — a `update_brief` żąda `expectedHash`.\n\nNieznana ścieżka albo okno poza plikiem kończy się odmową z kodem operacji.",
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-20T18:42:43.577Z",
 "updatedAt": "2026-10-08T21:24:27.666Z"
}
```

### mcp-tool `brief-tools-list-brief-versions` (op: update) — built

before:
```json
{
 "slug": "brief-tools-list-brief-versions",
 "title": "brief-tools · list_brief_versions",
 "name": "list_brief_versions",
 "server": "brief-tools",
 "description": "List the version history of the brief — metadata only, never content. Use it to see what changed and when before pulling a specific snapshot with `get_brief_version`. `path` is optional: omit it to address the brief of the current thread.",
 "params": [
  {
   "name": "path",
   "type": "string",
   "required": false,
   "description": "Brief path relative to the briefs directory. Omit to address the brief of the current thread."
  }
 ],
 "returns": "Lista pozycji historii z `file_version` dla `(rootId='brief', path)`: numer wersji, znacznik czasu i sprawca zmiany. Bez treści snapshotów — te wydaje `get_brief_version`.",
 "sampleReturn": null,
 "readOnlyHint": 1,
 "destructiveHint": null,
 "idempotentHint": null,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `list_brief_versions` (M21). Oś wersji jest wspólną maszynerią artefaktu wnoszoną przez M36; M21 deklaruje wyłącznie specyfikę briefu.\n\nMeta bez treści jest wyborem, nie oszczędnością: historia bywa długa, a wołający prawie zawsze chce jednego snapshotu, nie wszystkich.\n\nOdmowa: nieznana ścieżka → `BRIEF_NOT_FOUND`.",
 "tags": [
  "m21-briefs"
 ],
 "createdAt": "2026-08-20T18:42:43.589Z",
 "updatedAt": "2026-08-20T18:42:43.589Z"
}
```
after:
```json
{
 "slug": "brief-tools-list-brief-versions",
 "title": "brief-tools · list_brief_versions",
 "name": "list_brief_versions",
 "server": "brief-tools",
 "description": "List the version history of the brief — metadata only, never content. Use it to see what changed and when before pulling a specific snapshot with `get_brief_version`. There is no `path` parameter: the tool addresses the brief of this thread only.",
 "params": [],
 "returns": "Lista pozycji historii z `file_version` dla `(rootId='brief', path)`: numer wersji, znacznik czasu i sprawca zmiany. Bez treści snapshotów — te wydaje `get_brief_version`.",
 "sampleReturn": null,
 "readOnlyHint": 1,
 "destructiveHint": null,
 "idempotentHint": null,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `list_brief_versions` (M21). Oś wersji jest wspólną maszynerią artefaktu wnoszoną przez M36; M21 deklaruje wyłącznie specyfikę briefu.\n\nMeta bez treści jest wyborem, nie oszczędnością: historia bywa długa, a wołający prawie zawsze chce jednego snapshotu, nie wszystkich.\n\nOdmowa: nieznana ścieżka → `BRIEF_NOT_FOUND`.",
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-20T18:42:43.589Z",
 "updatedAt": "2026-10-08T21:24:27.670Z"
}
```

### mcp-tool `brief-tools-update-brief` (op: update) — built

before:
```json
{
 "slug": "brief-tools-update-brief",
 "title": "brief-tools · update_brief",
 "name": "update_brief",
 "server": "brief-tools",
 "description": "Edit the brief by action, not by diff: `replace` swaps the addressed range, `append` adds at the end, `insert_after_section` places new content after a section you address by `anchor` or by `heading`. You pass the full text of the range in `content` — there is no textual-substitution mode here.\n\n`expectedHash` is MANDATORY. Pass the hash you got from `get_brief`; omitting it is a validation error, not silent permission to overwrite. The brief is edited in parallel by this thread, by a human in the UI and by an implementer agent in the terminal, so last-write-wins would lose someone's work without a trace.\n\nAn `anchor` that no longer resolves does not fail the call — the content is appended at the end and the answer says so. A heading inside a code block is never a target, and a `heading` matching several headings lands after the first of them, with a warning in the answer.\n\nFrontmatter is not editable here; only `implemented` is mutable at all, and it has its own route.",
 "params": [
  {
   "description": "What to do with `content`: swap the addressed range, add at the end, or insert after an addressed section.",
   "name": "action",
   "required": true,
   "type": "enum(replace, append, insert_after_section)"
  },
  {
   "description": "Full text this edit contributes. No diff mode — write the range out.",
   "name": "content",
   "required": true,
   "type": "string"
  },
  {
   "description": "Section anchor to address for `insert_after_section`. Unknown anchor degrades to append-at-end with a warning.",
   "name": "anchor",
   "required": false,
   "type": "string"
  },
  {
   "description": "Heading text to address for `insert_after_section`, as an alternative to `anchor`.",
   "name": "heading",
   "required": false,
   "type": "string"
  },
  {
   "description": "sha256 of the brief as you last read it. Missing → VALIDATION; mismatch → BRIEF_CONFLICT carrying the current hash.",
   "name": "expectedHash",
   "required": true,
   "type": "string"
  },
  {
   "description": "Brief path relative to the briefs directory. Omit to address the brief of the current thread.",
   "name": "path",
   "required": false,
   "type": "string"
  }
 ],
 "returns": "`{ newHash }` — sha256 treści po zapisie, gotowy jako `expectedHash` kolejnej edycji. Bez zserializowanego briefu. Fallback po nieznanym anchorze wraca z ostrzeżeniem, nie z błędem.",
 "sampleReturn": null,
 "readOnlyHint": 0,
 "destructiveHint": null,
 "idempotentHint": 0,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `update_brief` (M21).\n\n`expectedHash` jest obowiązkowy z kontraktu, nie ze schematu: implementacja, która przy braku parametru podstawia świeżo odczytany hash, spełnia schemat i **nie** spełnia kontraktu — guard, którego nie da się nie przejść, nie jest guardem.\n\nPróba zmiany pola frontmatteru spoza `implemented` → `IMMUTABLE_FIELD`, kod wspólny dla wszystkich kindów artefaktu (guard mieszka w generycznej rodzinie M36, nie tutaj).\n\nEfekty uboczne: plik w korzeniu `briefs`, nowa pozycja `file_version` keyed `(rootId='briefs', path)`, notyfikacja `file:changed`. `replace` idempotentne po treści, `append` i `insert_after_section` nie.",
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-20T18:42:43.586Z",
 "updatedAt": "2026-10-05T16:45:55.451Z"
}
```
after:
```json
{
 "slug": "brief-tools-update-brief",
 "title": "brief-tools · update_brief",
 "name": "update_brief",
 "server": "brief-tools",
 "description": "Edit the brief of this thread — there is no `path` parameter and no way to reach another brief. TWO INPUT SHAPES, EXACTLY ONE PER CALL (both, or neither, is invalid):\n- by action — `action` + `content`: `replace` swaps the addressed range, `append` adds at the end, `insert_after_section` places new content after a section you address by `anchor` or by `heading`. You pass the full text of the range in `content`.\n- differential — `textEdits`: literal substitutions over the whole brief, without resending the untouched text. Use it for a few sentences anywhere; use `action` + `content` to write or genuinely rewrite a range.\n\n`find` matches BYTE FOR BYTE — no regex, no whitespace normalisation. `expectedMatches` OMITTED MEANS EXACTLY ONE match; pass a number, or `\"all\"` for every occurrence. All patterns are counted on the brief as it was BEFORE the write, so substitutions do not cascade.\n\n`expectedHash` is MANDATORY. Pass the hash you got from `get_brief`; omitting it is a validation error, not silent permission to overwrite. The brief is edited in parallel by this thread, by a human in the UI and by an implementer agent in the terminal, so last-write-wins would lose someone's work without a trace.\n\nAn `anchor` that no longer resolves does not fail the call — the content is appended at the end and the answer says so. A heading inside a code block is never a target, and a `heading` matching several headings lands after the first of them, with a warning in the answer.\n\nFrontmatter is not editable here; only `implemented` is mutable at all, and it has its own route.",
 "params": [
  {
   "name": "action",
   "type": "enum(replace, append, insert_after_section)",
   "required": false,
   "description": "ACTION SHAPE: what to do with `content` — swap the addressed range, add at the end, or insert after an addressed section. Required together with `content`; forbidden with `textEdits`."
  },
  {
   "name": "content",
   "type": "string",
   "required": false,
   "description": "ACTION SHAPE: full text this edit contributes — write the range out. Required together with `action`; forbidden with `textEdits`."
  },
  {
   "name": "textEdits",
   "type": "object[]",
   "required": false,
   "description": "DIFFERENTIAL SHAPE: `[{ find, replaceWith, expectedMatches? }]` applied to the whole brief. `find` is literal, byte for byte; `expectedMatches` omitted means exactly one hit, a number means exactly that many, `\"all\"` means every occurrence. Mutually exclusive with `action` and `content`."
  },
  {
   "name": "anchor",
   "type": "string",
   "required": false,
   "description": "Section anchor to address for `insert_after_section`. Unknown anchor degrades to append-at-end with a warning."
  },
  {
   "name": "heading",
   "type": "string",
   "required": false,
   "description": "Heading text to address for `insert_after_section`, as an alternative to `anchor`."
  },
  {
   "name": "expectedHash",
   "type": "string",
   "required": true,
   "description": "sha256 of the brief as you last read it. Missing → VALIDATION; mismatch → BRIEF_CONFLICT carrying the current hash."
  },
  {
   "name": "changeSummary",
   "type": "string",
   "required": false,
   "description": "One-line description of what this edit changes, recorded with the version."
  }
 ],
 "returns": "`{ newHash, replacements? }` — `newHash` to sha256 treści po zapisie, gotowy jako `expectedHash` kolejnej edycji; `replacements` (liczba wykonanych podmian) tylko w kształcie `textEdits`. Bez zserializowanego briefu. Fallback po nieznanym anchorze wraca z ostrzeżeniem, nie z błędem.",
 "sampleReturn": null,
 "readOnlyHint": 0,
 "destructiveHint": null,
 "idempotentHint": 0,
 "openWorldHint": null,
 "logic": "Renderowanie MCP operacji `update_brief` (M21).\n\nKształt wejścia rozstrzygany na wejściu: `textEdits` razem z `action`/`content` albo żaden z nich → `VALIDATION`, przed dotknięciem pliku. `textEdits` stosuje kontrakt trybu różnicowego M43 (literal-match, match-count-declared, edit-set-not-procedure).\n\n`expectedHash` jest obowiązkowy z kontraktu, nie ze schematu: implementacja, która przy braku parametru podstawia świeżo odczytany hash, spełnia schemat i **nie** spełnia kontraktu.\n\nPróba zmiany pola frontmatteru spoza `implemented` → `IMMUTABLE_FIELD`, kod wspólny dla wszystkich kindów artefaktu (guard w generycznej rodzinie M36).\n\nEfekty uboczne: plik w korzeniu `briefs`, nowa pozycja `file_version` keyed `(rootId='briefs', path)`, notyfikacja `file:changed`. `replace` idempotentne po treści; `append`, `insert_after_section` i `textEdits` nie.",
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-20T18:42:43.586Z",
 "updatedAt": "2026-10-08T21:24:42.902Z"
}
```

### spreadsheet `katalog-operacji-m21` (op: update) — per-entity

Parts: role **built**; items: every operation row (rows 2..n); key: `nazwa`. Items in scope: `katalog-operacji-m21#get_brief`, `katalog-operacji-m21#list_briefs`, `katalog-operacji-m21#update_brief`, `katalog-operacji-m21#mark_brief_implemented`, `katalog-operacji-m21#list_brief_versions`, `katalog-operacji-m21#get_brief_version`, `katalog-operacji-m21#create_brief`
inCode: brief operation descriptors in src/server/operations/core-operations.ts and profiles.ts + channel renderings (MCP brief-tools, CLI, REST). verify: vitest in src/server/operations/catalog.test.ts (or *-tools.test.ts) named [entity:katalog-operacji-m21#<operation>].

#### row 2

- **nazwa**: `get_brief` — treść + frontmatter + hash jednego briefu
- **zasięg**: `project`
- **mediacja**: `direct`
- **internal**: `direct`
- **cli**: `direct`
- **mcp**: `direct`
- **rest**: `direct`
- **efekty**: `brak`
- **idempotencja**: `tak` — odczyt nie zmienia stanu
- **adresowanie**: `path`; okno odczytu `range?`
- **opis treści**: `n/d` — operacja odczytu
- **guard**: `n/d` — odczyt niczego nie nadpisuje
- **krotność**: `jedno-celowa` — brief jest zakotwiczony w wątku, więc wołający ma jeden adres
- **reguły**: `echo-free`, `error-code-once`, `explicit-addressing`
- **kody błędów**: `BRIEF_NOT_FOUND`, `INVALID_ARGUMENT`

#### row 3

- **nazwa**: `list_briefs` — stronicowana lista briefów (filtr `implemented`)
- **zasięg**: `project`
- **mediacja**: `direct`
- **internal**: `direct`
- **cli**: `direct`
- **mcp**: `direct`
- **rest**: `direct`
- **efekty**: `brak`
- **idempotencja**: `tak` — odczyt nie zmienia stanu
- **adresowanie**: filtr `implemented`; stronicowanie `limit` / `offset`, a `total` liczony **po** filtrze i przed oknem
- **opis treści**: `n/d` — operacja odczytu
- **guard**: `n/d` — odczyt niczego nie nadpisuje
- **krotność**: `jedno-celowa` — jedno zapytanie o zbiór
- **reguły**: `echo-free`, `error-code-once`
- **kody błędów**: `VALIDATION`

#### row 4

- **nazwa**: `update_brief` — edycja akcją (`replace` / `append` / `insert_after_section`) albo dosłownymi podmianami `textEdits`
  - _before_: `update_brief` — hybrydowa edycja (`replace` / `append` / `insert_after_section`)
- **zasięg**: `project`
- **mediacja**: `direct`
- **internal**: `direct`
- **cli**: `direct`
- **mcp**: `direct`
- **rest**: `direct`
- **efekty**: `plik`, `db`, `ui-notify`
- **idempotencja**: `warunkowa` — `replace` idempotentny po treści; `append`, `insert_after_section` i `textEdits` nie
  - _before_: `warunkowa` — `replace` idempotentny po treści; `append` i `insert_after_section` nie
- **adresowanie**: `path`; punktowo `anchor` albo `heading`, przy czym nieznany anchor daje fallback append-at-end z ostrzeżeniem, nie błąd
- **opis treści**: `obydwa` — dokładnie jeden kształt na wywołanie: akcja z pełną treścią adresowanego zakresu w `content` (dosłownie) albo `textEdits` na całym briefie (różnicowo); oba naraz albo żaden to `VALIDATION`
  - _before_: `dosłowny` — pełna treść adresowanego zakresu w `content`; trybu różnicowego ta wersja nie oferuje
- **guard**: `wymagany` — `expectedHash` obowiązkowy, a jego brak to `VALIDATION`: brief edytują równolegle tura wątku `brief`, człowiek w UI i agent-implementer w terminalu, więc last-write-wins gubi cudzą pracę bez śladu. Implementacja podstawiająca świeżo odczytany hash spełnia schemat i **nie** spełnia kontraktu
- **krotność**: `jedno-celowa` — „edytuj N briefów naraz” nie istnieje w żadnym kanale, a adresowanie punktowe działa wewnątrz jednego briefu
- **reguły**: `echo-free`, `error-code-once`, `explicit-addressing`, `destructive-declared`, `operation-only-write`
- **kody błędów**: `BRIEF_NOT_FOUND`, `BRIEF_CONFLICT`, `IMMUTABLE_FIELD`, `VALIDATION`

#### row 5

- **nazwa**: `mark_brief_implemented` — ustawienie `implemented` we frontmatterze
- **zasięg**: `project`
- **mediacja**: `direct`
- **internal**: `direct`
- **cli**: `direct`
- **mcp**: `direct`
- **rest**: `direct`
- **efekty**: `plik`, `db`, `ui-notify`
- **idempotencja**: `tak` — powtórka na tej samej wartości to no-op
- **adresowanie**: `path`
- **opis treści**: `n/d` — mutuje wyłącznie frontmatter
- **guard**: `n/d` — jedno pole frontmatteru, więc równoległe wywołania zbiegają się do tej samej wartości
- **krotność**: `jedno-celowa` — deklaracja dotyczy jednego briefu
- **reguły**: `echo-free`, `error-code-once`, `explicit-addressing`, `operation-only-write`
- **kody błędów**: `BRIEF_NOT_FOUND`, `IMMUTABLE_FIELD`

#### row 6

- **nazwa**: `list_brief_versions` — historia wersji z `file_version`, metadane bez treści
- **zasięg**: `project`
- **mediacja**: `direct`
- **internal**: `direct`
- **cli**: `direct`
- **mcp**: `direct`
- **rest**: `direct`
- **efekty**: `brak`
- **idempotencja**: `tak` — odczyt nie zmienia stanu
- **adresowanie**: `path`; okno historii przez `limit` / `offset`
- **opis treści**: `n/d` — operacja odczytu
- **guard**: `n/d` — odczyt niczego nie nadpisuje
- **krotność**: `jedno-celowa` — historia dotyczy jednego briefu
- **reguły**: `echo-free`, `error-code-once`, `explicit-addressing`
- **kody błędów**: `BRIEF_NOT_FOUND`

#### row 7

- **nazwa**: `get_brief_version` — snapshot wskazanej wersji
- **zasięg**: `project`
- **mediacja**: `direct`
- **internal**: `direct`
- **cli**: `direct`
- **mcp**: `direct`
- **rest**: `direct`
- **efekty**: `brak`
- **idempotencja**: `tak` — snapshot wersji jest niezmienny
- **adresowanie**: para `(path, version)`
- **opis treści**: `n/d` — operacja odczytu
- **guard**: `n/d` — odczyt niczego nie nadpisuje
- **krotność**: `jedno-celowa` — punktowy snapshot po wskazaniu wersji
- **reguły**: `echo-free`, `error-code-once`, `explicit-addressing`
- **kody błędów**: `BRIEF_NOT_FOUND`

#### row 8

- **nazwa**: `create_brief` — powołanie briefu z gotowym ciałem albo dla zadanego okna release'ów
- **zasięg**: `project`
- **mediacja**: `direct`
- **internal**: `n/a` — tura wątku `brief` jest zakotwiczona w jednym artefakcie i pisze jego treść; powołanie kolejnego briefu nie jest czynnością autora briefu
- **cli**: `direct` — `c4s create-brief`, ciało z `--body-file`
- **mcp**: `direct` — jak w `rest`; komórka jest deklaracją bez pokrycia, dopóki nie powstanie renderowanie
- **rest**: `direct`
- **efekty**: `plik`, `db`, `ui-notify`
- **idempotencja**: `nie` — każde wywołanie powołuje nowy brief i zakłada wątek initial
- **adresowanie**: okno release'ów — para `(from, to)` z dopuszczalnym otwartym końcem; `suffix` rozstrzyga kolizję sluga
- **opis treści**: `dosłowny` — pełne ciało briefu w `content`, niepuste po trim albo `VALIDATION`; pominięcie `content` zostawia plik z samym nagłówkiem, a treść dopisuje osobne `update_brief`
- **guard**: `n/d` — powołanie nowego artefaktu nie ma stanu do obrony
- **krotność**: `jedno-celowa` — jedno okno na wywołanie
- **reguły**: `echo-free`, `error-code-once`
- **kody błędów**: `BRIEF_SAME_RELEASE`, `VALIDATION`

## Criteria (ac)

### `ac-brief-nie-jest-page-rootem-zyje-w-bri` (op: update)

before:
```json
{
 "slug": "ac-brief-nie-jest-page-rootem-zyje-w-bri",
 "title": "Brief żyje w korzeniu systemowym `briefs`, a jego wiersze w `file_version` mają `rootId = 'briefs'`.",
 "kind": "requirement",
 "status": "active",
 "verifies": [],
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-21T07:48:43.025Z",
 "updatedAt": "2026-10-05T15:40:15.987Z"
}
```
after:
```json
{
 "slug": "ac-brief-nie-jest-page-rootem-zyje-w-bri",
 "title": "Brief żyje w korzeniu systemowym `briefs`, a jego wiersze w `file_version` mają `rootId = 'briefs'`.",
 "kind": "requirement",
 "status": "active",
 "verifies": [
  {
   "type": "database-table",
   "slug": "file-version"
  }
 ],
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-21T07:48:43.025Z",
 "updatedAt": "2026-10-09T09:54:40.655Z"
}
```

### `ac-wersjonowanie-briefu-reuse-uje-tabele` (op: update)

before:
```json
{
 "slug": "ac-wersjonowanie-briefu-reuse-uje-tabele",
 "title": "Wersjonowanie briefu reuse'uje tabelę `file_version` z `rootId = 'briefs'` — każda zmiana z UI, od agenta i z filesystemu wstawia wiersz z odpowiednim `changedBy` (`user` / `agent` / `filesystem`), bez żadnej nowej tabeli.",
 "kind": "requirement",
 "status": "active",
 "verifies": [],
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-21T07:48:43.001Z",
 "updatedAt": "2026-10-05T15:40:15.990Z"
}
```
after:
```json
{
 "slug": "ac-wersjonowanie-briefu-reuse-uje-tabele",
 "title": "Wersjonowanie briefu reuse'uje tabelę `file_version` z `rootId = 'briefs'` — każda zmiana z UI, od agenta i z filesystemu wstawia wiersz z odpowiednim `changedBy` (`user` / `agent` / `filesystem`), bez żadnej nowej tabeli.",
 "kind": "requirement",
 "status": "active",
 "verifies": [
  {
   "type": "database-table",
   "slug": "file-version"
  }
 ],
 "tags": [
  "m21"
 ],
 "createdAt": "2026-08-21T07:48:43.001Z",
 "updatedAt": "2026-10-09T09:54:40.657Z"
}
```

## Linked entities at 2.1.14 (context, not built)

### database-table `file-version`
```json
{
 "slug": "file-version",
 "title": "file_version",
 "description": "Append-only versioning plikow-na-dysku (M17, rownolegle do entity_version dla encji-w-SQLite — to jest wlasnie dychotomia systemu: file_version vs entity_version). Rename z page_version (D10): tabela obejmuje ZAROWNO strony Page Rootow (M02) JAK I artefakty czatu (M36: brief/patch/plan). M02 NIE jest pluginem M13 — pliki maja wlasna sciezke z wlasnym FileSerializerem (poza L9). Kazda mutacja pliku (PUT /api/pages/:rootId/*, PUT /api/artifacts/:kind/:path/content, agent Write tool, FSWatcher chokidar) tworzy nowy wiersz przez wspolny FileVersionService (keyed (rootId, path)). Wpis 'wiszacy' (release_id = NULL) zostaje przypisany przy nastepnym createRelease. Tozsamosc pliku i sekwencja wersji: (rootId, path). rootId = id Page Rootu dla stron, lub literalny marker 'brief'/'patch'/'plan' dla artefaktow czatu — te NIE sa Page Rootami (brak wpisu w config.roots[]). HISTORIA A PRZEMIANOWANIE PRZESTRZENI: jawna zmiana identyfikatora rootu (M01) NIE dotyka tej tabeli — wiersze zapisane wczesniej zachowuja wycofany rootId, nowe niosa biezacy, i ZADNA migracja ich nie rekeyuje. Wiersz historii jest zapisem stanu z chwili zapisu, wiec przestemplowanie go nowym adresem skasowaloby informacje, pod jakim adresem ta wersja powstala. Ciaglosc daje ODCZYT: zapytanie o historie przestrzeni rozwija jej lancuch identyfikatorow (biezacy + wycofane przez zarejestrowane przejscia) i czyta rootId IN (<lancuch>); rozwiniecie lancucha nalezy do rejestru rootow (M02), tabela nie trzyma drugiej kopii tego odwzorowania. Przeniesienie POJEDYNCZEJ strony miedzy dwiema przestrzeniami to co innego i zostaje para tombstone/create.",
 "columns": [
  {
   "name": "id",
   "type": "INTEGER",
   "nullable": false,
   "pk": true,
   "default": "AUTOINCREMENT",
   "description": "PK"
  },
  {
   "name": "path",
   "type": "TEXT",
   "nullable": false,
   "description": "Sciezka pliku wzgledna do dir rootu (lub briefsDir/patchesDir/plansDir). Plain text, nie FK — pliki zyja na filesystemie, brak tabeli `page`. Ta sama path moze istniec w wielu zrodlach — tozsamosc to (rootId, path). Przyklad: 'modules/m01-auth.md'."
  },
  {
   "name": "version",
   "type": "INTEGER",
   "nullable": false,
   "description": "Sekwencyjny numer wersji per (rootId, path). Auto-inkrementowany jako MAX(version) + 1 WHERE path = :path AND rootId = :rootId w transakcji zapisu. Dla przestrzeni, ktora przeszla przemianowanie, MAX liczony jest po CALYM lancuchu jej identyfikatorow (biezacy + wycofane), nie po samym biezacym — inaczej numeracja strony startowalaby od nowa na granicy przemianowania."
  },
  {
   "name": "data",
   "type": "TEXT",
   "nullable": false,
   "description": "JSON serializowany przez FileSerializer.snapshot(path) — FileSnapshotData: { path, content, frontmatter, anchors[], xml_refs[] }. Kontrakt szczegolowy w m02-pages.md sekcja 'Page versioning (M17)'."
  },
  {
   "name": "serializer_version",
   "type": "TEXT",
   "nullable": false,
   "description": "Wersja FileSerializera ('1.0.0'). Wymagane dla cross-project import (M27) i diff fallback przy schema bumpach."
  },
  {
   "name": "op",
   "type": "TEXT",
   "nullable": false,
   "enumValues": [
    "create",
    "update",
    "delete"
   ],
   "description": "Typ operacji. Walidacja w aplikacji, bez CHECK constraint. op='delete' to tombstone — `data` zachowuje ostatnia tresc przed usunieciem (do restore'u)."
  },
  {
   "name": "rootId",
   "type": "TEXT",
   "nullable": false,
   "default": "pages",
   "description": "Dyskryminator przestrzeni pliku. Dla stron Page Rootu (L13) = id rootu: 'pages' (domyslne id rootu podstawowego) lub slug user-rootu. Dla artefaktow czatu (M36) = literalny MARKER 'brief' (M21) / 'patch' (M23) / 'plan' (M10) — artefakty NIE sa Page Rootami (brak wpisu w config.roots[]), wiec wartosc to marker, nie id rootu. UWAGA: wartosc to identyfikator Z CHWILI ZAPISU, nie zawsze biezacy — po przemianowaniu przestrzeni starsze wiersze niosa identyfikator wycofany i nie sa rekeyowane. Poprawnym predykatem jest wiec przynaleznosc do lancucha identyfikatorow przestrzeni, nie rownosc z jedna wartoscia: releaseService.assignToRelease()/getReleaseSnapshot()/getReleaseDiff() filtruja WHERE rootId IN (identyfikatory releasable rootow, kazdy rozwiniety o swoje wycofane) — markery brief/patch/plan (spoza roots[]) i nie-releasable user-rooty wykluczone z release'ow. Zakaz powrotu wycofanego identyfikatora do innej przestrzeni (M01) jest warunkiem rozstrzygalnosci tego odczytu. Wartosci dynamiczne (user-rooty + markery), bez CHECK/enum. Niezalezna os czasu per przestrzen."
  },
  {
   "name": "release_id",
   "type": "INTEGER",
   "nullable": true,
   "fk": {
    "table": "spec_release",
    "column": "id"
   },
   "description": "FK do spec_release. NULL = wpis 'wiszacy', przypisany przy nastepnym createRelease. ON DELETE SET NULL — usuniecie release'a (out-of-scope MVP) nie kasuje historii. Wpisy z markerem brief/patch/plan (nie-roota) oraz nie-releasable user-rooty zostaja NULL na zawsze."
  },
  {
   "name": "changed_by",
   "type": "TEXT",
   "nullable": false,
   "enumValues": [
    "user",
    "agent",
    "filesystem"
   ],
   "description": "Origin zmiany: 'user' (UI lub restorePage), 'agent' (Write tool przez chat M05), 'filesystem' (FSWatcher chokidar wykryl edycje w IDE poza tool'em — wzorzec self-write detection z M02). Walidacja w aplikacji."
  },
  {
   "name": "created_at",
   "type": "TEXT",
   "nullable": false,
   "default": "datetime('now')",
   "description": "Timestamp wersji. Append-only, brak updated_at."
  }
 ],
 "indexes": [
  {
   "columns": [
    "path",
    "rootId",
    "version"
   ],
   "name": "uq_file_version_path_root_version",
   "unique": true
  },
  {
   "columns": [
    "release_id"
   ],
   "name": "idx_file_version_release_id",
   "unique": false
  },
  {
   "columns": [
    "rootId",
    "path"
   ],
   "name": "idx_file_version_root_path",
   "unique": false
  }
 ],
 "tags": [],
 "createdAt": "2026-07-14T20:35:53.000Z",
 "updatedAt": "2026-09-20T18:57:20.596Z"
}
```

## Conventions (at 2.1.14)

### pages/layers/L3-spec-operations.md

#### [zr4rjlir] 

<after_change>
Jednostką tej warstwy jest **operacja** — nazwana rzecz, którą można zrobić z zawartością specyfikacji albo z turą agenta nad tą zawartością. Narzędzie MCP, komenda `c4s` i endpoint REST **nie są bytami tej warstwy**; są *renderowaniami* operacji w konkretnym kanale.

Rozróżnienie jest po to, żeby pytanie „czy X da się zrobić z zewnątrz" miało jedną odpowiedź. Wcześniej ta sama rzecz była porządkowana raz po serwerze MCP, raz po komendzie, raz po `context_type`, raz po endpoincie — i nie było wiersza per operacja w żadnym z tych układów, więc odpowiedź trzeba było składać z pięciu stron i bywała sprzeczna.
</after_change>

#### [kehuh3fj] L3 — Spec Operations

<after_change>**Implementor module: M43 — Spec Operations Core.**

Implementator tej warstwy jest właścicielem **reguł, nie runtime'u**, i to odstępstwo trzeba przeczytać wprost, żeby nie szukać procesu, którego nie ma. Runtime powierzchni operacji nie istnieje jako jeden byt: **każdy kanał ma innego adaptera wejściowego**, a adaptery te nie mają wspólnego rejestru, wspólnego cyklu życia ani wspólnego punktu montowania. Rola „runtime powierzchni operacji" pozostaje więc **rozdzielona**, a każdy jej fragment deklaruje moduł renderujący dany kanał — w swojej sekcji tej warstwy, nie tutaj.

Co implementator skupia, to **brzmienie reguł wiążących więcej niż jedną operację**, każdej pod stabilnym identyfikatorem. Wiersz katalogu regułę **cytuje po identyfikatorze**; przepisanie jej brzmienia do modułu jest drugim źródłem prawdy dokładnie tej klasy, którą ta warstwa likwiduje. Bez tego domu reguła wspólna nie ma gdzie stanąć i osiada albo w tym pliku, który ma być cienki, albo — częściej — w każdej sekcji modułu z osobna, co jest obserwowaną przyczyną puchnięcia sekcji tej warstwy.

**Umowa z warstwami renderowania — rówieśnicy, nie piętra.** Ta warstwa nie jest nadzbiorem konwencji REST (`@layers/L4-api.md`) ani konwencji powierzchni komendowej (`@layers/L14-cli-commands.md`). Zbiory się przecinają i żaden nie zawiera drugiego: są trasy REST poza katalogiem (SSE, upload, ustawienia, git) i są operacje, których żaden kanał sieciowy nie renderuje. Podział własności jest za to rozłączny: **tutaj mieszka osiągalność — czy, skąd i na jakich prawach operację da się wywołać; tam mieszka kształt renderowania — metoda, ścieżka, nazwa komendy, flagi, koperta odpowiedzi.** Stąd dwa zakazy, po jednym w każdą stronę: pole kanału nigdy nie niesie ścieżki ani nazwy komendy, a trasa albo komenda po tamtej stronie nigdy nie powtarza zasięgu, klasy mediacji ani idempotencji. Powtórzenie w którąkolwiek stronę jest drugim źródłem prawdy dokładnie tej klasy, którą ta warstwa likwiduje.

**Katalog operacji nie jest listą w tym pliku.** Katalog to **suma sekcji L3 wszystkich modułów** — każdy moduł deklaruje operacje, których jest rdzeniem-właścicielem, w arkuszu o kształcie ustalonym w <section_ref anchor="l3slice0"/>. Centralna tabela w warstwie byłaby drugim źródłem prawdy, starzejącym się przy każdej zmianie modułu — czyli dokładnie tym driftem, który ta warstwa likwiduje. Katalog jest przeszukiwalny dzięki **jednolitości kształtu wiersza**, nie dzięki fizycznej centralizacji.

Kontrakt wire zamontowanego serwera ma **jeden dom, wyznaczony deterministycznie** — stoi tam, gdzie wiersz katalogu odpowiadającej operacji, i jest regułą wypełniania sekcji modułu (<section_ref anchor="p3th8bt4"/>).</after_change>

#### [l3slice0] L3 — Spec Operations

<after_change>
Sekcja modułu nosi nagłówek `## Spec Operations (L3)` i przyjmuje **jedną z trzech postaw**:

1. **Wnoszę operacje.** Moduł jest rdzeniem-właścicielem semantyki co najmniej jednej operacji i wypisuje je w arkuszu katalogu (niżej). Moduł, który wnosi choćby jedną trasę REST nad zawartością specyfikacji, jest w tej postawie i sekcji nie pomija.
2. **Konfiguruję kanał albo mechanizm, bez własnych operacji.** Moduł dostarcza adapter kanału, bramkę profilu albo mechanizm wspólny dla operacji cudzych, ale sam nie jest rdzeniem-właścicielem żadnego wiersza. Nagłówek **nie nosi sufiksu**, a sekcja jest **prozą**: co moduł wnosi do powierzchni i czego konsumenci mogą się po nim spodziewać. W tej samej postawie stoi **implementator warstwy**, czytając ten schemat w trybie how-mode: nie deklaruje własnych wierszy, tylko mówi, na co konsument może liczyć, wypełniając swój arkusz. Arkusza katalogu nie ma, bo nie ma czego w nim wypisać — a `— n/d` byłoby nieprawdą, skoro moduł warstwy dotyka.
3. **Nie dotykam warstwy.** `## Spec Operations (L3) — n/d` z jednym zdaniem powodu.

Postawa druga istnieje dlatego, że runtime powierzchni operacji jest **rozdzielony między kanały** (<section_ref anchor="kehuh3fj"/>): moduł niosący adapter jednego z nich ma o tej warstwie dużo do powiedzenia i ani jednego własnego wiersza. Bez tej postawy musiałby kłamać jednym z dwóch pozostałych sposobów.
</after_change>

#### [g8adono9] L3 — Spec Operations > Module slice schema

<after_change>Katalog modułu jest **encją `spreadsheet`** osadzoną w sekcji, nie tabelą markdown. Dane są strukturalne i siatkę przegląda się okiem, a nie czyta jako tekst; ta sama konwencja obsługuje moduł o czterech operacjach i moduł o czternastu, a wiersz o piętnastu polach przestaje się łamać, gdy dochodzi kolumna.

| Element | Wartość |
|---|---|
| slug | `katalog-operacji-mNN` |
| tytuł | `Katalog operacji (MNN)` |
| tagi | `mNN` — ten sam tag, po którym tagowane są encje `ac` i `mcp-tool` modułu — oraz `l3-katalog` |
| `headerRow` | `true`; wiersz 1 to nazwy pól |
| `headerCol` | `false`; kolumna 1 niesie nazwę operacji, a nie etykietę wiersza |
| `nCols` | `15`, bez wyjątku |
| osadzenie | `<single_element type="spreadsheet" slug="katalog-operacji-mNN" caption="…"/>` |

**Kształt wiersza jest projektowany jak schemat encji.** Trzynaście z piętnastu pól to enum albo krótka wartość, bo wiersz ma zostać **skanowalny okiem**: akapit wciśnięty w komórkę niszczy dokładnie tę własność, dla której arkusz istnieje. Lista jest **zamknięta i uporządkowana**:

| # | Pole | Wartość |
|---|---|---|
| 1 | `nazwa` | nazwa kanoniczna `snake_case`, wspólna dla wszystkich kanałów — kanał zmienia formę wywołania, nigdy nazwę operacji. Po myślniku **wolno** dopisać pół zdania, gdy sama nazwa nie odróżnia wiersza od sąsiedniego; pełny opis pod kątem agenta mieszka w encji renderowania (<section_ref anchor="a5qandln"/>) |
| 2 | `zasięg` | `project` \| `workspace`; opisuje **podmiot** operacji, nie jej dostępność (<section_ref anchor="l3axes00"/>) |
| 3 | `mediacja` | `direct` \| `agent-mediated` \| `human-mediated` (<section_ref anchor="l3media0"/>) |
| 4 | `internal` | wartość wg reguły routingu (<section_ref anchor="l3route0"/>) |
| 5 | `cli` | jw. |
| 6 | `mcp` | jw. |
| 7 | `rest` | jw. |
| 8 | `efekty` | wielokrotny, ze zbioru `brak` \| `plik` \| `db` \| `ui-notify` (<section_ref anchor="mzk6gtao"/>) |
| 9 | `idempotencja` | `tak` \| `nie` \| `warunkowa — <powód>` (<section_ref anchor="temm15qp"/>) |
| 10 | `adresowanie` | co identyfikuje cel operacji — `(rootId, relPath)`, kotwica, slug, para ścieżek. Adres, nie opis parametru: miejsce parametru w żądaniu jest kształtem renderowania i należy do kanału |
| 11 | `opis treści` | czym wołający opisuje nową treść: `dosłowny` \| `różnicowy` \| `obydwa` \| `n/d` |
| 12 | `guard` | guard współbieżności: `wymagany` \| `opcjonalny` \| `n/d — <powód>` |
| 13 | `krotność` | `batch` \| `jedno-celowa — <powód>` |
| 14 | `reguły` | lista identyfikatorów reguł wiążących; wykluczenie zapisuje się jako `bez <id> — <powód>`. Wiersz regułę **cytuje, nigdy nie streszcza** — słownik identyfikatorów jest zamknięty i należy do implementatora warstwy. Cytowaniu podlega reguła, której nie domyka żadna kolumna (niżej) |
| 15 | `kody błędów` | lista kodów, deklarowana raz i mapowana per kanał |

**Granica pola `reguły` jest mechaniczna: cytuje się regułę, której nie domyka żadna kolumna.** Trzy reguły słownika są spełnione przez samo istnienie pola, w które każą wpisać wartość — `guard-declared` domyka pole 12, `batch-required` pole 13, `diff-mode-declared` pole 11. Wypisanie ich w polu 14 powtarza informację, którą wiersz niesie kolumnę obok, więc jest szumem, a nie rygorem. Każda pozostała reguła kolumny nie ma, więc wiersz, który jej nie cytuje, **przemilcza zobowiązanie** — dotyczy to także `destructive-declared` i `match-count-declared`, których nazwa sugeruje deklarację, choć w kształcie wiersza nie ma pola, które by ją niosło. Wiersz, którego nie wiąże żadna reguła z tej reszty, nosi `n/d`; pustej komórki nadal nie ma. Test stosuje się do nazwy reguły, nie do jej brzmienia, więc nowa reguła w słowniku implementatora nie wymaga tu poprawki: albo dostaje kolumnę, albo jest cytowana.

**Cena formy arkuszowej jest zapisana, nie przemilczana.** Typ `spreadsheet` ma `searchableFields` równe `slug`, `title` i `tags[]` — **treść komórek nie jest indeksowana przez nic**. Wynikają stąd dwie konsekwencje i obie przyjmuje się świadomie:

1. **Tag `l3-katalog` nie jest ozdobą, tylko protezą.** Wyliczenie wszystkich katalogów naraz jest **wyłącznie** zapytaniem po tym tagu; bez niego katalog przestaje być osiągalny jako całość, a to jest dokładnie ta własność, dla której ta warstwa powstała.
2. **Pytanie odwrotne pozostaje bez odpowiedzi maszynowej.** „Które operacje wiąże reguła `echo-free`?" ani „gdzie zadeklarowano guard jako wymagany?" nie da się zadać żadnym zapytaniem — trzeba otworzyć arkusze i przeczytać je okiem. Przy zmianie brzmienia reguły jest to realny koszt utrzymania i ponosi go implementator warstwy, a nie autor wiersza. Formą, która zdejmuje ten koszt w całości, jest **typ encji per operacja**: piętnaście pól staje się wtedy **filtrowalne**, a nie tylko czytelne. Ta droga jest przyjętym kierunkiem — nic w tej konwencji jej nie zamyka i nic jej nie wymusza.

**Komórka niezapisana jest komórką pustą, a pusta jest błędem specyfikacji** — i w arkuszu trzeba to wymusić po stronie wymiarów, nie po stronie oka. Pusta wartość nie jest w arkuszu w ogóle przechowywana, więc luka nie wygląda jak puste pole — nie wygląda na nic. Stąd wymóg: **`nCols` arkusza równa się piętnaście, a każdy wiersz ma zapisaną wartość w każdej z piętnastu kolumn**, przy czym `n/a — <powód>`, `n/d` i `poza katalogiem — <powód>` **są** wartościami (<section_ref anchor="l3route0"/>). Reguła nie ma wyjątku dla pola, którego wartość w danym module wychodzi jednolita: milczenie o czymś oczywistym i milczenie o czymś niesprawdzonym wyglądają identycznie.

**Kryterium rozdziału między wierszem a encją kanału — jedno pytanie.** *Czy ten fakt zmienia się, gdy zmienisz kanał?* Zmienia się → należy do encji kanału. Nie zmienia się → należy do wiersza albo do reguły wspólnej. Pytanie wynika wprost z twardego inwariantu warstwy (<section_ref anchor="l3locus0"/>), więc nie wymaga osobnego uzasadnienia, i tłumaczy podziały, które inaczej wyglądają na arbitralne: **kod** błędu jest polem wiersza, a **koperta** błędu należy do kanału; wymagalność guardu jest polem wiersza, a miejsce parametru w żądaniu — kształtem renderowania.

**Czego wiersz nie niesie.** Kształt zwrotki, nazwy i typy parametrów oraz opis pod kątem agenta idą do encji renderowania (<section_ref anchor="p3th8bt4"/>). Kroki łańcucha odpalanego po zapisie — indeksacja, capture wersji, token watchera — nie są ani polem wiersza, ani regułą wspólną: są substancją modułu, który ten łańcuch posiada, i stoją w jego sekcji domenowej. Pola `rdzeń-właściciel` i `locus wykonania` kolumn nie mają: pierwsze jest tożsame z modułem, w którego sekcji arkusz stoi, drugie jest stałą całej warstwy (<section_ref anchor="l3locus0"/>).</after_change>

#### [m2e2kanp] L3 — Spec Operations > Module slice schema

<after_change>
Nazwa kanoniczna operacji jest jedna; każdy kanał ma deterministyczną regułę jej renderowania.

| Element | Konwencja | Przykład |
|---------|-----------|----------|
| Nazwa operacji | `verb_noun`, snake_case; operacje batchowe w **liczbie mnogiej** | `create_entities`, `list_entities`, `tag_entity`, `link_dto` |
| Nazwa serwera MCP | kebab-case | `entity-tools`, `endpoint-tools`, `reference-tools`, `plan-tools` |
| Renderowanie `internal` / `mcp` | `mcp__{server}__{tool}` | `mcp__entity-tools__create_entities` |
| Renderowanie `rest` | metoda + ścieżka wg konwencji L4 | `POST /api/entities/:type` |
| Parametr wejściowy | camelCase | `pagePath`, `entityType`, `tagSlugs` |
| Pole wyjściowe | camelCase | `pageTree`, `entityList`, `brokenReferences` |

Renderowania w kanale `cli` ta tabela nie opisuje: nazwa komendy, jej flagi i argumenty są **kształtem renderowania**, więc należą do konwencji powierzchni komendowej, a nie tutaj (<section_ref anchor="kehuh3fj"/>). Wiąże stąd tylko tyle, że nazwa operacji pozostaje jedna, a komenda jest jej renderowaniem, nie drugą nazwą.

**Czasowniki:** `get` — pobierz jeden lub wskazane; `list` — pobierz kolekcję (z filtrami); `search` — full-text; `create` / `update` (partial) / `delete`; `add` — dodaj relację; `find` — wyszukaj relację.

**Zmiana nazwy serwera to zmiana nazwy narzędzia.** Nazwa serwera jest częścią identyfikatora widzianego przez model (`mcp__{server}__{tool}`), więc rozdzielenie albo scalenie serwerów przepisuje każde odwołanie do jego narzędzi — w promptach, w rendererze narzędzi klienta i w prozie spec. To realny koszt operacyjny takiej zmiany, nie kosmetyka; nazwa serwera raz wypuszczona do configów zewnętrznych klientów jest **kosztowna do poprawienia nawet wtedy, gdy zaczyna kłamać** o zakresie powierzchni.

**Ten koszt jest jedynym hamulcem dla wymogu batcha** (reguła `batch-required`): przejście operacji jedno-celowej na batchową zmienia jej nazwę na mnogą, więc jest zmianą identyfikatora, nie tylko schematu wejścia. Nie jest to powód, by wymogu nie stawiać — jest to powód, by koszt przemianowania był policzony w tym samym miejscu, w którym zapada decyzja.

**Jedna operacja bywa renderowana w REST więcej niż jedną trasą — pod jednym warunkiem.** Wiersz „Renderowanie `rest`" czyta się domyślnie jako 1:1, ale odwzorowanie jeden-do-wielu jest legalne wtedy i tylko wtedy, gdy tryby wejścia operacji mają **rozłączną semantykę HTTP** — `PUT` opisuje stan docelowy, `PATCH` modyfikację, `POST` akt. Wciskanie obu trybów w jedną trasę dałoby jeden URL o dwóch nieporównywalnych znaczeniach i rozjechałoby się z DTO tej trasy, w którym opis treści jest jeden. Rozdzielenie **nie jest** drugą semantyką operacji ani wyjątkiem od korolarza „jedna funkcja na operację" (<section_ref anchor="l3locus0"/>): obie trasy wołają tę samą funkcję rdzenia, a nazwa kanoniczna pozostaje jedna. Poza tym warunkiem obowiązuje 1:1 — dwie trasy o tej samej semantyce są duplikacją, nie renderowaniem.</after_change>

#### [3jnl3338] L3 — Spec Operations > Module slice schema

<after_change>
- **Wejście:** obiekt JSON, walidacja przez schemat deklarowany przy operacji.
- **Wyjście `internal` / `mcp`:** format content MCP — `{ content: [{ type: "text", text: string }] }`, dane serializowane jako JSON string.
- **Błąd `internal` / `mcp`:** `{ content: [{ type: "text", text: JSON.stringify({ error, code }) }], isError: true }`.
- **Wyjście / błąd `rest` i `cli`:** koperty własne kanału (L4 / L14), ale **kod błędu** jest ten sam — kanał mapuje taksonomię operacji, nie definiuje własnej.
- **Nawigacja w błędzie** jest częścią kontraktu operacji, nie uprzejmością kanału: `NOT_FOUND` niesie alternatywy, `INVALID_ARGUMENT` — ścieżkę naprawy.
</after_change>

#### [a5qandln] L3 — Spec Operations > Module slice schema

<after_change>
Każda operacja ma opis pisany pod kątem agenta: **co robi** (1 zdanie), **kiedy używać** (kontekst), **co zwraca** (krótko). Opis jest własnością operacji i jest ten sam we wszystkich kanałach agentowych.

Przykład: *„Read a specification page by path. Returns markdown content with XML entity references. Use when you need to understand what a page contains."*
</after_change>

#### [mzk6gtao] L3 — Spec Operations > Module slice schema

<after_change>Pole `efekty` przyjmuje wartości ze **zbioru zamkniętego**, wielokrotnie: **`brak`** (read-only) · **`plik`** (zapis do filesystemu) · **`db`** (indeks pochodny) · **`ui-notify`** (zdarzenie do UI). `brak` nie łączy się z żadną inną wartością.

Co dokładnie zmienia się w pliku, którą projekcję dotyka indeks i jakie zdarzenie leci do UI — to należy do modułu będącego rdzeniem-właścicielem operacji, nie do pola. Pole odpowiada na pytanie **czy**, moduł na pytanie **co**; wpisanie drugiego w pierwsze odbiera wierszowi skanowalność, dla której kształt pola jest enumem.

Deklaracja jest jedna dla operacji i nie zmienia się między kanałami, bo wykonanie jest to samo (<section_ref anchor="l3locus0"/>).</after_change>

#### [temm15qp] L3 — Spec Operations > Module slice schema

<after_change>Pole `idempotencja` przyjmuje `tak`, `nie` albo `warunkowa — <powód>`; trzecia wartość obsługuje operację, której idempotencja zależy od trybu wejścia, i powód jest jej częścią, nie komentarzem. Operacja batchowa deklaruje przy okazji semantykę częściowego powodzenia — koperta per item, brak transakcyjności.

Milczenie w tym polu jest luką także tam, gdzie wartość wychodzi jednolita dla całego modułu: z pustego pola czytelnik nie odróżni „oczywiście tak" od „nie sprawdzono".</after_change>

#### [vdf5esgb] L3 — Spec Operations > Module slice schema

<after_change>
Moduł będący właścicielem operacji nad **kindem artefaktu** (brief, patch, plan) wypełnia w swojej sekcji cztery pozycje ponad wiersz katalogu: **`list_<kind>s`**, **`get_<kind>` z oknem**, **`search_<kind>s`** i **budżet odpowiedzi**. Mechanizm każdej z nich — kształt okna, marker degradacji, wspólna taksonomia błędów, dialekt wzorca — jest wspólny dla wszystkich kindów i należy do modułu prowadzącego ich rejestr; do modułu-właściciela kindu należy **wartość**.

`n/a — <powód>` jest tu wartością legalną i wystarczającą, dokładnie na prawach reguły routingu (<section_ref anchor="l3route0"/>): bywa kind, dla którego przedmiotem operacji jest wyłącznie pojedynczy artefakt, a nie jego zbiór — wtedy pozycja `list_<kind>s` nosi zapisany powód zamiast wartości. Wymóg nie brzmi więc „miej wszystko", tylko **„zadeklaruj wartość dla każdej pozycji"**.

Powód jest ten sam, który stoi za zakazem pustego pola kanału i za wymogiem deklaracji guardu współbieżności (reguła `guard-declared`): **asymetria między kindami jest błędem specyfikacji wtedy i tylko wtedy, gdy jest niezapisana.** Z milczenia w tym miejscu wołający ma prawo wyczytać dwie rozbieżne rzeczy — że operacji świadomie nie ma, albo że po prostu jeszcze jej nie opisano — a tylko jedna z nich jest warta czekania.</after_change>

### pages/layers/L4-api.md

#### [lepbk8sv] 

<after_change>
> Grubość wire'u nad katalogiem operacji: metoda i ścieżka, kody statusu, koperta odpowiedzi, transporty specjalne i wyjątki od konwencji routingu — to, czego z samej operacji wyprowadzić się nie da.
</after_change>

#### [4ekrg55r] L4 — API

<after_change>
Warstwa jest framework-shaped: jeden implementor podnosi powierzchnię żądań i powierzchnię połączeń trwałych, trzyma rejestr zdarzeń i egzekwuje wspólną kopertę odpowiedzi, a konsumenci wnoszą do niej trasy i deklarują wyłącznie to, czym od konwencji odchodzą. REST jest tu **jedną powierzchnią o dwóch konsumentach** — interfejsem i wołającym programowym — a nie powierzchnią zarezerwowaną dla UI: szerokość rekordu dla obu ustala ten sam parametr `select` operacji rdzenia, nie osobna rodzina tras i nie osobna polityka per powierzchnia.

Warstwa **nie** mówi, co można zrobić — to katalog operacji — ani jak długo żyje obiekt obsługujący żądanie, ani która przestrzeń stron odpowiada pod danym adresem. Fiksuje grubość wire'u i nic ponad to.
</after_change>

#### [pondhd6o] L4 — API

<after_change>
**Każdy moduł dotykający tej warstwy wypełnia swoją sekcję `## API (L4)`:**

```
Powierzchnia  jeden embed <tagged_list type="endpoint" tags="<tag modułu>" filter="and"/>
              root pages   → tag `mNN` (sam numer modułu, bez sluga)
              root plugins → tag `entity-<typ>`
              bez ręcznych list slugów, bez tabel endpointów pisanych w prozie
DTO           embed <tagged_list type="dto" tags="<ten sam tag>" filter="and"/>
              pomijany, gdy moduł nie wnosi własnych DTO — koperty wspólne są w warstwie
Montowanie    `host` (CRUD generowany z pathPrefix) | `własny router: <prefiks>`
Odstępstwa    tabela poniżej; brak wierszy = moduł trzyma konwencję warstwy
Transport     pomijane, gdy wszystko jedzie JSON-em; inaczej wiersz per trasa — w tym
              zasób serwowany surowymi bajtami z własnym `Content-Type`, bez koperty
```

Tabela odstępstw: `| Trasa | Od czego odstępstwo | Dlaczego |`

**Pola stałe warstwy — moduł ich nie powtarza**, a jeżeli od któregoś odchodzi, wpisuje jego **nazwę** w kolumnę „Od czego odstępstwo". Nazwy są częścią kontraktu, nie ozdobnikiem: bez nich tabela odstępstw nie ma czego cytować.

| Pole | Treść |
|---|---|
| `Koperta` | `{data}` / `{data, total}` / `{error, code}`; moduł opisuje wyłącznie payload |
| `Kody` | zamknięta lista `200/201/400/404/409/500`; `DELETE` zwraca `200` z ciałem, nie `204` |
| `Content-Type` | `application/json` w żądaniu i odpowiedzi |
| `Paginacja` | `limit` + `offset`, domyślnie 50, maks. 200 |
| `Filtry` | filtr opcjonalny pominięty znaczy „wszystko"; wartość dosłowna w rodzaju `all` jest błędem walidacji, nie synonimem pominięcia |
| `Widok` | `view` wybiera projekcję inną niż domyślna trasy; pominięty znaczy projekcję domyślną. Widoki trasy deklaruje opis jej encji `endpoint`; wartość spoza nich oraz parametr należący wyłącznie do widoku jawnego, podany bez niego, to `400` — nie cichy powrót do projekcji domyślnej |
| `Ścieżki` | `kebab-case`, rzeczowniki w liczbie mnogiej |
| `Prefiks projektu` | nie jest częścią kontraktu endpointu |
| `Slug` | zmiana wyłącznie jawna, kolizja to `409` |

Kanoniczne koperty zostają w warstwie jako encje, nie jako proza — to zbiór **wspólny**, a DTO własne modułu idą w jego pole `DTO`, nie tutaj:

<element_list type="dto" slugs="entity-created-response,entity-updated-response,delete-entity-response,broken-reference"/>

**Moduł, który warstwy nie dotyka**, pisze nagłówek `## API (L4) — n/d` i jedno zdanie dlaczego. Jeden zapis, bez wariantów.

**Wypełnienie schematu stoi w jednym pliku modułu.** W module trzymanym w jednym pliku — w nim. W module już rozbitym na podstrony — w tej podstronie, która tę warstwę nosi, a plik główny niesie wtedy sam embed `Powierzchnia` i jedno zdanie-wskaźnik, bez powtarzania pozostałych pól. **Nowych podstron ani nowych plików pod ten schemat się nie zakłada:** rozbicie modułu na katalog jest osobną decyzją o kształcie modułu i nie zapada przy wypełnianiu warstwy — także wtedy, gdy wypełnienie wychodzi długie.

**Rejestr zdarzeń powierzchni połączeń trwałych jest jeden i należy do implementora.** Moduł emitujący zdarzenie nie deklaruje go u siebie — schemat nie ma pola na zdarzenia i jest to decyzja, nie przeoczenie: dwa rejestry rozjeżdżają się przy pierwszym dopisanym zdarzeniu.

**Reading mode — implementor:** sekcja tej warstwy w module-implementorze czytana jest w how-mode. Trzyma runtime — proces, port, gateway, adresowanie zdarzeń, egzekwowanie koperty — a nie wypełnienie schematu, bo implementor nie wnosi żadnej trasy własnej.

> **Implementor module:** `M49 — Local Server`
</after_change>

### pages/layers/L13-page-roots.md

#### [l13top001] 

<after_change>
> Konwencja, w której moduł obsługujący pliki specyfikacji albo **wnosi rodzaj korzenia** — dopisuje wartość do enumu rodzajów i deklaruje jej mapę plików, flagi i reakcje L7 — albo deklaruje, **którą flagę lub który rodzaj czyta**, zamiast wskazywać katalog.

</after_change>

#### [l13role01] L13 — Korzenie i rodzaje korzeni

<after_change>
L13 jest warstwą framework-shaped. Implementor:

- trzyma rejestr korzeni — korzenie z konfiguracji oraz korzenie zarejestrowane w kodzie;
- składa enum rodzajów z deklaracji modułów;
- rozstrzyga typ pliku z mapy rodzaju;
- egzekwuje flagi w jednym miejscu;
- montuje źródło zdarzeń każdego korzenia, podpina do niego reakcje L7 wybrane przez rodzaj, waliduje ich wymagania i dokłada reakcję bazową o zmianie pliku.

Warstwa nie definiuje transportu, routingu, wersjonowania ani indeksowania. Ustala wyłącznie kontrakt: **każde zachowanie per plik jest bramkowane flagą albo rodzajem korzenia, nigdy katalogiem ani identyfikatorem**.

</after_change>

#### [l13slice0] L13 — Korzenie i rodzaje korzeni

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

### pages/layers/L14-cli-commands.md

#### [1hlvn21h] 

<after_change>
> Konwencja, w której moduł wnosi swoje komendy do bin `c4s`. Warstwa fiksuje kształt opisu komendy i kontrakt kontrybucji; runtime CLI (dispatcher, resolver projektu/workspace, envelope błędów, formaty wyjścia, packaging) dostarcza implementor.

**Relacja do L3.** Komenda jest **renderowaniem** operacji z katalogu (`@layers/L3-spec-operations.md`), a nie osobnym bytem — semantyka, kody błędów i zasięg deklarowane są raz, w wierszu katalogu. L14 przeżywa jako osobna warstwa, bo niesie substancję **niewyprowadzalną** z operacji (tryb wykonania, flagi własne, exit codes, resolver projektu) i ma konsumenta spoza agenta: operatora maszyny. Dlatego bin `c4s` zawiera również komendy **poza** katalogiem — środowiskowe, których podmiotem nie jest zawartość specyfikacji.
</after_change>

#### [flt0hm9r] L14 — CLI Commands

<after_change>
Implementor module: **M11 — c4s (CLI + MCP)** (`modules/m11-c4s/L14-cli-commands.md`, sekcja „CLI Commands (L14)" — dispatcher, rejestr `CliCommandContribution`, własność envelope/`codeToExit`/wspólnych flag, katalog komend generycznych).

Każdy moduł-konsument opisuje swoje komendy w sekcji `## CLI (L14)` swojego pliku, wypełniając pola:

- **Komenda** — nazwa `c4s <cmd>` w kebab-case (wyjątek: generyczne readery XML-tagowe implementora używają underscore 1:1 z nazwą tagu) + tabela wywołań (wywołanie → znaczenie) lub zwięzła sygnatura z flagami. Samą nazwę wypełnia się wobec katalogu operacji warstwy operacji specyfikacji, w dwóch wariantach:

  1. komenda renderująca jeden wiersz katalogu 1:1 — pole niesie nazwę tej operacji przepisaną na kebab-case;
  2. komenda, której nazwa od nazwy operacji odchodzi — bo renderuje agregat kilku operacji, ustawia pojedyncze pole albo nie renderuje operacji katalogu wcale — uzasadnia to odejście w slice jednym zdaniem.

  Zakres jest wąski celowo: to wymaganie rozstrzyga wypełnienie tego pola, a nie to, z jakiego słownika wolno brać czasownik samej nazwy operacji — tamto należy do warstwy operacji specyfikacji i drugiego domu tutaj nie dostaje.
- **Tryb wykonania** — dokładnie jeden z: `server-delegating` (owija REST pod prefiksem `/api/projects/:id/…`, wymaga działającego serwera + health-check), `fs-scoped` (operuje na plikach spoza specyfikacji — repo kodu, katalog docelowy — bez serwera i bez db-slotu; jedyny wyjątek: komenda wywołana z jawnym `--server <url>` wykonuje przed zapisem **jeden odczyt** z tego serwera — sprawdzenie, że wskazane `id` projektu jest na liście projektów serwera — a sam zapis plików pozostaje lokalny i żadna operacja na specyfikacji nie idzie przez serwer), `registry-write` (server-free **zapis** do globalnego rejestru workspace'ów `~/.claude4spec/workspaces.json` — bez serwera, bez db-slotu, bez plików `cwd` projektu), `registry-read` (server-free **odczyt** globalnego rejestru workspace'ów `~/.claude4spec/workspaces.json` — bez serwera, bez db-slotu, bez plików `cwd` projektu i bez resolvera projektu), `scaffold` (server-free bootstrap **nowego** katalogu w CWD — bez serwera, bez db-slotu, bez rejestru workspace'ów i **bez rozwiązywania istniejącego projektu**: dispatcher nie stosuje resolvera `--project`/walk-up do `.claude4spec/`, więc komenda działa również poza jakimkolwiek projektem. Pobiera `FileSet` ze **zdalnego repozytorium git** i rozwija go do nowo utworzonego katalogu docelowego; wymagania środowiskowe: dostęp sieciowy + `git` na `$PATH`, opcjonalnie `npm` gdy komenda instaluje zależności po ekspansji). Deklaracja obowiązkowa — determinuje wymagania środowiskowe i zestaw błędów resolvera/health-check dziedziczonych z runtime implementora.

  **Tryb odpowiada na pytanie o przynależność, nie o mechanikę.** Odkąd wykonanie każdej operacji katalogu należy do procesu serwera — inwariant warstwy operacji specyfikacji — komenda czytająca specyfikację nie ma innej drogi niż `server-delegating` — a tryb przestaje mówić *„jak ta komenda działa"* i zaczyna mówić *„czy ta komenda jest w ogóle operacją na specyfikacji"*. Daje to darmowy test spójności: komenda w katalogu z trybem innym niż `server-delegating` jest błędem specyfikacji — i odwrotnie.

  Konsekwencja praktyczna: `fs-scoped` zostaje **wyłącznie** dla komend operujących na plikach spoza specyfikacji (instalacja skilli do repo kodu), a nie dla komend czytających czy piszących treść spec z pominięciem serwera. Tryb „czytam db-slot SQLite bez serwera" nie ma już ani jednego nosiciela: bezpośredni odczyt slotu przez obcy proces zniknął razem z inwariantem locus wykonania.
- **Flagi własne** — wyłącznie flagi specyficzne dla komendy; wspólnych selektorów (`--project <id>` / `--workspace` / `--server`) ani flag formatu (`--format` / `--compact`) nie deklaruje się ponownie — dziedziczone z runtime implementora. Projekt wskazuje wyłącznie jego `id`; przy braku `--project` domyślnie rozwiązuje go walk-up od katalogu roboczego — selektora ścieżkowego nie ma. Wyjątek: w trybie `scaffold` selektory projektu/workspace/serwera **nie obowiązują** (nie ma istniejącego projektu do wskazania) — komenda deklaruje własny cel operacji jako argument pozycyjny, a z runtime implementora dziedziczy wyłącznie envelope błędów, `codeToExit` i formaty wyjścia. Analogicznie w trybie `registry-read` selektory projektu/workspace'u **nie obowiązują** — komenda z definicji nie zawęża się do jednego workspace'u — a z runtime implementora dziedziczy wyłącznie envelope błędów, `codeToExit` i formaty wyjścia.
- **Kody błędów** — kody wnoszone przez komendę do unii `CliErrorCode` (nazwa + warunek + exit-code, jeśli niestandardowy); kody resolvera/health-check reuse'owane bez redeklaracji. Envelope (stderr JSON `{ error: { code, message, hint? } }` + exit >0) jest własnością implementora — slice go nie powtarza. Kod błędu, którego naprawa jest znana i daje się opisać krokami, niesie te kroki jako ustrukturyzowane deskryptory w payloadzie błędu, a nie wyłącznie jako prozę w `hint`.
- **Delegacja** — jedno zdanie „komenda deleguje do <core modułu-właściciela>" + grep-proof, gdy dotyczy; logika domenowa komendy żyje w core modułu, w bin trafia wyłącznie kontrybucja `CliCommandContribution` (kontrakt u implementora).
- **Output** *(opcjonalne)* — kształt payloadu wyjścia komendy (pola rekordu, porządek, jednostka wiersza). Bez envelope'u runtime implementora — formaty `--format json|text` i `--compact` są wspólne i nie deklaruje się ich per komenda. Pole opcjonalne: komenda, której wyjściem jest wyłącznie efekt uboczny na plikach, może je pominąć.
- **Kryteria akceptacji** — AC komendy jako encje `ac` tagowane tagiem AC modułu + `cli` (edge-case'y z `kind: edge-case`); renderują się we wspólnych embedach AC modułu — bez drugiego embeda w slice, chyba że moduł nie ma embeda AC (wtedy `<tagged_list type="ac" tags="mNN,cli" filter="and"/>` w slice).
</after_change>

## Stubs

None to close, none open (stubs.json empty).

## Jobs

None.

## Not yet

None.

## Completes

None.

## Remove

No `op: delete`; inside changed content: the `path` parameter of the brief operations in the `internal` channel is removed (schema in the brief thread no longer carries `path`; previously optional, defaulted from `chat_thread.brief_path`).
