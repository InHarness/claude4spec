# Packet — unit m11-cli-root-not-found
- window: 2.1.13 → 2.1.14 (delta)
- goal: see scope (CLI get-page refuses --range locally with INVALID_ARGS + hint get-page-outline → get-sections; unknown/system root id in page commands → ROOT_NOT_FOUND with pages-root list in hint, passed through from page router; old INVALID_ARGUMENT case removed)
- layers touched: L14 (CLI), L4 (page router REST error), L13 (roots, context)
- entities: 0 built; criteria: 3 (ac-c4s-get-page-root-id-id-path-p, ac-nieznany-root-id-podany-bez-towarzys, ac-list-pages-z-rootid-plans-konczy-sie)
- jobs: none
- packet size: ~93212 bytes

## Change (2.1.13 → 2.1.14) — pages/modules/m11-c4s/L14-cli-commands.md (change: all)
### pages/modules/m11-c4s/L14-cli-commands.md — Command surface [anchor: m11dcmds]

CLI eksponuje **komplet czternastu operacji rdzenia M39** — parytet transportowy z external MCP (M12), nie podzbiór. Parytet jest **operacyjny, nie nazewniczy**: nad jedną operacją rdzenia potrafi stać kilka nazwanych powierzchni CLI (pięć komend XML-tagowych nad `get_entities`), bo MCP robi to samo jednym toolem z parametrem `select`. To świadoma różnica ergonomii (<section_ref anchor="l3route0"/>), a nie rozjazd zestawu operacji — reguła zawężania z M39 (<section_ref anchor="d0pyocn8"/>) dotyczy **zbioru operacji rdzenia**, nie liczby nazw transportu nad jedną operacją.

**Każda komenda z tabeli poniżej ma `Tryb wykonania: server-delegating`** — kolumny trybu w niej nie ma, bo miałaby jedną wartość. Proces `c4s` składa wywołanie, dostaje wynik operacji po HTTP i formatuje go dla człowieka; nie otwiera db-slotu i nie buduje własnego rejestru pluginów. Dlatego `catalog`, `describe` i readery XML-tagowe widzą **dokładnie** ten zestaw typów encji, który widzi host serwera — zgodność jest konstrukcyjna, nie uzgodnieniowa (M33 <section_ref anchor="m33l11sc"/>).

Każdy znacznik encyjny M19 (<section_ref anchor="51bhppmd"/>) ma swój subcommand. Atrybuty tagu → flagi CLI (nazwy 1:1, underscore dla spojnosci z XML — `tagged_list` nie `tagged-list`). Pozostałe komendy używają **kebab-case** (slice schema L14) — underscore jest zarezerwowany dla generycznych readerów XML-tagowych.

**Ksztalt output kazdej komendy definiuje generacja rekordu odczytu (M13)** — nie CLI. Kolumna „Output" ponizej opisuje **ogolny ksztalt** (array/obiekt/z meta), a zawartosc elementow wynika ze schematu logicznego typu. Kolumna „Rzut" mówi, z jakim `select` komenda woła operację rdzenia (<section_ref anchor="34gccznx"/>): pusty rzut `[]` daje sam szkielet tożsamościowy, rzut pominięty — pełny rekord bez pól pod opieką.

| Komenda | Mapuje na | Flagi | Output shape | Rzut (`select`) |
|---------|-----------|-------|--------------|-----------------|
| `c4s inline_mention --type <t> --slug <s>` | `<inline_mention .../>` | `--type`, `--slug` | pojedynczy obiekt | `[]` (szkielet) |
| `c4s single_element --type <t> --slug <s>` | `<single_element .../>` | `--type`, `--slug` | pojedynczy obiekt | pominięty |
| `c4s element_list --type <t> --slugs <s1,s2>` | `<element_list .../>` | `--type`, `--slugs` (comma) | array (kolejnosc jak we flag) | `[]` (szkielet) |
| `c4s tagged_list --type <t> --tags <t1,t2> --filter <and\|or>` | `<tagged_list .../>` | `--type`, `--tags`, `--filter` | array | `[]` (szkielet) |
| `c4s tagged_list_mixed --tags <t1,t2> --filter <and\|or>` | `<tagged_list_mixed .../>` | `--tags`, `--filter` | `{ endpoints: [], dtos: [], database_tables: [] }` grouped | `[]` (szkielet) |
| `c4s detail --type <t> --slug <s>` | — (bez tagu XML) | `--type`, `--slug` | pojedynczy obiekt — pełny rekord | pominięty |
| `c4s get-entities --type <t> --slugs <s1,s2> [--select <f1,f2>]` | `get_entities` (kanoniczna powierzchnia) | `--type`, `--slugs` (comma), `--select` (comma; pusta wartość = `[]`) | array w kolejnosci wejscia + `selectedFields`; budżet odpowiedzi zamiast paginacji | wg `--select` |
| `c4s get-field-content --type <t> --slug <s> --field <f>` | odczyt treści pola pod opieką (<section_ref anchor="v0fldrd8"/>) | `--type`, `--slug`, `--field` | `{ type, slug, field, content, bytes }` | — |
| `c4s list-entities --type <t> [--tags <t1,t2>] [--tag-filter <and\|or>] [--sort createdAt\|title\|slug] [--dir asc\|desc] [--mode items\|count]` | `list_entities` (kanoniczna powierzchnia) | `--type`, `--tags`, `--tag-filter`, `--sort`, `--dir`, `--mode` | `{ type, items: [{ slug, title }], total, hasMore }` albo `{ type, total }` (`count`) | — (wiersz stały) |
| `c4s list-pages --root-id <id> [--prefix <p>] [--sort path\|modified]` | `list_pages` | `--root-id`, `--prefix`, `--sort` | array `(rootId, path)` + lekkie metadane (tytuł, liczba sekcji, rozmiar, mtime) | — |
| `c4s get-page-outline --root-id <id> --path <p>` | `get_page_outline` | `--root-id`, `--path` | drzewo sekcji w **kolejności dokumentowej** (anchor, tekst, poziom, dzieci) + **rozmiar** ciała własnego każdej sekcji | — |
| `c4s get-sections --anchors <a,b,c> [--include-subtree]` | `get_sections` | `--anchors` (comma), `--include-subtree` | `{ results: [...] }`, envelope per item; anchory żądane w kolejnosci wejscia, a przy `--include-subtree` poddrzewo każdego z nich dokumentowo za jego itemem | — |
| `c4s get-page --root-id <id> --path <p>` | `get_page` | `--root-id`, `--path` | koperta strony `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }` — sekcje jako itemy kluczowane kotwicą, w kolejności dokumentowej, tagi XML w `body` nietknięte; przy `--format text` strona złożona z koperty | — |
| `c4s search-pages (--query <q> \| --regex <r>) [--root-id <id>] [--path-include <re>] [--path-exclude <re>] [--anchors <a,b>] [--mode count\|map\|hits] [--context <n>]` | `search_pages` | `--query` XOR `--regex`, `--root-id`, `--path-include`, `--path-exclude`, `--anchors` (comma), `--mode` (default `map`), `--context` | trafienia jako unia dyskryminowana — sekcyjna (`anchor`, `heading`, `headingPath`, `matchCount`) albo stronowa (`(rootId, path)`, `matchCount`) dla dopasowania poza każdą sekcją (frontmatter, tekst nad pierwszym nagłówkiem); w `hits` dodatkowo `hunks[]` i `omittedChars`, w `count` same liczniki. Bez `score` i bez numeru linii | — |
| `c4s search-entities --type <t> (--query <q> \| --regex <r>) [--fields <f1,f2>] [--mode count\|map\|hits]` | `search_entities` | `--type` (wymagany), `--query` XOR `--regex`, `--fields`, `--mode` (default `map`) | `{ items, total, hasMore, searchedFields }`; wiersz `{ slug, title, matchCount }`, w `hits` dodatkowo `hunks[]` (`{ field, text, matches }`) i `omittedChars`, w `count` same liczniki. Bez `score` | — (wiersz stały) |
| `c4s check-consistency [--severity <s>] [--rule <r>] [--limit <n>]` | `check_consistency` | `--severity`, `--rule`, `--limit` | raport naruszen (kategoria + pozycja `(rootId, path)` / anchor / encja) | — |
| `c4s resolve-identity --query <q> [--types <t1,t2>] [--limit <n>]` | `resolve_identity` | `--query`, `--types`, `--limit` | kandydaci `{ type, slug, title, score }` z deterministycznym tie-breakiem | — |
| `c4s resolve <file.md>` | — (utility: odczyt lokalny + rozwijanie osadzeń rdzenia M19) | pozycyjny path; `--format json\|inline` | format wyniku definiuje rdzeń rozwijania (M19 <section_ref anchor="5mhf8s06"/>); `--format inline` wybiera tamtejszy format `inline` | — |
| `c4s catalog` | `overview` | `--format json\|text` | `{ claude4spec: "x.y.z", types: {T: {count, version, description, roleNoun, mcpToolsLine?}} }` — smoke test, bez `schema` (patrz wersjonowanie payloadu, M47) | — |
| `c4s describe --type <t>` | `describe_types` | `--type` (wymagany), `--format json\|text` | `{ types: [ { type, label, version, schemas, constraints, contentFields, selectableFields, searchableFields } ] }` — koperta rdzenia, jednoelementowa przy wymaganym `--type` | — |
| `c4s list-tags` | `list_tags` | `--with-counts?`, `--min-count?`, `--co-occurring-with?`, `--format json\|text` | lista tagów (`slug`, `name`, `color`, `description`, `counts?`, `coOccurrence?`) w kopercie paginacyjnej rdzenia (`total` + `hasMore`); liczniki **opt-in** (`--with-counts`, domyślnie wyłączone) | — |

**Aliasy nad `get_entities`.** Pięć komend XML-tagowych plus `detail` to **aliasy** kanonicznej powierzchni `get-entities` z ustalonym rzutem — nie osobne operacje rdzenia. Trzymają nazwę 1:1 z tagiem XML, bo zewnętrzny agent czyta tag w markdown i szuka komendy o tej samej nazwie; kasowanie ich byłoby stratą ergonomii bez zysku po stronie kontraktu.

**`list-slugs` znika — bez zamiennika, bo `list-entities` **jest** list-slugs.** Po zwężeniu wiersza do `{ slug, title }` skrót nie oszczędza już niczego, a niesie tytuł zamiast gołego sluga, czyli likwiduje N+1, dla którego skrót powstał. Dwie nazwy transportu nad jedną operacją są uzasadnione tylko wtedy, gdy różnią się ergonomią — tu przestały.

**Reżimy tożsamości w komendach stronowych i sekcyjnych.** Strona jest keyowana `(rootId, path)` — stąd `--root-id` obowiązkowy w `list-pages`, `get-page` i `get-page-outline`; brak cichego fallbacku na builtin `pages`. Sekcja jest keyowana samym `anchor` (globalnie unikalny), więc `get-sections` rootu nie przyjmuje. `get-page-outline` nie ma **ani trybu `query`, ani wariantu anchorowego** — to wierne odwzorowanie rdzenia, nie zawężenie transportu: M39 (<section_ref anchor="n9qp5ja7"/>) odmawia obu jawnie i wskazuje ścieżkę `search-pages` → trafienie niesie już `anchor` → `get-sections`. **Paginacji nie ma po żadnej stronie** — ani w narzędziu MCP, ani w tabeli flag CLI; to jedna deklaracja, nie dwie rozjeżdżające się (<section_ref anchor="8suur17i"/>).

**`--select` żyje wyłącznie przy `get-entities` (i jej aliasach).** Komendy stronowe rzutu nie mają, bo `select` wybiera z pól schematu logicznego encji, a strona schematu logicznego nie ma — flaga byłaby kontraktowo pusta (M39 <section_ref anchor="n9qp5ja7"/>). `list-entities`, `search-entities` i `resolve-identity` też jej nie mają, ale z innego powodu: ich wiersz jest wąski z kontraktu, więc **nie ma czego rzutować**. Podanie `--select` przy którejkolwiek z nich → `INVALID_ARGUMENT` z pointerem na `get-entities`.

**`c4s get-field-content` — jedyna droga do treści pola pod opieką.** Pole z flagą `contentBearing` nie wraca z żadnego odczytu, także przy jawnym `--select`: zamiast wartości przychodzi deskryptor z rozmiarem i nazwą operacji. Komenda jest **generowana przez hosta** z deklaracji pola, więc działa dla każdego typu z takim polem bez kontrybucji CLI; `--field` spoza schematu albo bez flagi → `INVALID_ARGUMENT` z listą pól pod opieką tego typu (`describe --type <t>` wypisuje je jako `contentFields`).

**`c4s get-sections` — fetch batchowy.** Envelope `results` w kolejności wejścia (po cichej deduplikacji), `SECTION_NOT_FOUND` jako **błąd itemu**, nie awaria całego wywołania; brak paginacji (fetch po kluczu), a wentyle wywołania — wraz z progami i z dwoma reżimami cięcia, odmową na wejściu i ucięciem po rozwinięciu `--include-subtree` — definiuje rdzeń i CLI ich nie przepisuje (<section_ref anchor="8suur17i"/>). Cięcie jest deterministyczne, a degradacja budżetowa startuje od itemu drugiego. Semantyka w całości z rdzenia (M39 <section_ref anchor="n9qp5ja7"/>) — CLI wnosi wyłącznie nazwę komendy i format wyjścia.

<before_change>**`c4s get-page` — format wyjścia.** JSON, domyślny i `--compact`, niesie kopertę rdzenia bez przepisywania (M39 <section_ref anchor="b61e5lbd"/>). `--format text` składa z niej stronę regułą serializacji M06 (<section_ref anchor="o8qmucgr"/>) — to formatowanie dla człowieka, nie drugi kształt odczytu.</before_change>
<after_change>**`c4s get-page` — format wyjścia.** JSON, domyślny i `--compact`, niesie kopertę rdzenia bez przepisywania (M39 <section_ref anchor="b61e5lbd"/>). `--format text` składa z niej stronę regułą serializacji M06 (<section_ref anchor="o8qmucgr"/>) — to formatowanie dla człowieka, nie drugi kształt odczytu. Okna linii komenda nie ma, tak jak operacja (M39 <section_ref anchor="984v8437"/>): `--range` jest odmawiany lokalnie, przed wywołaniem serwera, kodem `INVALID_ARGS` z podpowiedzią `get-page-outline` → `get-sections` — nigdy cicho pomijany, bo skrypt, który go podał, dostałby całą stronę w przekonaniu, że ją zawęził.</after_change>

**`c4s search-pages` — mapa najpierw, dowód potem.** Domyślny `--mode map` zwraca komplet współrzędnych bez ani jednego znaku treści, więc pełny sweep mieści się tam, gdzie `hits` już by się nie zmieścił; `--anchors` domyka ścieżkę `search-pages --mode map` → wybór kotwic → `search-pages --mode hits --anchors …` → `get-sections --anchors …`, w której nie zgaduje się `--limit`. `--path-include` / `--path-exclude` przyjmują wyrażenia regularne nad ścieżką strony — ten sam dialekt co `--regex`, bo dwa dialekty w jednym wywołaniu byłyby pułapką — i odsiewają pliki przed otwarciem, więc są drugim wentylem kosztu obok `--root-id`. Semantyka w całości z rdzenia (M39 <section_ref anchor="m01jfu8x"/>); CLI wnosi nazwy flag i format wyjścia.

**`c4s search-entities` — ta sama drabina, ta sama domyślna mapa.** Komenda dostaje `--regex` obok `--query` (dokładnie jedno z dwóch) i trzy tryby z domyślnym `--mode map`, bo obie operacje wyszukiwania mają być dla wołającego jednym wzorcem, a nie dwoma. Jedna różnica jest **semantyką rdzenia, nie transportu**, i CLI jej nie tłumaczy: wzorzec wielolinijkowy jest tu **legalny**, bo jednostką dopasowania jest pole, a nie linia (M39 <section_ref anchor="m01jfu8x"/> pkt 8). `--context` komenda nie ma i mieć nie będzie — okno fragmentu jest znakowe, a jego rozmiar jest stałą rdzenia. `--select` nadal nie przyjmuje, mimo że wiersz w trybie `hits` niesie fragmenty: fragment nie jest rzutem, tylko dowodem, a jego zakres rozstrzyga `--mode`.

**`c4s check-consistency` — delegacja bez roszczenia o wspólny walk.** Komenda deleguje do operacji rdzenia `check_consistency` (M39 <section_ref anchor="ya6vko6a"/>) i nie wnosi własnej diagnostyki. **Wewnętrzny page-walk tej operacji pozostaje jej własny** — to nie jest to samo zdanie co „jeden walk" dla `find-references`: z core'em referencji `check_consistency` współdzieli wyłącznie predykat `taggedListVia`, i tak ma zostać (M19 <section_ref anchor="m19acc00"/>).

**Komendy wnoszone przez konsumentów L14** (kontrybucje `CliCommandContribution`, patrz <section_ref anchor="ihakwlks"/>): `release-list` / `release-show` / `release-diff` (M17 <section_ref anchor="a1bipxfu"/>), `find-references` (M19 — transport core'a `findReferences`, czyli operacji 12 rdzenia), `create-brief` / `list-briefs` / `get-brief` / `mark-brief-implemented` (M21 <section_ref anchor="xqksf67f"/>), `create-patch` (M23), `create-plan` (M10 <section_ref anchor="ft1iz766"/>), `install-skills` (M22 <section_ref anchor="2x68r5a5"/>), `load-skill-file` / `list-skills` (M37 <section_ref anchor="qd2p6klm"/>) — ich sygnatury, tryby wykonania i kody błędów dokumentują slice'y właścicieli. Bilans parytetu liczy `find-references` jako **pokrytą**: jest komendą konsumenta L14, nie generyczną komendą M11, ale operację rdzenia wystawia.

`c4s detail` to subkomenda **bez odpowiednika XML tagu** — istnieje, bo agent czasem chce pełnego rekordu niezależnie od tego, co jest w markdown (rekonesans, walidacja, exhaustive dump). Nazwa jest historyczna i została świadomie: to alias `get-entities` z rzutem pominiętym, nie osobny kształt odczytu.

**`c4s describe` — osobna kategoria (schema discovery, M13).** W odróżnieniu od `catalog` / `list-*` (czyste discovery counts, bez emisji schematów) `describe` emituje **JSON Schema kształtu** per typ — wyprowadzoną ze schematu logicznego typu (lub auto-derived z SQLite reflect, `_auto: true`). On-demand per typ: agent ciągnie schemat jednego typu gdy go potrzebuje, zamiast dostawać blob schematów wszystkich typów. Operacja jest read-only — nie zmienia to jej trybu: schemat pochodzi z hosta serwera, więc komenda pozostaje `server-delegating`.

Odpowiedź niesie obok schematów cztery listy wyprowadzone przez rdzeń: **ograniczenia wartości per pole** (`constraints` — `enum`, `maxLength`), **pola pod opieką wraz z operacją wydającą treść** (`contentFields`), **płaską listę nazw legalnych dla `--select`** (`selectableFields`) i **ścieżki przeszukiwalne w notacji kropkowej** (`searchableFields`) — te same wartości, które widzi `describe_types` w MCP (<inline_mention type="mcp-tool" slug="c4s-reader-describe-types"/>): jedno wywołanie odpowiada i „jaki jest kształt", i „co wolno rzutować", i „co obejmie search". Dwie listy nazw są osobne, bo mają dwie różne gramatyki. `--type` pozostaje **wymagany** — to zawężenie wejścia po stronie transportu (rdzeń pominięty `types` czyta jako „wszystkie aktywne"), nie zawężenie zestawu operacji; koperta wyjścia mimo to zostaje kopertą rdzenia (`{ types: [...] }` z jednym elementem), bo transport kształtu zwrotki nie przepisuje. Paginacji `describe` nie ma — jest jawnym wyjątkiem projekcyjnym reguły implicit macierzy (<section_ref anchor="8suur17i"/>).

**`c4s list-tags` — pełna sygnatura operacji 11, liczniki opt-in.** Komenda jest cienką powierzchnią nad `list_tags` (M39 <section_ref anchor="34gccznx"/>, kontrakt narzędzia <inline_mention type="mcp-tool" slug="c4s-reader-list-tags"/>): `--with-counts` (**domyślnie wyłączone** — wyliczenie liczników to iloczyn kartezjański tagów × typów), `--min-count` (filtr pustych), `--co-occurring-with` (współwystępowanie — jedyny sposób odkrycia taksonomii bez jej wcześniejszej znajomości). `list_tags` **nie jest** wyjątkiem od paginacji, więc komenda dziedziczy `--limit`/`--offset` i kopertę `total`/`hasMore` jak każda komenda listowa.

**Bez meta flag w output.** Rekord jest jeden i generowany ze schematu, więc nie ma czego oznaczać: nie ma widoku, który mógłby być niezaimplementowany, ani dociągania, które mogłoby się nie udać. Relacje wracają slugami — zerwana relacja to slug, którego drugie wywołanie nie znajduje, i zgłasza to `ENTITY_NOT_FOUND` tamtego wywołania, nie flaga przy tym.

**Format domyslny: JSON** (pretty-printed, utf-8, exit 0 on success). Flaga `--format text` dla human-readable. Flaga `--compact` dla minified JSON (pipelines).

<before_change>**Error handling:** exit code >0, stderr JSON `{ error: { code, message, hint? } }`. Kody dzielą się na **własne M11** (środowisko, resolucja projektu/workspace, osiągalność serwera, packaging) i **mapowane z rdzenia M39** (tożsamość, typ, argument, przebieg) — te drugie M11 tłumaczy na swoją powierzchnię, nie definiuje od nowa. Pełna lista:</before_change>
<after_change>**Error handling:** exit code >0, stderr JSON `{ error: { code, message, hint? } }`. Kody dzielą się na **własne M11** (środowisko, resolucja projektu/workspace, osiągalność serwera, packaging) i **mapowane z rdzenia M39** (tożsamość, typ, argument, przebieg) — te drugie M11 tłumaczy na swoją powierzchnię, nie definiuje od nowa. Wyjątkiem spoza obu grup jest `ROOT_NOT_FOUND`: przychodzi z routera stron M02 i CLI przekazuje go bez tłumaczenia. Pełna lista:</after_change>
- `PROJECT_NOT_FOUND` (brak markera `.claude4spec/config.json` / ścieżka projektu spoza jakiegokolwiek workspace — reguła 0/1/N, <section_ref anchor="m11wsres"/>)
- `PROJECT_ID_NOT_FOUND` (`--project <id>` bez trafienia w lokalnym rejestrze; `message` z listą dostępnych `id` — <section_ref anchor="m11pjres"/>)
- `AMBIGUOUS_WORKSPACE` (ścieżka projektu należy do N>1 workspace'ów, brak `--workspace`; hint z listą kandydatów — rzucany lokalnie, przed jakimkolwiek wywołaniem do serwera)
- `AMBIGUOUS_PROJECT` (`--project <id>` trafia projekt o tym `id` w N>1 workspace'ach, brak `--workspace`; hint z listą kandydatów `id`+`workspace`, bez katalogu projektu — rzucany lokalnie, przed wywołaniem do serwera, <section_ref anchor="m11pjres"/>)
- `SERVER_NOT_RUNNING` (projekt i workspace rozwiązane, ale pod adresem lokalnym workspace'u (loopback `:defaultPort` albo `bindHost`) nic nie nasłuchuje — nie ma komu wykonać operacji; `message`: „no claude4spec server for workspace `<nazwa>` at `<adres>`" (`<adres>` — adres lokalny workspace'u), hint „run `npx @inharness-ai/claude4spec` in the workspace, or pass `--server <url>`". Kod dotyczy **każdej** komendy `server-delegating`, nie tylko rodziny tury. **Bez auto-startu**: dispatcher nie podnosi procesu w tle — cichy start byłby długo żyjącym efektem ubocznym, o który nikt nie prosił, i najtrudniejszą do zdiagnozowania klasą awarii, bo błąd zniknąłby, a jego przyczyna nie)
- `SERVER_NOT_RECOGNIZED` (na rozwiązanym adresie odpowiada obcy proces — health-check nie zwrócił kształtu configu claude4spec; hint z numerem portu i propozycją `--server <url>`)
- `PROJECT_NOT_IN_WORKSPACE` (serwer odpowiada, ale nie obsługuje tego projektu w swoim workspace — HTTP 404 z middleware M31; hint „uruchom serwer w workspace tego projektu lub przekaż `--server <url>`")
- `ENTITY_NOT_FOUND` (slug nieznany)
- `SECTION_NOT_FOUND` (anchor nieznany — wnoszony **wyłącznie** przez `get-sections`, jako **błąd itemu** w envelope `results`, bez przerywania pozostałych. Jest jedynym wnoszącym: sonda istnienia anchora jest odmową per-item, nie osobną komendą — M39 <section_ref anchor="n9qp5ja7"/>)
- `PAGE_NOT_FOUND` (`(rootId, path)` nie istnieje przy **istniejącym** korzeniu `kind: pages` — wnoszony przez `list-pages` / `get-page` / `get-page-outline`; `message` niesie listę korzeni `kind: pages`)
<after_change>- `ROOT_NOT_FOUND` (nieznany `--root-id` w komendzie stronowej, także identyfikator korzenia systemowego — np. `c4s list-pages --root-id nieistniejacy` albo `c4s get-page --root-id plans --path <p>`; `message` „root '<id>' not found", lista korzeni `kind: pages` w `hint`. To **renderowanie REST odmowy rdzenia**, nie kod mapowany z rdzenia: komenda stronowa idzie przez router `/api/pages/:rootId/...` (M02 <section_ref anchor="l4rootseg"/>), który rozwiązuje wyłącznie korzenie `kind: pages` i odmawia `404 ROOT_NOT_FOUND`, zanim wywołanie dotrze do rdzenia. Dlatego korzeń nieznany i korzeń systemowy dostają odmowę identyczną, a lista w `hint` nigdy nie wymienia korzenia systemowego)</after_change>
- `INVALID_TYPE` (nieznany typ encji — hint ze `c4s catalog` listuje dozwolone; dotyczy tez `c4s describe --type`, `c4s list-entities`, `c4s get-entities`, `c4s get-field-content`, `c4s search-entities`)
<before_change>- `INVALID_ARGUMENT` (argument sprzeczny z kontraktem operacji; **niesie nawigację**, nie samą odmowę: przekroczony limit długości `--anchors` lub pusta lista → limit podany w `message`; `--select` ze ścieżką kropkową, z `[]` albo z nazwą spoza schematu → płaska lista legalnych nazw w `message`; `--select` podany komendzie o stałym wierszu → pointer na `get-entities`; `--field` bez flagi `contentBearing` → lista pól pod opieką; `--regex` przekraczający linię (`\n`, `[\s\S]`, inline flag group) **w `search-pages`** → komunikat o liniowym dopasowaniu zamiast cichego zera trafień, przy czym w `search-entities` taki wzorzec jest legalny i odmowy nie ma; `--regex` dłuższy niż limit rdzenia → podana granica w `message`, w obu komendach wyszukiwania; **nieznany `--root-id` bez towarzyszącej ścieżki**, w tym identyfikator korzenia systemowego (np. `c4s list-pages --root-id nieistniejacy` albo `--root-id plans`) → lista korzeni `kind: pages` w `message`, spójnie z rodziną `AMBIGUOUS_*`, które już dziś wypisują kandydatów; `--query` i `--regex` podane naraz — w obu komendach wyszukiwania)</before_change>
<after_change>- `INVALID_ARGUMENT` (argument sprzeczny z kontraktem operacji; **niesie nawigację**, nie samą odmowę: przekroczony limit długości `--anchors` lub pusta lista → limit podany w `message`; `--select` ze ścieżką kropkową, z `[]` albo z nazwą spoza schematu → płaska lista legalnych nazw w `message`; `--select` podany komendzie o stałym wierszu → pointer na `get-entities`; `--field` bez flagi `contentBearing` → lista pól pod opieką; `--regex` przekraczający linię (`\n`, `[\s\S]`, inline flag group) **w `search-pages`** → komunikat o liniowym dopasowaniu zamiast cichego zera trafień, przy czym w `search-entities` taki wzorzec jest legalny i odmowy nie ma; `--regex` dłuższy niż limit rdzenia → podana granica w `message`, w obu komendach wyszukiwania; `--query` i `--regex` podane naraz — w obu komendach wyszukiwania)</after_change>
- `SEARCH_BUDGET_EXCEEDED` (przebieg `search-pages` albo `search-entities` wyczerpał budżet czasu rdzenia przed zakończeniem; `message` niesie wentyle zawężenia zakresu — `--root-id` / `--path-include` po stronie stron, `--type` / `--fields` po stronie encji. Kod **mapowany z rdzenia**, nie własny M11: argument był poprawny, więc `INVALID_ARGUMENT` prowadziłby wołającego do złej decyzji — ma zawęzić zakres, nie poprawiać wzorzec)
- `AMBIGUOUS_SLUGS` (ktorys ze slugow w `--slugs` nie istnieje — partial result + error)
- `HOST_API_INCOMPATIBLE` (pula zawiera pakiet zbudowany wobec niezgodnego **majora** Host API — agregat surface'owany przez `c4s plugins doctor` <section_ref anchor="m11plcmd"/>; per-pakiet powód to `PLUGIN_HOST_API_MISMATCH` z bramki ładowania M33 <section_ref anchor="m33load01"/>; hint niesie ścieżkę naprawy — docelowy `hostApiVersion`, zastosowalne `migrations[]`, dostępność compat-shimu)
- **kody wnoszone przez kontrybucje konsumentów L14** — `BRIEF_NOT_FOUND` (M21, <section_ref anchor="xqksf67f"/>), `IMMUTABLE_FIELD` (M21 <section_ref anchor="xqksf67f"/> — kod wspólny rodziny artefaktów M36, bez wariantów per kind), `PATCH_WRITE_FAILED` (M23), `PLAN_ALREADY_EXISTS` (M10, <section_ref anchor="ft1iz766"/>), `SKILLS_WRITE_FAILED` (M22, <section_ref anchor="2x68r5a5"/>), `RELEASE_NOT_FOUND`, `INVALID_INCLUDE_FILTER`, `INVALID_ENTITY_TYPES_FILTER`, `INVALID_SLUGS_FILTER`, `INVALID_PATHS_FILTER`, `INVALID_ROOTS_FILTER`, `CONFLICTING_FILTERS`, `INVALID_PAGINATION`, `INVALID_DIFF_RANGE` (M17, <section_ref anchor="eq2rgeei"/>); warunki i szczegóły w slice'ach właścicieli, unia `CliErrorCode` agregowana w dispatcherze

<before_change>Komendy stronowe i sekcyjne **nie wnoszą nowych kodów** — `SECTION_NOT_FOUND` i `PAGE_NOT_FOUND` należały do mapowanej unii od chwili, w której dispatcher zaczął mapować katalog rdzenia; nowe jest wyłącznie to, które komendy realnie je wywołują. Rozstrzygnięcie graniczne: katalog rdzenia definiuje `PAGE_NOT_FOUND` jako „`(rootId, path)` nie istnieje", więc **nieznany korzeń bez ścieżki** — także korzeń systemowy, który dla odkrywania nie ma adresu — nie ma tam pokrycia i idzie jako `INVALID_ARGUMENT` z listą korzeni `kind: pages`; `PAGE_NOT_FOUND` zostaje zarezerwowany dla przypadku, w którym korzeń `kind: pages` istnieje, a ścieżka nie.</before_change>
<after_change>Komendy stronowe i sekcyjne wnoszą do unii **jeden kod spoza katalogu rdzenia** — `ROOT_NOT_FOUND` routera stron. `SECTION_NOT_FOUND` i `PAGE_NOT_FOUND` należały do mapowanej unii od chwili, w której dispatcher zaczął mapować katalog rdzenia; nowe jest przy nich wyłącznie to, które komendy realnie je wywołują. Rozstrzygnięcie graniczne: katalog rdzenia definiuje `PAGE_NOT_FOUND` jako „`(rootId, path)` nie istnieje", więc **nieznany korzeń** — także korzeń systemowy, który dla odkrywania nie ma adresu — nie ma tam pokrycia. Rdzeń odmawia go `INVALID_ARGUMENT` z listą korzeni `kind: pages` w `message` i tak widzą to wołający MCP oraz in-process. CLI, jako transport `server-delegating`, dostaje tę samą odmowę w renderowaniu REST: `ROOT_NOT_FOUND` z listą w `hint`, bo router stron odmawia, zanim wywołanie dotrze do rdzenia. W obu kanałach `PAGE_NOT_FOUND` zostaje zarezerwowany dla przypadku, w którym korzeń `kind: pages` istnieje, a ścieżka nie.</after_change>

## Remove
- L14 `m11dcmds`, error list `INVALID_ARGUMENT`: the clause **„nieznany `--root-id` bez towarzyszącej ścieżki, w tym identyfikator korzenia systemowego … → INVALID_ARGUMENT z listą korzeni”** is removed from the CLI's INVALID_ARGUMENT cases (see the before/after pair above). The old boundary rule („nieznany korzeń bez ścieżki … idzie jako INVALID_ARGUMENT”) is replaced: in CLI (REST rendering) an unknown root → `ROOT_NOT_FOUND` with list of `kind: pages` roots in `hint`, passed through from the M02 page router untranslated. Previous AC text of `ac-nieznany-root-id-podany-bez-towarzys` (INVALID_ARGUMENT) — before value below — must no longer be asserted by any test.

## Context at 2.1.14 — L14-cli-commands.md sections 0–1 (anchors ihakwlks, m11dcmds)
### pages/modules/m11-c4s/L14-cli-commands.md — CLI Commands (L14) [anchor: ihakwlks]
<after_change>
M11 jest **implementorem** warstwy L14 (`layers/L14-cli-commands.md`) — sekcja czytana w how-mode: jak działa runtime CLI i na czym mogą polegać konsumenci.

**Dispatcher + rejestr `CliCommandContribution`.** Bin `c4s` (`src/bin/c4s/`) to wyłącznie dispatcher: parsuje argv, rozwiązuje projekt/workspace wspólnym resolverem i dispatchuje do komend zebranych z kontrybucji. Każda komenda modułowa wchodzi przez build-time kontrybucję:

```typescript
interface CliCommandContribution {
  name: string;                                            // `c4s <name>`, kebab-case
  executionMode: 'fs-scoped' | 'server-delegating' | 'registry-write' | 'registry-read' | 'scaffold';
  errorCodes: string[];                                    // człony wnoszone do unii CliErrorCode
  handler: (ctx: CliCommandContext) => Promise<CliResult>; // deleguje do core modułu-właściciela
}
```

**Walidacja kontrybucji — tryb wykonania musi zgadzać się z katalogiem operacji.** `executionMode` nie opisuje mechaniki komendy, tylko jej przynależność: wykonanie każdej operacji katalogu należy do procesu serwera (<section_ref anchor="l3locus0"/>), więc komenda będąca renderowaniem operacji nie ma innej drogi niż `server-delegating`. Stąd reguła walidacyjna rejestru (pole „Tryb wykonania" w slice schema L14, <section_ref anchor="flt0hm9r"/>): **kontrybucja komendy z katalogu z trybem innym niż `server-delegating` jest błędem specyfikacji, tak samo jak kontrybucja komendy spoza katalogu z trybem `server-delegating`**. Test jest mechaniczny — nazwa komendy ma dokładnie jedno miejsce w wierszu katalogu albo go nie ma — i przecina spory o to, czy dana komenda „mogłaby sobie poradzić sama".

**Rejestr nie zna flag komendy — i to jest decyzja, nie luka.** Kontrybucja **nie deklaruje** własnych flag jako danych; parsuje je handler z `ctx`, a rejestr trzyma wyłącznie tożsamość komendy, jej tryb wykonania, wnoszone kody i punkt wejścia. Deklaratywny rejestr flag miałby dziś jednego konsumenta (help text) i kosztowałby przepisanie wszystkich komend, więc jego brak jest świadomy. Jedynym wyjątkiem jest para `--limit`/`--offset`, którą **parsuje sam dispatcher wspólnym helperem** — bo to jego własność runtime (bullet niżej), a nie flaga komendy. Slice schema L14 (<section_ref anchor="flt0hm9r"/>) wymaga natomiast opisu „Flagi własne" w pliku modułu — dokumentacja komendy jest obowiązkowa niezależnie od tego, że rejestr runtime jej nie odwzorowuje.

Core moduły (M17/M19/M21/M22/M23/M31/M38) eksportują kontrybucje ze swojego kodu core; bin agreguje je statycznym importem przy budowie — **build-time, nie plugin runtime**. Grep-proof: `src/bin/c4s/` nie zawiera logiki domenowej komend modułowych — wyłącznie dispatcher + agregację kontrybucji.

**Non-goal (v1): slot CLI w L11 / `hostApiVersion`.** Pluginy encji NIE wnoszą własnych komend — obsługują je generyczne readery M11 przez generację rekordu odczytu M13 (Single Abstraction Rule); slot kontrybucji CLI w powierzchni L11 rozszerzyłby wersjonowany kontrakt bez dzisiejszego konsumenta. Furtka: kształt `CliCommandContribution` jest zgodny z ewentualną przyszłą rejestracją przez manifest pluginu.

**Własność runtime (co dziedziczą konsumenci):**
- **Wspólne selektory** — `--project <id>` (przy jego braku walk-up) / `--workspace <nazwa>` (resolver 0/1/N, <section_ref anchor="m11pjres"/> / <section_ref anchor="m11wsres"/>), `--server <url>` (tylko server-delegating, wyłącznie razem z `--project <id>`), `--format json|text`, `--compact`.
- **Wspólne flagi paginacyjne** — `--limit <n>` / `--offset <n>` dla każdej komendy listowej, a w wyjściu `total` i `hasMore`. To **reguła implicit macierzy rdzenia** (M39 <section_ref anchor="8suur17i"/>), obowiązująca CLI dokładnie tak samo jak MCP: domyślny limit jest skończony, sortowanie stabilne — a dla list encji jego klucz i kierunek pochodzą z M13 <section_ref anchor="ebaztssz"/> (`createdAt` rosnąco, tiebreaker po slugu), nie z CLI — a tabela komend niżej wymienia wyłącznie parametry specyficzne. Wyjątki od paginacji CLI **dziedziczy w komplecie i nie przepisuje** — obie ich kategorie definiuje tamta sekcja, a że tabela niżej mapuje każdą komendę na jej operację rdzenia, przynależność komendy do wyjątku odczytuje się z tego mapowania. Dispatcher przekazuje komendzie `limit`/`offset` tylko wtedy, gdy flaga została podana; bez niej obowiązuje domyślne okno operacji. Komenda renderująca operację spoza rdzenia dziedziczy kontrakt okna od modułu-właściciela operacji: domyślny limit, kształt `total` i obecność `hasMore`.
- **Envelope błędów + `codeToExit`** — stderr JSON `{ error: { code, message, hint? } }` + exit >0; unia `CliErrorCode` agregowana z `errorCodes[]` kontrybucji **oraz z katalogu kodów rdzenia M39** (`ENTITY_NOT_FOUND` / `SECTION_NOT_FOUND` / `PAGE_NOT_FOUND` / `INVALID_TYPE` / `INVALID_ARGUMENT` / `AMBIGUOUS_*`), które dispatcher **mapuje** na swoją powierzchnię zamiast definiować od nowa; kody środowiskowe i workspace'owe (`PROJECT_*`, `SERVER_*`, `AMBIGUOUS_WORKSPACE`) pozostają własne M11. Mapa exit-code'ów w dispatcherze (<section_ref anchor="g24dkd8t"/>).
- **Tryby wykonania** — `server-delegating` (REST pod prefiksem projektu, health-check <section_ref anchor="euyb84yv"/>) obejmuje **każdą** komendę czytającą lub piszącą zawartość specyfikacji; `fs-scoped` (pliki spoza specyfikacji — repo kodu wołającego; bez serwera), `registry-write` (server-free zapis do globalnego rejestru workspace'ów `~/.claude4spec/workspaces.json` — bez serwera, bez plików `cwd`; wnoszony przez M31 <section_ref anchor="zovs1ohc"/>), `registry-read` (server-free odczyt tego samego rejestru — bez serwera, bez plików `cwd`, bez resolvera projektu i workspace'u; wnoszony przez M31 <section_ref anchor="zovs1ohc"/>), `scaffold` (server-free bootstrap **nowego** katalogu w CWD — **dispatcher pomija resolucję projektu**: żadnego `--project`/walk-up do `.claude4spec/`, brak health-check; komenda pobiera pliki ze zdalnego repo git i rozwija je do nowo utworzonego katalogu docelowego, opcjonalnie domykając to instalacją zależności `npm install`. Z runtime dziedziczy wyłącznie envelope błędów, `codeToExit` i formaty wyjścia; wnoszony przez M38 <section_ref anchor="m38cli01"/>).
- **Discovery serwera i silnik tury** — `runAgent` (<section_ref anchor="m11dcore"/>).

**Komendy pozostające w M11** (generyczne, bez innego domu; **wszystkie `server-delegating`**): readery XML-tagowe (`inline_mention`, `single_element`, `element_list`, `tagged_list`, `tagged_list_mixed`) + `detail`, kanoniczne powierzchnie encjowe (`get-entities`, `list-entities`, `get-field-content`), komendy stronowe i sekcyjne (`list-pages`, `get-page-outline`, `get-sections`, `get-page`, `search-pages`), discovery (`catalog`, `describe`, `list-tags`, `search-entities`, `resolve-identity`), diagnostyka (`check-consistency`), `resolve`, diagnostyka puli `plugins` (<section_ref anchor="m11plcmd"/>) oraz `agent`/`ask` (silnik tury = substancja M11). Komendy wnoszone przez konsumentów: `release-list`/`release-show`/`release-diff` (M17 <section_ref anchor="a1bipxfu"/>), `find-references` (M19), `list-briefs`/`get-brief`/`mark-brief-implemented` (M21 <section_ref anchor="xqksf67f"/>), `create-patch` (M23), `create-plan` (M10 <section_ref anchor="ft1iz766"/>), `install-skills` (M22 — tryb `fs-scoped`, <section_ref anchor="2x68r5a5"/>), `trust-plugins` (M31 — tryb `registry-write`, <section_ref anchor="m31cli01"/>), `create-plugin` (M38 — tryb `scaffold`, <section_ref anchor="m38cli01"/>), `list-workspaces` (M31 — tryb `registry-read`, <section_ref anchor="m31cli01"/>). Cztery ostatnie — `install-skills`, `trust-plugins`, `create-plugin`, `list-workspaces` — to **komplet** komend spoza katalogu operacji — każda inna komenda `c4s`, wniesiona przez kogokolwiek, jest renderowaniem operacji i delegatem serwera.
</after_change>

### pages/modules/m11-c4s/L14-cli-commands.md — Command surface [anchor: m11dcmds]
<after_change>
CLI eksponuje **komplet czternastu operacji rdzenia M39** — parytet transportowy z external MCP (M12), nie podzbiór. Parytet jest **operacyjny, nie nazewniczy**: nad jedną operacją rdzenia potrafi stać kilka nazwanych powierzchni CLI (pięć komend XML-tagowych nad `get_entities`), bo MCP robi to samo jednym toolem z parametrem `select`. To świadoma różnica ergonomii (<section_ref anchor="l3route0"/>), a nie rozjazd zestawu operacji — reguła zawężania z M39 (<section_ref anchor="d0pyocn8"/>) dotyczy **zbioru operacji rdzenia**, nie liczby nazw transportu nad jedną operacją.

**Każda komenda z tabeli poniżej ma `Tryb wykonania: server-delegating`** — kolumny trybu w niej nie ma, bo miałaby jedną wartość. Proces `c4s` składa wywołanie, dostaje wynik operacji po HTTP i formatuje go dla człowieka; nie otwiera db-slotu i nie buduje własnego rejestru pluginów. Dlatego `catalog`, `describe` i readery XML-tagowe widzą **dokładnie** ten zestaw typów encji, który widzi host serwera — zgodność jest konstrukcyjna, nie uzgodnieniowa (M33 <section_ref anchor="m33l11sc"/>).

Każdy znacznik encyjny M19 (<section_ref anchor="51bhppmd"/>) ma swój subcommand. Atrybuty tagu → flagi CLI (nazwy 1:1, underscore dla spojnosci z XML — `tagged_list` nie `tagged-list`). Pozostałe komendy używają **kebab-case** (slice schema L14) — underscore jest zarezerwowany dla generycznych readerów XML-tagowych.

**Ksztalt output kazdej komendy definiuje generacja rekordu odczytu (M13)** — nie CLI. Kolumna „Output" ponizej opisuje **ogolny ksztalt** (array/obiekt/z meta), a zawartosc elementow wynika ze schematu logicznego typu. Kolumna „Rzut" mówi, z jakim `select` komenda woła operację rdzenia (<section_ref anchor="34gccznx"/>): pusty rzut `[]` daje sam szkielet tożsamościowy, rzut pominięty — pełny rekord bez pól pod opieką.

| Komenda | Mapuje na | Flagi | Output shape | Rzut (`select`) |
|---------|-----------|-------|--------------|-----------------|
| `c4s inline_mention --type <t> --slug <s>` | `<inline_mention .../>` | `--type`, `--slug` | pojedynczy obiekt | `[]` (szkielet) |
| `c4s single_element --type <t> --slug <s>` | `<single_element .../>` | `--type`, `--slug` | pojedynczy obiekt | pominięty |
| `c4s element_list --type <t> --slugs <s1,s2>` | `<element_list .../>` | `--type`, `--slugs` (comma) | array (kolejnosc jak we flag) | `[]` (szkielet) |
| `c4s tagged_list --type <t> --tags <t1,t2> --filter <and\|or>` | `<tagged_list .../>` | `--type`, `--tags`, `--filter` | array | `[]` (szkielet) |
| `c4s tagged_list_mixed --tags <t1,t2> --filter <and\|or>` | `<tagged_list_mixed .../>` | `--tags`, `--filter` | `{ endpoints: [], dtos: [], database_tables: [] }` grouped | `[]` (szkielet) |
| `c4s detail --type <t> --slug <s>` | — (bez tagu XML) | `--type`, `--slug` | pojedynczy obiekt — pełny rekord | pominięty |
| `c4s get-entities --type <t> --slugs <s1,s2> [--select <f1,f2>]` | `get_entities` (kanoniczna powierzchnia) | `--type`, `--slugs` (comma), `--select` (comma; pusta wartość = `[]`) | array w kolejnosci wejscia + `selectedFields`; budżet odpowiedzi zamiast paginacji | wg `--select` |
| `c4s get-field-content --type <t> --slug <s> --field <f>` | odczyt treści pola pod opieką (<section_ref anchor="v0fldrd8"/>) | `--type`, `--slug`, `--field` | `{ type, slug, field, content, bytes }` | — |
| `c4s list-entities --type <t> [--tags <t1,t2>] [--tag-filter <and\|or>] [--sort createdAt\|title\|slug] [--dir asc\|desc] [--mode items\|count]` | `list_entities` (kanoniczna powierzchnia) | `--type`, `--tags`, `--tag-filter`, `--sort`, `--dir`, `--mode` | `{ type, items: [{ slug, title }], total, hasMore }` albo `{ type, total }` (`count`) | — (wiersz stały) |
| `c4s list-pages --root-id <id> [--prefix <p>] [--sort path\|modified]` | `list_pages` | `--root-id`, `--prefix`, `--sort` | array `(rootId, path)` + lekkie metadane (tytuł, liczba sekcji, rozmiar, mtime) | — |
| `c4s get-page-outline --root-id <id> --path <p>` | `get_page_outline` | `--root-id`, `--path` | drzewo sekcji w **kolejności dokumentowej** (anchor, tekst, poziom, dzieci) + **rozmiar** ciała własnego każdej sekcji | — |
| `c4s get-sections --anchors <a,b,c> [--include-subtree]` | `get_sections` | `--anchors` (comma), `--include-subtree` | `{ results: [...] }`, envelope per item; anchory żądane w kolejnosci wejscia, a przy `--include-subtree` poddrzewo każdego z nich dokumentowo za jego itemem | — |
| `c4s get-page --root-id <id> --path <p>` | `get_page` | `--root-id`, `--path` | koperta strony `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }` — sekcje jako itemy kluczowane kotwicą, w kolejności dokumentowej, tagi XML w `body` nietknięte; przy `--format text` strona złożona z koperty | — |
| `c4s search-pages (--query <q> \| --regex <r>) [--root-id <id>] [--path-include <re>] [--path-exclude <re>] [--anchors <a,b>] [--mode count\|map\|hits] [--context <n>]` | `search_pages` | `--query` XOR `--regex`, `--root-id`, `--path-include`, `--path-exclude`, `--anchors` (comma), `--mode` (default `map`), `--context` | trafienia jako unia dyskryminowana — sekcyjna (`anchor`, `heading`, `headingPath`, `matchCount`) albo stronowa (`(rootId, path)`, `matchCount`) dla dopasowania poza każdą sekcją (frontmatter, tekst nad pierwszym nagłówkiem); w `hits` dodatkowo `hunks[]` i `omittedChars`, w `count` same liczniki. Bez `score` i bez numeru linii | — |
| `c4s search-entities --type <t> (--query <q> \| --regex <r>) [--fields <f1,f2>] [--mode count\|map\|hits]` | `search_entities` | `--type` (wymagany), `--query` XOR `--regex`, `--fields`, `--mode` (default `map`) | `{ items, total, hasMore, searchedFields }`; wiersz `{ slug, title, matchCount }`, w `hits` dodatkowo `hunks[]` (`{ field, text, matches }`) i `omittedChars`, w `count` same liczniki. Bez `score` | — (wiersz stały) |
| `c4s check-consistency [--severity <s>] [--rule <r>] [--limit <n>]` | `check_consistency` | `--severity`, `--rule`, `--limit` | raport naruszen (kategoria + pozycja `(rootId, path)` / anchor / encja) | — |
| `c4s resolve-identity --query <q> [--types <t1,t2>] [--limit <n>]` | `resolve_identity` | `--query`, `--types`, `--limit` | kandydaci `{ type, slug, title, score }` z deterministycznym tie-breakiem | — |
| `c4s resolve <file.md>` | — (utility: odczyt lokalny + rozwijanie osadzeń rdzenia M19) | pozycyjny path; `--format json\|inline` | format wyniku definiuje rdzeń rozwijania (M19 <section_ref anchor="5mhf8s06"/>); `--format inline` wybiera tamtejszy format `inline` | — |
| `c4s catalog` | `overview` | `--format json\|text` | `{ claude4spec: "x.y.z", types: {T: {count, version, description, roleNoun, mcpToolsLine?}} }` — smoke test, bez `schema` (patrz wersjonowanie payloadu, M47) | — |
| `c4s describe --type <t>` | `describe_types` | `--type` (wymagany), `--format json\|text` | `{ types: [ { type, label, version, schemas, constraints, contentFields, selectableFields, searchableFields } ] }` — koperta rdzenia, jednoelementowa przy wymaganym `--type` | — |
| `c4s list-tags` | `list_tags` | `--with-counts?`, `--min-count?`, `--co-occurring-with?`, `--format json\|text` | lista tagów (`slug`, `name`, `color`, `description`, `counts?`, `coOccurrence?`) w kopercie paginacyjnej rdzenia (`total` + `hasMore`); liczniki **opt-in** (`--with-counts`, domyślnie wyłączone) | — |

**Aliasy nad `get_entities`.** Pięć komend XML-tagowych plus `detail` to **aliasy** kanonicznej powierzchni `get-entities` z ustalonym rzutem — nie osobne operacje rdzenia. Trzymają nazwę 1:1 z tagiem XML, bo zewnętrzny agent czyta tag w markdown i szuka komendy o tej samej nazwie; kasowanie ich byłoby stratą ergonomii bez zysku po stronie kontraktu.

**`list-slugs` znika — bez zamiennika, bo `list-entities` **jest** list-slugs.** Po zwężeniu wiersza do `{ slug, title }` skrót nie oszczędza już niczego, a niesie tytuł zamiast gołego sluga, czyli likwiduje N+1, dla którego skrót powstał. Dwie nazwy transportu nad jedną operacją są uzasadnione tylko wtedy, gdy różnią się ergonomią — tu przestały.

**Reżimy tożsamości w komendach stronowych i sekcyjnych.** Strona jest keyowana `(rootId, path)` — stąd `--root-id` obowiązkowy w `list-pages`, `get-page` i `get-page-outline`; brak cichego fallbacku na builtin `pages`. Sekcja jest keyowana samym `anchor` (globalnie unikalny), więc `get-sections` rootu nie przyjmuje. `get-page-outline` nie ma **ani trybu `query`, ani wariantu anchorowego** — to wierne odwzorowanie rdzenia, nie zawężenie transportu: M39 (<section_ref anchor="n9qp5ja7"/>) odmawia obu jawnie i wskazuje ścieżkę `search-pages` → trafienie niesie już `anchor` → `get-sections`. **Paginacji nie ma po żadnej stronie** — ani w narzędziu MCP, ani w tabeli flag CLI; to jedna deklaracja, nie dwie rozjeżdżające się (<section_ref anchor="8suur17i"/>).

**`--select` żyje wyłącznie przy `get-entities` (i jej aliasach).** Komendy stronowe rzutu nie mają, bo `select` wybiera z pól schematu logicznego encji, a strona schematu logicznego nie ma — flaga byłaby kontraktowo pusta (M39 <section_ref anchor="n9qp5ja7"/>). `list-entities`, `search-entities` i `resolve-identity` też jej nie mają, ale z innego powodu: ich wiersz jest wąski z kontraktu, więc **nie ma czego rzutować**. Podanie `--select` przy którejkolwiek z nich → `INVALID_ARGUMENT` z pointerem na `get-entities`.

**`c4s get-field-content` — jedyna droga do treści pola pod opieką.** Pole z flagą `contentBearing` nie wraca z żadnego odczytu, także przy jawnym `--select`: zamiast wartości przychodzi deskryptor z rozmiarem i nazwą operacji. Komenda jest **generowana przez hosta** z deklaracji pola, więc działa dla każdego typu z takim polem bez kontrybucji CLI; `--field` spoza schematu albo bez flagi → `INVALID_ARGUMENT` z listą pól pod opieką tego typu (`describe --type <t>` wypisuje je jako `contentFields`).

**`c4s get-sections` — fetch batchowy.** Envelope `results` w kolejności wejścia (po cichej deduplikacji), `SECTION_NOT_FOUND` jako **błąd itemu**, nie awaria całego wywołania; brak paginacji (fetch po kluczu), a wentyle wywołania — wraz z progami i z dwoma reżimami cięcia, odmową na wejściu i ucięciem po rozwinięciu `--include-subtree` — definiuje rdzeń i CLI ich nie przepisuje (<section_ref anchor="8suur17i"/>). Cięcie jest deterministyczne, a degradacja budżetowa startuje od itemu drugiego. Semantyka w całości z rdzenia (M39 <section_ref anchor="n9qp5ja7"/>) — CLI wnosi wyłącznie nazwę komendy i format wyjścia.

**`c4s get-page` — format wyjścia.** JSON, domyślny i `--compact`, niesie kopertę rdzenia bez przepisywania (M39 <section_ref anchor="b61e5lbd"/>). `--format text` składa z niej stronę regułą serializacji M06 (<section_ref anchor="o8qmucgr"/>) — to formatowanie dla człowieka, nie drugi kształt odczytu. Okna linii komenda nie ma, tak jak operacja (M39 <section_ref anchor="984v8437"/>): `--range` jest odmawiany lokalnie, przed wywołaniem serwera, kodem `INVALID_ARGS` z podpowiedzią `get-page-outline` → `get-sections` — nigdy cicho pomijany, bo skrypt, który go podał, dostałby całą stronę w przekonaniu, że ją zawęził.

**`c4s search-pages` — mapa najpierw, dowód potem.** Domyślny `--mode map` zwraca komplet współrzędnych bez ani jednego znaku treści, więc pełny sweep mieści się tam, gdzie `hits` już by się nie zmieścił; `--anchors` domyka ścieżkę `search-pages --mode map` → wybór kotwic → `search-pages --mode hits --anchors …` → `get-sections --anchors …`, w której nie zgaduje się `--limit`. `--path-include` / `--path-exclude` przyjmują wyrażenia regularne nad ścieżką strony — ten sam dialekt co `--regex`, bo dwa dialekty w jednym wywołaniu byłyby pułapką — i odsiewają pliki przed otwarciem, więc są drugim wentylem kosztu obok `--root-id`. Semantyka w całości z rdzenia (M39 <section_ref anchor="m01jfu8x"/>); CLI wnosi nazwy flag i format wyjścia.

**`c4s search-entities` — ta sama drabina, ta sama domyślna mapa.** Komenda dostaje `--regex` obok `--query` (dokładnie jedno z dwóch) i trzy tryby z domyślnym `--mode map`, bo obie operacje wyszukiwania mają być dla wołającego jednym wzorcem, a nie dwoma. Jedna różnica jest **semantyką rdzenia, nie transportu**, i CLI jej nie tłumaczy: wzorzec wielolinijkowy jest tu **legalny**, bo jednostką dopasowania jest pole, a nie linia (M39 <section_ref anchor="m01jfu8x"/> pkt 8). `--context` komenda nie ma i mieć nie będzie — okno fragmentu jest znakowe, a jego rozmiar jest stałą rdzenia. `--select` nadal nie przyjmuje, mimo że wiersz w trybie `hits` niesie fragmenty: fragment nie jest rzutem, tylko dowodem, a jego zakres rozstrzyga `--mode`.

**`c4s check-consistency` — delegacja bez roszczenia o wspólny walk.** Komenda deleguje do operacji rdzenia `check_consistency` (M39 <section_ref anchor="ya6vko6a"/>) i nie wnosi własnej diagnostyki. **Wewnętrzny page-walk tej operacji pozostaje jej własny** — to nie jest to samo zdanie co „jeden walk" dla `find-references`: z core'em referencji `check_consistency` współdzieli wyłącznie predykat `taggedListVia`, i tak ma zostać (M19 <section_ref anchor="m19acc00"/>).

**Komendy wnoszone przez konsumentów L14** (kontrybucje `CliCommandContribution`, patrz <section_ref anchor="ihakwlks"/>): `release-list` / `release-show` / `release-diff` (M17 <section_ref anchor="a1bipxfu"/>), `find-references` (M19 — transport core'a `findReferences`, czyli operacji 12 rdzenia), `create-brief` / `list-briefs` / `get-brief` / `mark-brief-implemented` (M21 <section_ref anchor="xqksf67f"/>), `create-patch` (M23), `create-plan` (M10 <section_ref anchor="ft1iz766"/>), `install-skills` (M22 <section_ref anchor="2x68r5a5"/>), `load-skill-file` / `list-skills` (M37 <section_ref anchor="qd2p6klm"/>) — ich sygnatury, tryby wykonania i kody błędów dokumentują slice'y właścicieli. Bilans parytetu liczy `find-references` jako **pokrytą**: jest komendą konsumenta L14, nie generyczną komendą M11, ale operację rdzenia wystawia.

`c4s detail` to subkomenda **bez odpowiednika XML tagu** — istnieje, bo agent czasem chce pełnego rekordu niezależnie od tego, co jest w markdown (rekonesans, walidacja, exhaustive dump). Nazwa jest historyczna i została świadomie: to alias `get-entities` z rzutem pominiętym, nie osobny kształt odczytu.

**`c4s describe` — osobna kategoria (schema discovery, M13).** W odróżnieniu od `catalog` / `list-*` (czyste discovery counts, bez emisji schematów) `describe` emituje **JSON Schema kształtu** per typ — wyprowadzoną ze schematu logicznego typu (lub auto-derived z SQLite reflect, `_auto: true`). On-demand per typ: agent ciągnie schemat jednego typu gdy go potrzebuje, zamiast dostawać blob schematów wszystkich typów. Operacja jest read-only — nie zmienia to jej trybu: schemat pochodzi z hosta serwera, więc komenda pozostaje `server-delegating`.

Odpowiedź niesie obok schematów cztery listy wyprowadzone przez rdzeń: **ograniczenia wartości per pole** (`constraints` — `enum`, `maxLength`), **pola pod opieką wraz z operacją wydającą treść** (`contentFields`), **płaską listę nazw legalnych dla `--select`** (`selectableFields`) i **ścieżki przeszukiwalne w notacji kropkowej** (`searchableFields`) — te same wartości, które widzi `describe_types` w MCP (<inline_mention type="mcp-tool" slug="c4s-reader-describe-types"/>): jedno wywołanie odpowiada i „jaki jest kształt", i „co wolno rzutować", i „co obejmie search". Dwie listy nazw są osobne, bo mają dwie różne gramatyki. `--type` pozostaje **wymagany** — to zawężenie wejścia po stronie transportu (rdzeń pominięty `types` czyta jako „wszystkie aktywne"), nie zawężenie zestawu operacji; koperta wyjścia mimo to zostaje kopertą rdzenia (`{ types: [...] }` z jednym elementem), bo transport kształtu zwrotki nie przepisuje. Paginacji `describe` nie ma — jest jawnym wyjątkiem projekcyjnym reguły implicit macierzy (<section_ref anchor="8suur17i"/>).

**`c4s list-tags` — pełna sygnatura operacji 11, liczniki opt-in.** Komenda jest cienką powierzchnią nad `list_tags` (M39 <section_ref anchor="34gccznx"/>, kontrakt narzędzia <inline_mention type="mcp-tool" slug="c4s-reader-list-tags"/>): `--with-counts` (**domyślnie wyłączone** — wyliczenie liczników to iloczyn kartezjański tagów × typów), `--min-count` (filtr pustych), `--co-occurring-with` (współwystępowanie — jedyny sposób odkrycia taksonomii bez jej wcześniejszej znajomości). `list_tags` **nie jest** wyjątkiem od paginacji, więc komenda dziedziczy `--limit`/`--offset` i kopertę `total`/`hasMore` jak każda komenda listowa.

**Bez meta flag w output.** Rekord jest jeden i generowany ze schematu, więc nie ma czego oznaczać: nie ma widoku, który mógłby być niezaimplementowany, ani dociągania, które mogłoby się nie udać. Relacje wracają slugami — zerwana relacja to slug, którego drugie wywołanie nie znajduje, i zgłasza to `ENTITY_NOT_FOUND` tamtego wywołania, nie flaga przy tym.

**Format domyslny: JSON** (pretty-printed, utf-8, exit 0 on success). Flaga `--format text` dla human-readable. Flaga `--compact` dla minified JSON (pipelines).

**Error handling:** exit code >0, stderr JSON `{ error: { code, message, hint? } }`. Kody dzielą się na **własne M11** (środowisko, resolucja projektu/workspace, osiągalność serwera, packaging) i **mapowane z rdzenia M39** (tożsamość, typ, argument, przebieg) — te drugie M11 tłumaczy na swoją powierzchnię, nie definiuje od nowa. Wyjątkiem spoza obu grup jest `ROOT_NOT_FOUND`: przychodzi z routera stron M02 i CLI przekazuje go bez tłumaczenia. Pełna lista:
- `PROJECT_NOT_FOUND` (brak markera `.claude4spec/config.json` / ścieżka projektu spoza jakiegokolwiek workspace — reguła 0/1/N, <section_ref anchor="m11wsres"/>)
- `PROJECT_ID_NOT_FOUND` (`--project <id>` bez trafienia w lokalnym rejestrze; `message` z listą dostępnych `id` — <section_ref anchor="m11pjres"/>)
- `AMBIGUOUS_WORKSPACE` (ścieżka projektu należy do N>1 workspace'ów, brak `--workspace`; hint z listą kandydatów — rzucany lokalnie, przed jakimkolwiek wywołaniem do serwera)
- `AMBIGUOUS_PROJECT` (`--project <id>` trafia projekt o tym `id` w N>1 workspace'ach, brak `--workspace`; hint z listą kandydatów `id`+`workspace`, bez katalogu projektu — rzucany lokalnie, przed wywołaniem do serwera, <section_ref anchor="m11pjres"/>)
- `SERVER_NOT_RUNNING` (projekt i workspace rozwiązane, ale pod adresem lokalnym workspace'u (loopback `:defaultPort` albo `bindHost`) nic nie nasłuchuje — nie ma komu wykonać operacji; `message`: „no claude4spec server for workspace `<nazwa>` at `<adres>`" (`<adres>` — adres lokalny workspace'u), hint „run `npx @inharness-ai/claude4spec` in the workspace, or pass `--server <url>`". Kod dotyczy **każdej** komendy `server-delegating`, nie tylko rodziny tury. **Bez auto-startu**: dispatcher nie podnosi procesu w tle — cichy start byłby długo żyjącym efektem ubocznym, o który nikt nie prosił, i najtrudniejszą do zdiagnozowania klasą awarii, bo błąd zniknąłby, a jego przyczyna nie)
- `SERVER_NOT_RECOGNIZED` (na rozwiązanym adresie odpowiada obcy proces — health-check nie zwrócił kształtu configu claude4spec; hint z numerem portu i propozycją `--server <url>`)
- `PROJECT_NOT_IN_WORKSPACE` (serwer odpowiada, ale nie obsługuje tego projektu w swoim workspace — HTTP 404 z middleware M31; hint „uruchom serwer w workspace tego projektu lub przekaż `--server <url>`")
- `ENTITY_NOT_FOUND` (slug nieznany)
- `SECTION_NOT_FOUND` (anchor nieznany — wnoszony **wyłącznie** przez `get-sections`, jako **błąd itemu** w envelope `results`, bez przerywania pozostałych. Jest jedynym wnoszącym: sonda istnienia anchora jest odmową per-item, nie osobną komendą — M39 <section_ref anchor="n9qp5ja7"/>)
- `PAGE_NOT_FOUND` (`(rootId, path)` nie istnieje przy **istniejącym** korzeniu `kind: pages` — wnoszony przez `list-pages` / `get-page` / `get-page-outline`; `message` niesie listę korzeni `kind: pages`)
- `ROOT_NOT_FOUND` (nieznany `--root-id` w komendzie stronowej, także identyfikator korzenia systemowego — np. `c4s list-pages --root-id nieistniejacy` albo `c4s get-page --root-id plans --path <p>`; `message` „root '<id>' not found", lista korzeni `kind: pages` w `hint`. To **renderowanie REST odmowy rdzenia**, nie kod mapowany z rdzenia: komenda stronowa idzie przez router `/api/pages/:rootId/...` (M02 <section_ref anchor="l4rootseg"/>), który rozwiązuje wyłącznie korzenie `kind: pages` i odmawia `404 ROOT_NOT_FOUND`, zanim wywołanie dotrze do rdzenia. Dlatego korzeń nieznany i korzeń systemowy dostają odmowę identyczną, a lista w `hint` nigdy nie wymienia korzenia systemowego)
- `INVALID_TYPE` (nieznany typ encji — hint ze `c4s catalog` listuje dozwolone; dotyczy tez `c4s describe --type`, `c4s list-entities`, `c4s get-entities`, `c4s get-field-content`, `c4s search-entities`)
- `INVALID_ARGUMENT` (argument sprzeczny z kontraktem operacji; **niesie nawigację**, nie samą odmowę: przekroczony limit długości `--anchors` lub pusta lista → limit podany w `message`; `--select` ze ścieżką kropkową, z `[]` albo z nazwą spoza schematu → płaska lista legalnych nazw w `message`; `--select` podany komendzie o stałym wierszu → pointer na `get-entities`; `--field` bez flagi `contentBearing` → lista pól pod opieką; `--regex` przekraczający linię (`\n`, `[\s\S]`, inline flag group) **w `search-pages`** → komunikat o liniowym dopasowaniu zamiast cichego zera trafień, przy czym w `search-entities` taki wzorzec jest legalny i odmowy nie ma; `--regex` dłuższy niż limit rdzenia → podana granica w `message`, w obu komendach wyszukiwania; `--query` i `--regex` podane naraz — w obu komendach wyszukiwania)
- `SEARCH_BUDGET_EXCEEDED` (przebieg `search-pages` albo `search-entities` wyczerpał budżet czasu rdzenia przed zakończeniem; `message` niesie wentyle zawężenia zakresu — `--root-id` / `--path-include` po stronie stron, `--type` / `--fields` po stronie encji. Kod **mapowany z rdzenia**, nie własny M11: argument był poprawny, więc `INVALID_ARGUMENT` prowadziłby wołającego do złej decyzji — ma zawęzić zakres, nie poprawiać wzorzec)
- `AMBIGUOUS_SLUGS` (ktorys ze slugow w `--slugs` nie istnieje — partial result + error)
- `HOST_API_INCOMPATIBLE` (pula zawiera pakiet zbudowany wobec niezgodnego **majora** Host API — agregat surface'owany przez `c4s plugins doctor` <section_ref anchor="m11plcmd"/>; per-pakiet powód to `PLUGIN_HOST_API_MISMATCH` z bramki ładowania M33 <section_ref anchor="m33load01"/>; hint niesie ścieżkę naprawy — docelowy `hostApiVersion`, zastosowalne `migrations[]`, dostępność compat-shimu)
- **kody wnoszone przez kontrybucje konsumentów L14** — `BRIEF_NOT_FOUND` (M21, <section_ref anchor="xqksf67f"/>), `IMMUTABLE_FIELD` (M21 <section_ref anchor="xqksf67f"/> — kod wspólny rodziny artefaktów M36, bez wariantów per kind), `PATCH_WRITE_FAILED` (M23), `PLAN_ALREADY_EXISTS` (M10, <section_ref anchor="ft1iz766"/>), `SKILLS_WRITE_FAILED` (M22, <section_ref anchor="2x68r5a5"/>), `RELEASE_NOT_FOUND`, `INVALID_INCLUDE_FILTER`, `INVALID_ENTITY_TYPES_FILTER`, `INVALID_SLUGS_FILTER`, `INVALID_PATHS_FILTER`, `INVALID_ROOTS_FILTER`, `CONFLICTING_FILTERS`, `INVALID_PAGINATION`, `INVALID_DIFF_RANGE` (M17, <section_ref anchor="eq2rgeei"/>); warunki i szczegóły w slice'ach właścicieli, unia `CliErrorCode` agregowana w dispatcherze

Komendy stronowe i sekcyjne wnoszą do unii **jeden kod spoza katalogu rdzenia** — `ROOT_NOT_FOUND` routera stron. `SECTION_NOT_FOUND` i `PAGE_NOT_FOUND` należały do mapowanej unii od chwili, w której dispatcher zaczął mapować katalog rdzenia; nowe jest przy nich wyłącznie to, które komendy realnie je wywołują. Rozstrzygnięcie graniczne: katalog rdzenia definiuje `PAGE_NOT_FOUND` jako „`(rootId, path)` nie istnieje", więc **nieznany korzeń** — także korzeń systemowy, który dla odkrywania nie ma adresu — nie ma tam pokrycia. Rdzeń odmawia go `INVALID_ARGUMENT` z listą korzeni `kind: pages` w `message` i tak widzą to wołający MCP oraz in-process. CLI, jako transport `server-delegating`, dostaje tę samą odmowę w renderowaniu REST: `ROOT_NOT_FOUND` z listą w `hint`, bo router stron odmawia, zanim wywołanie dotrze do rdzenia. W obu kanałach `PAGE_NOT_FOUND` zostaje zarezerwowany dla przypadku, w którym korzeń `kind: pages` istnieje, a ścieżka nie.
</after_change>

## Context at 2.1.14 — m11-c4s.md sections 1–2 (anchors m11cel00, m11dep00)
### pages/modules/m11-c4s/m11-c4s.md — Cel [anchor: m11cel00]
<after_change>
Agent pracujący w cudzym repozytorium kodu — bez własnego protokołu do naszego serwera, za to z shellem — potrzebuje przeczytać specyfikację, rozwinąć osadzony w niej znacznik do czytelnej treści i dopytać jej autora, gdy coś jest niejasne. Ten moduł daje mu jedno narzędzie wiersza poleceń, w którym każda z tych rzeczy jest wywołaniem **tej samej operacji tego samego serwera**, co widok w przeglądarce — innym kanałem, nie inną semantyką.

Obok czytania i rozwijania stron moduł udostępnia synchroniczną turę agenta: pytanie zadane z terminala wraca jako odpowiedź, zamiast zmuszać do zgadywania albo czekania. Nie uruchamia agenta samodzielnie i nie trzyma własnej kopii logiki — bez działającego serwera nie robi niczego, co dotyka treści specyfikacji.
</after_change>

### pages/modules/m11-c4s/m11-c4s.md — Zależności [anchor: m11dep00]
<after_change>
Wiersz poleceń jest transportem cudzych operacji i nie trzyma własnego magazynu ani własnego rejestru typów — wszystko, co wypisuje, powstaje po stronie serwera.

<tagged_list type="module-dependency" tags="m11"/>
</after_change>

## Context at 2.1.14 — m02-pages.md section 25 (anchor l4rootseg)
### pages/modules/m02-pages.md — Segment rootu — space-scoping stron [anchor: l4rootseg]
<after_change>
Endpointy **stron** (nie encji) niosą segment `:rootId` identyfikujący przestrzeń. Encje są globalne, więc ich trasy `/api/{type}s/*` **nie** dostają segmentu rootu; poniższe dotyczy wyłącznie plików markdown/HTML. `:rootId` wskazuje korzeń z fasadą (<section_ref anchor="m02l13001"/>) — dla odczytu i zapisu; korzeń bez fasady albo spoza rejestru → `404 ROOT_NOT_FOUND`:

- `GET /api/pages/:rootId` — drzewo stron danego rootu (<inline_mention type="endpoint" slug="get-api-pages-rootid"/>).
- `POST /api/pages/:rootId` — create (<inline_mention type="endpoint" slug="post-api-pages"/>).
- `GET|PUT|PATCH|DELETE /api/pages/:rootId/*` — read/write/delete pliku w roocie (splat = relPath): <inline_mention type="endpoint" slug="get-api-pages"/>, <inline_mention type="endpoint" slug="put-api-pages"/>, <inline_mention type="endpoint" slug="patch-api-pages"/>, <inline_mention type="endpoint" slug="delete-api-pages"/>. `PUT` i `PATCH` są **dwoma renderowaniami jednego zapisu** pod tą samą ścieżką — pierwsze przyjmuje stan docelowy, drugie modyfikację — więc dwie trasy nie oznaczają tu dwóch operacji. Tożsamość pliku to `(rootId, relPath)`; `expectedHash` jest wymagany w obu renderowaniach zapisu i opcjonalny przy usunięciu. `GET` jest **odczytem surowego pliku dla edytora**, własnym odczytem M02 wydającym rekord strony (<section_ref anchor="xlx33i1v"/>), a nie renderowaniem `get_page` — agentowy odczyt całej strony nie ma kanału REST.
- `GET /api/pages/:rootId/search` — wyszukiwanie po treści stron **w obrębie jednego rootu** (<inline_mention type="endpoint" slug="get-api-pages-rootid-search"/>). Dopasowywane przed wildcardem read, więc strona o nazwie dosłownie `search` w korzeniu rootu jest zacieniona.
- `POST /api/pages/:rootId/move` — przeniesienie strony w obrębie **jednego** rootu (<inline_mention type="endpoint" slug="post-api-pages-rootid-move"/>). Obie ścieżki idą w ciele żądania, nie w URL-u: czasownik doklejony za splatem dałby `…/foo.md/move` nieodróżnialne od strony `move` leżącej w katalogu `foo.md`, więc — jak przy wyszukiwaniu — czasownik stoi na kolekcji rootu. Cel w innym roocie jest odrzucany, bo tożsamością pliku jest para `(rootId, relPath)`.
- `GET /api/static/:rootId/*` — surowy `.html` z rootu (<inline_mention type="endpoint" slug="get-api-static"/>); path-traversal guard resolwuje względem `dir` tego rootu (M30).
- `GET /api/sidebar-accordions` — tablica akordeonów sidebaru wszystkich korzeni (<inline_mention type="endpoint" slug="get-api-sidebar-accordions"/>); bez segmentu `:rootId`.
</after_change>

## Criteria (3, all active; empty `verifies` → checks own title against the recipe pages, per build override)
### [ac:ac-c4s-get-page-root-id-id-path-p] op=update
AFTER:
```json
{
 "slug": "ac-c4s-get-page-root-id-id-path-p",
 "title": "`c4s get-page --root-id plans --path <p>` kończy się tym samym błędem co nieznany `--root-id` (`ROOT_NOT_FOUND`) — korzeń systemowy nie ma adresu w odkrywaniu, bo router stron rozwiązuje wyłącznie korzenie `kind: pages`.",
 "kind": "edge-case",
 "status": "active",
 "verifies": [],
 "tags": [
  "cli",
  "m11-edge"
 ],
 "createdAt": "2026-08-01T10:53:37.000Z",
 "updatedAt": "2026-10-08T21:51:46.066Z"
}
```
BEFORE:
```json
{
 "slug": "ac-c4s-get-page-root-id-id-path-p",
 "title": "`c4s get-page --root-id plans --path <p>` kończy się tym samym błędem co nieznany `--root-id` — korzeń systemowy nie ma adresu w odkrywaniu, a CLI dziedziczy tę regułę z rdzenia M39 i nie definiuje własnej.",
 "kind": "edge-case",
 "status": "active",
 "verifies": [],
 "tags": [
  "cli",
  "m11-edge"
 ],
 "createdAt": "2026-08-01T10:53:37.000Z",
 "updatedAt": "2026-10-05T16:31:40.925Z"
}
```

### [ac:ac-list-pages-z-rootid-plans-konczy-sie] op=update
AFTER:
```json
{
 "slug": "ac-list-pages-z-rootid-plans-konczy-sie",
 "title": "`list_pages` z `rootId = 'plans'` kończy się tym samym błędem co nieznany identyfikator korzenia — korzeń systemowy nie jest adresowalny w odkrywaniu.",
 "kind": "edge-case",
 "status": "active",
 "verifies": [
  {
   "type": "mcp-tool",
   "slug": "reference-tools-list-pages"
  }
 ],
 "tags": [
  "l13",
  "m39-edge"
 ],
 "createdAt": "2026-10-05T16:34:38.250Z",
 "updatedAt": "2026-10-09T09:54:40.648Z"
}
```
BEFORE:
```json
{
 "slug": "ac-list-pages-z-rootid-plans-konczy-sie",
 "title": "`list_pages` z `rootId = 'plans'` kończy się tym samym błędem co nieznany identyfikator korzenia — korzeń systemowy nie jest adresowalny w odkrywaniu.",
 "kind": "edge-case",
 "status": "active",
 "verifies": [],
 "tags": [
  "l13",
  "m39-edge"
 ],
 "createdAt": "2026-10-05T16:34:38.250Z",
 "updatedAt": "2026-10-05T16:34:38.250Z"
}
```

### [ac:ac-nieznany-root-id-podany-bez-towarzys] op=update
AFTER:
```json
{
 "slug": "ac-nieznany-root-id-podany-bez-towarzys",
 "title": "Nieznany `--root-id` w komendzie stronowej (np. `c4s list-pages --root-id nieistniejacy`) kończy się `ROOT_NOT_FOUND` z listą korzeni `kind: pages` w `hint`, nie `PAGE_NOT_FOUND` — ten ostatni jest zarezerwowany dla przypadku, w którym root istnieje, a ścieżka nie.",
 "kind": "edge-case",
 "status": "active",
 "verifies": [],
 "tags": [
  "cli",
  "m11-edge"
 ],
 "createdAt": "2026-08-01T10:53:37.000Z",
 "updatedAt": "2026-10-08T21:51:46.061Z"
}
```
BEFORE:
```json
{
 "slug": "ac-nieznany-root-id-podany-bez-towarzys",
 "text": "Nieznany `--root-id` podany bez towarzyszącej ścieżki (np. `c4s list-pages --root-id nieistniejacy`) kończy się `INVALID_ARGUMENT` z listą dostępnych rootów w `message`, nie `PAGE_NOT_FOUND` — ten ostatni jest zarezerwowany dla przypadku, w którym root istnieje, a ścieżka nie.",
 "kind": "edge-case",
 "status": "active",
 "verifies": [],
 "description": null,
 "tags": [
  "cli",
  "m11-edge"
 ]
}
```

## Linked entities at 2.1.14 (context, not built here)
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

## Conventions (L14 CLI, L13 roots, L4 API) at 2.1.14
### pages/layers/L14-cli-commands.md — L14 — CLI Commands [anchor: 1hlvn21h]
<after_change>
> Konwencja, w której moduł wnosi swoje komendy do bin `c4s`. Warstwa fiksuje kształt opisu komendy i kontrakt kontrybucji; runtime CLI (dispatcher, resolver projektu/workspace, envelope błędów, formaty wyjścia, packaging) dostarcza implementor.

**Relacja do L3.** Komenda jest **renderowaniem** operacji z katalogu (`@layers/L3-spec-operations.md`), a nie osobnym bytem — semantyka, kody błędów i zasięg deklarowane są raz, w wierszu katalogu. L14 przeżywa jako osobna warstwa, bo niesie substancję **niewyprowadzalną** z operacji (tryb wykonania, flagi własne, exit codes, resolver projektu) i ma konsumenta spoza agenta: operatora maszyny. Dlatego bin `c4s` zawiera również komendy **poza** katalogiem — środowiskowe, których podmiotem nie jest zawartość specyfikacji.
</after_change>
### pages/layers/L14-cli-commands.md — Module slice schema [anchor: flt0hm9r]
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
### pages/layers/L13-page-roots.md — L13 — Korzenie i rodzaje korzeni [anchor: l13top001]
<after_change>
> Konwencja, w której moduł obsługujący pliki specyfikacji albo **wnosi rodzaj korzenia** — dopisuje wartość do enumu rodzajów i deklaruje jej mapę plików, flagi i reakcje L7 — albo deklaruje, **którą flagę lub który rodzaj czyta**, zamiast wskazywać katalog.

</after_change>
### pages/layers/L13-page-roots.md — Role in the system [anchor: l13role01]
<after_change>
L13 jest warstwą framework-shaped. Implementor:

- trzyma rejestr korzeni — korzenie z konfiguracji oraz korzenie zarejestrowane w kodzie;
- składa enum rodzajów z deklaracji modułów;
- rozstrzyga typ pliku z mapy rodzaju;
- egzekwuje flagi w jednym miejscu;
- montuje źródło zdarzeń każdego korzenia, podpina do niego reakcje L7 wybrane przez rodzaj, waliduje ich wymagania i dokłada reakcję bazową o zmianie pliku.

Warstwa nie definiuje transportu, routingu, wersjonowania ani indeksowania. Ustala wyłącznie kontrakt: **każde zachowanie per plik jest bramkowane flagą albo rodzajem korzenia, nigdy katalogiem ani identyfikatorem**.

</after_change>
### pages/layers/L13-page-roots.md — Module slice schema [anchor: l13slice0]
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
### pages/layers/L4-api.md — L4 — API [anchor: lepbk8sv]
<after_change>
> Grubość wire'u nad katalogiem operacji: metoda i ścieżka, kody statusu, koperta odpowiedzi, transporty specjalne i wyjątki od konwencji routingu — to, czego z samej operacji wyprowadzić się nie da.
</after_change>
### pages/layers/L4-api.md — Rola w systemie [anchor: 4ekrg55r]
<after_change>
Warstwa jest framework-shaped: jeden implementor podnosi powierzchnię żądań i powierzchnię połączeń trwałych, trzyma rejestr zdarzeń i egzekwuje wspólną kopertę odpowiedzi, a konsumenci wnoszą do niej trasy i deklarują wyłącznie to, czym od konwencji odchodzą. REST jest tu **jedną powierzchnią o dwóch konsumentach** — interfejsem i wołającym programowym — a nie powierzchnią zarezerwowaną dla UI: szerokość rekordu dla obu ustala ten sam parametr `select` operacji rdzenia, nie osobna rodzina tras i nie osobna polityka per powierzchnia.

Warstwa **nie** mówi, co można zrobić — to katalog operacji — ani jak długo żyje obiekt obsługujący żądanie, ani która przestrzeń stron odpowiada pod danym adresem. Fiksuje grubość wire'u i nic ponad to.
</after_change>
### pages/layers/L4-api.md — Module slice schema [anchor: pondhd6o]
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

## Stubs
None assigned to this unit (stubs.json has no entry with provider m11-cli-root-not-found).

## Jobs
None.

## Not yet / Completes
None.
