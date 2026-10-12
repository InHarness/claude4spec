# Packet — unit pkg-lvs-ac (single portion)

- Window: 2.1.13 → 2.1.14 (delta)
- Goal: Plik `workflows/brief-workflow.md` stylu `layered-vertical-slices` zyskuje trzy elementy (krok mapy wciąga każde kryterium/encję utworzone albo zmienione w oknie; checklista końcowa: każdy taki slug w przepisie dokładnie jednej jednostki; reguła przypisania sluga bez tagu modułu i bez `verifies` do jednostki czytającej jego przedmiot, w braku — do ostatniej fali). Blok narracyjny modułu kryteriów (c4s-plugin-ac) w prompcie agenta: `verifies` wypełnia się tylko, gdy przedmiotem kryterium jest encja; kryterium zachowania opisanego prozą zostawia je puste.
- Layers touched: L11 (koperta pakietu: plugin manifest / skill files), L2 (domain: `verifies[]`)
- Entities: 3 (ac); criteria: 3; jobs: none
- Conventions: none of the build's convention layers (L3/L4/L5/L7/L13/L14/L17) touched
- Stubs: none to close, none expected
- Not yet: none. Completes: none. Remove: none.
- Packet size:    75669 bytes

## Read r1: CHANGE layered-vertical-slices.md (all)

### [x4imgq6m] CZĘŚĆ I — KOPERTA (raz na pakiet) > Wymagania wobec zawartości pakietu


Granica zapisana w <section_ref anchor="6vgwqwq6"/> — *spec fiksuje obowiązek, nie tekst* — bywa czytana o jedno pole za szeroko, i wtedy przestaje fiksować cokolwiek. Brzmienie akapitów `SKILL.md`, ton i dobór przykładów są wewnętrzne dla pakietu i do specyfikacji nie wchodzą. **Kontrakt zawartości wchodzi.** Powód jest mechaniczny, nie estetyczny: pliki pakietu żyją w repo z kodem, a zmiana dociera do nich jedyną drogą, jaką ma — przez release i brief — i brief niesie wyłącznie to, co stoi w specyfikacji. Wymaganie zapisane w prozie planu albo w wątku czatu nie jedzie nigdzie i nie ma komu go wykonać.

Rozstrzyga więc jeden test: **czy da się to sprawdzić, czytając repo pakietu, bez sięgania po czyjąś opinię**. Zdanie, które test przechodzi, należy tutaj. Zdanie o tym, czy akapit jest dobrze napisany — nie.

| Plik | Co pakiet ma narzucać |
|---|---|
| `templates/module.md` | Pierwszą sekcją H2 szablonu modułu jest dosłowne `## Cel`. Między nagłówkiem H1 a tą sekcją szablon nie stawia żadnej treści — w szczególności nie ma bloku hooka, który dublował cel bez własnego anchora |
| `SKILL.md` | Reguła kompozycji sekcji `Cel`: jedno zdanie nazywające **user job**, 2–4 zdania o tym, jak moduł go realizuje i **czego nie robi**, przy jawnym budżecie znaków. Do tego zakaz samodzielnościowy i katalog reguł rozstrzygalnych mechanicznie (niżej) oraz protokół odczytu przekrojowego |
| `workflows/daily.md` · `workflows/brief.md` · `workflows/patch.md` | Każdy z trzech odsyła do protokołu odczytu przekrojowego w swoim kroku lokalizowania zmiany — odpowiednio: routingu zmiany, podziału diffu i lokalizacji odstępstwa |
| `workflows/daily.md` | Krok raportowania z przeglądu stylu wylicza kształty odpowiedzi jako **zbiór rozłączny i zamknięty**, w którym jednym z kształtów jest **pusta zwrotka = wyczerpany budżet**, raportowana jak w <section_ref anchor="dcqabr1d"/>. Wymogiem jest rozłączność i zamkniętość zbioru plus obecność tego kształtu — nie brzmienie ani liczba pozycji, która jest konsekwencją. W treść `promptBody` wiersz nie wchodzi: obowiązek raportowania przyrostowego mieszka po stronie przypadku brzegowego koperty |
| `templates/module.md` | Druga sekcja H2 szablonu modułu nosi dosłownie nagłówek `## Zależności` — z diakrytyką |
| `templates/module.md` | Ta sekcja zawiera **wyłącznie** osadzenie `<tagged_list type="module-dependency" tags="mNN"/>` plus jedno zdanie prozy. Żadnej tabeli markdown |
| `templates/module.md` | Szablon nie zawiera sekcji sumującej warstwy — ani `## Wykorzystanie warstw`, ani `## Warstwy`, ani `## Layers`, ani tabeli, której pierwsza kolumna niesie `L\d+` |
| `templates/index.md` | Szablon indeksu nie zawiera sekcji relacji kluczowych — ani `### Key relations`, ani `### Relacje kluczowe`, ani żadnego bloku (ASCII, proza, osadzenie diagramu) rysującego krawędzie moduł→moduł |
| `SKILL.md` | Reguła nr 1 — indeks zgodny z plikami — nie niesie objawu odwołującego się do diagramu relacji w indeksie; jej objawy mówią wyłącznie o rozjeździe tabeli modułów i tabeli warstw z plikami. Ten sam zakaz obowiązuje w każdym workflow niosącym kopię drift-checku |
| `SKILL.md` | §5 opisuje sekcję zależności modułu jako osadzenie krawędzi moduł→moduł, nie jako „dependencies table" |
| `SKILL.md` | §6 reguła nr 3 stwierdza, że zbiór sekcji warstwowych modułu jest **jedyną** deklaracją dotykanych przez niego warstw, a treść relacji z warstwą należy do sekcji tej warstwy |
| `SKILL.md` | §6 zakazuje w pliku warstwy (`layers/LY-<slug>.md`) tokenu `[Mm]\d+` oraz `section_ref` — poza slotem `Implementor module:`, jedynym faktem, który jest o warstwie, a nie o module. Zakaz ma **nazwane objawy**: token modułu w treści pliku warstwy poza slotem; `section_ref` gdziekolwiek w pliku warstwy. Placeholder `MNN`/`mNN` we wzorcu osadzenia w schemacie slice'u naruszeniem nie jest. Reguła nie sięga plików `modules/MXX-<slug>/LY-<slug>.md`, które są slice'ami modułu |
| `templates/layer.md` | Komentarz szablonu, obok wymogu *radically thin*, mówi wprost: proza warstwy nie nazywa modułów, a slot `Implementor module:` jest jedynym miejscem, w którym identyfikator modułu w tym pliku pada. Placeholder `MNN`/`mNN` we wzorcu osadzenia jest placeholderem szablonu, nie referencją |
| `SKILL.md` | §6 niesie rejestr opisu relacji dla pola `needs`, uzasadniony przez „jeden dom dla faktu" (§6.2) — nie przez §7, który jest zawężony do sekcji `Cel` |
| `SKILL.md` | §6 stwierdza, że encja opisuje **jeden** kierunek i nosi tag wyłącznie modułu wymagającego; krawędzie przychodzące są zapytaniem, nie osadzeniem |
| `SKILL.md` | §6 zakazuje wystąpienia tokenu `M\d+` w polu `needs` — pole opisuje, co płynie, nigdy między kim |
| `SKILL.md` | §7 rozdziela dwa domy: granice relacyjne moduł→moduł należą do sekcji zależności, relacja z warstwą — do sekcji tej warstwy |
| `SKILL.md` | §8 niesie drugi protokół odczytu: ustal moduły merytorycznie → odczytaj krawędzie wychodzące po tagu → przychodzące przez `filters` na polu `provider` → dociągnij moduły po drugiej stronie |
| `SKILL.md` | Klauzula formy zapisu pozostaje pisana **bez slugu typu**; nakaz użycia `module-dependency` stoi poza nią, jako reguła treściowa stylu współdostarczanego z typem |
| `workflows/daily.md` | Krok translacji, przypadek „Cross-module relation": powstaje **jedna** encja krawędzi, otagowana tagiem modułu wymagającego |
| `workflows/daily.md` | Krok drift-check pyta, czy każdy `L\d+` w pliku modułu ma odpowiadającą sekcję warstwową, oraz czy każda krawędź nosi tag swojego `dependent` |
| `workflows/bootstrap.md` | Faza tworząca relacje między modułami tworzy krawędzie jako encje, nie jako wiersze tabeli, i nie wypełnia ich warstwami |
| `SKILL.md` | Sekcja pojęć rdzeniowych stwierdza, że `Domain` jest **sekcją modułu, nie warstwą**: nie ma pliku w `layers/`, nie ma slice schema ani slotu implementora, a jej reguły niosą workflowy — tak samo jak reguły `Cel`. Przykład warstwy rodzącej się z dzielonej konwencji zostaje |
| `templates/module.md` | Trzecią sekcją H2 szablonu modułu jest dosłowne `## Domain`, bezpośrednio po `## Zależności`, bez numeru warstwy i bez sufiksu; jej treść stoi wyłącznie pod nagłówkami `###` (co najmniej dwa placeholdery), a komentarz szablonu nazywa budżet i test przynależności |
| `workflows/daily.md` · `workflows/bootstrap.md` | Oba niosą **pełną kopię** bloku reguł sekcji `Domain` — tak jak obie niosą reguły `Cel`: test residuum względem `## Module slice schema` warstw projektu, trzy pytania w kolejności, cztery rodzaje treści jako opis, formę, katalog reguł mechanicznych z objawami i pozycję rozstrzyganą przeciw tabeli warstw. Blok nie nazywa żadnej konkretnej warstwy, kanału ani typu encji |
| `workflows/daily.md` | Krok drift-check wylicza pozycje `Dom 1`–`Dom 6`, po jednej na regułę mechaniczną, każdą z nazwanym objawem; krok translacji przy zmianie w module pyta najpierw, czy któraś warstwa projektu o tę treść pyta |
| `workflows/bootstrap.md` | Faza proponowania warstw nadal zakazuje warstwy o nazwie `Domain`, a zakaz odsyła do sekcji `Domain` modułu jako domu tej treści |
| `workflows/brief.md` | Tabela rozpoznania klasyfikuje diff w `## Domain` tak jak diff w `## Cel`: substantive, do przełożenia na zachowanie systemu |
<after_change>| `workflows/brief-workflow.md` | Krok mapy wciąga do mapy **każde** aktywne kryterium `ac` i **każdą** encję, które okno utworzyło albo zmieniło — wprost z okna, nie tylko te, które wskazują sekcje zmienione w oknie albo `verifies` celujące w zmienioną encję |
| `workflows/brief-workflow.md` | Checklista końcowa wymaga, by każdy slug kryterium i encji utworzony albo zmieniony w oknie stał w linii `Read:` dokładnie jednej jednostki (z podziałem `not yet` / `completes` dla części). Slug, którego nie przypisują ani tagi modułu, ani `verifies`, trafia do jednostki, której przepis czyta sekcję albo encję, o którą chodzi; gdy takiej nie ma — do jednostki ostatniej fali. Nie wypada z przepisów |</after_change>

<after_change>**Kompletność przepisów workflow briefu.** Pętla implementacji buduje i weryfikuje wyłącznie to, co nazywa przepis jednostki. Kryterium spoza wszystkich przepisów nie dostaje testu, a encja spoza nich nie dostaje sprawdzenia kształtu przy `to_release`. Nic tego nie zgłasza aż do weryfikacji systemowej całego okna, czyli za późno, by któraś jednostka to zbudowała. Dobór przez zmienione sekcje modułów gubi właśnie to, co okno zmieniło bez dotykania sekcji modułu — typowo przeredagowania kryteriów i encji po zmianie nazw kluczy konfiguracji. Dlatego źródłem listy jest okno, a sekcje i `verifies` służą tylko do przypisania slugu do jednostki, nie do decyzji, czy slug w ogóle trafi do przepisów.</after_change>
**Indeks bez diagramu relacji.** Krawędź moduł→moduł ma jeden dom — encję `module-dependency` otagowaną modułem wymagającym i osadzoną w jego sekcji zależności. Rysunek relacji w indeksie był drugim domem tego samego faktu: utrzymywany ręcznie, rozjeżdżał się z encjami po każdej zmianie, a jego zgodności nie da się sprawdzić na samym tekście — reguła nr 1 kazała ją sprawdzać, nie dając na to żadnego rozstrzygalnego objawu. Pakiet nie narzuca więc w indeksie żadnej formy przeglądu krawędzi: kto chce obrazu całości, czyta go zapytaniem — wychodzące po tagu modułu, przychodzące przez `filters` na polu `provider`. Zakaz jest negatywny i na tym się kończy: indeks nadal niesie tabelę modułów i tabelę warstw, bo one nie dublują niczego.

**Zakaz samodzielnościowy.** Sekcja `Cel` nie zawiera osadzeń encji, `section_ref` ani identyfikatorów modułów i warstw — także własnego. Wszystkie trzy mają jedno źródło: `Cel` odpowiada na pytanie *po co ten moduł istnieje*, a każda z nich mówi o czymś **innym niż ten moduł**. Granice relacyjne mają własną sekcję z tabelą i tam są rozstrzygalne, bo tam mają kolumnę na to, czym relacja jest. Zakres negatywny — *nie wprowadza tabel*, *nie wystawia toola* — zostaje, bo nie wymaga ani jednego obcego identyfikatora.

**Zakaz nazywania modułów w pliku warstwy.** Plik warstwy nie zawiera tokenu `[Mm]\d+` ani `section_ref` — poza slotem `Implementor module:`. Zasada nie jest nowa: styl mówi już, że warstwa nie wylicza, jakie moduły istnieją, a test layer-purity pyta, czy treść przeżyłaby usunięcie modułu. Nowa jest **forma mechaniczna**, bo zasada bez nazwanego objawu wraca opinią zamiast odstępstwa. Uzasadnienie jest identyczne jak przy `Cel` i przy polu `needs`: zakaz nic nie kosztuje, bo relacja modułu z warstwą ma jeden dom — sekcję tej warstwy w pliku modułu. Slot jest wyjątkiem, bo niesie jedyny fakt, który jest **o warstwie** — kto ją implementuje — i z tego samego powodu nie wolno go parafrazować w prozie obok: dublowanie slotu zdaniem wskazującym implementora z numeru i odsyłającym do jego sekcji daje jednemu faktowi dwa domy. `section_ref` jest zakazany **bezwarunkowo**, nie tylko wtedy, gdy celuje w stronę modułu: anchor nie mówi, gdzie mieszka, więc wersja warunkowa nie byłaby rozstrzygalna na samym tekście pliku i wypadłaby z katalogu reguł mechanicznych. Zakres negatywny zostaje bez drugiego wyjątku — *„semantyka tagów do tej warstwy nie należy”* nie wymaga ani jednego obcego identyfikatora. Zakaz obejmuje pliki `layers/LY-<slug>.md`; plik `LY-<slug>.md` wewnątrz katalogu modułu jest slice'em modułu i podlega regułom modułu.

**Katalog reguł mechanicznych.** `SKILL.md` niesie go w formie, którą recenzent stosuje wprost: każda pozycja rozstrzygalna na samym tekście sekcji, bez wiedzy o dziedzinie, i każda z **nazwanym objawem naruszenia**. Reguła bez objawu wraca opinią zamiast odstępstwa. Katalog obejmuje co najmniej: dokładnie jedną sekcję `## Cel` jako pierwszą H2; brak treści między H1 a nią; brak osadzeń i `section_ref`; brak identyfikatora modułu lub warstwy; wyłącznie akapity, bez list, tabel i cytatów; mieszczenie się w budżecie znaków. Siódma pozycja — czy zdanie otwierające nazywa user job — jest **jakościowa i tylko taka być może**, więc pakiet zapisuje ją jako pytanie z odpowiedzią tak/nie, z testem negatywnym na tautologię *„X zajmuje się X”*.

**Sekcja `Domain`.** Pakiet nakazuje, by plik główny modułu niósł co najwyżej jedną sekcję `## Domain` — trzecią H2, tuż po `## Zależności` — i by była to sekcja **modułu, nie warstwy**: bez pliku w `layers/`, bez slice schema, bez slotu implementora. Moduł, którego cała substancja jest how-mode'em warstwy, którą implementuje, sekcji po prostu nie ma; wariant `n/d` nie istnieje.

**Test przynależności jest residuum względem warstw projektu, nie listą tematów.** Warstwy decydują, co moduł mówi w sekcjach warstwowych: każdy plik warstwy ustala w `## Module slice schema` pola, na które moduł odpowiada, a zdanie odpowiadające na takie pole należy do sekcji tej warstwy i nigdzie indziej. Trzy dalsze sekcje mają własny stały podmiot: `Cel` (po co), przypadki brzegowe (sytuacja → zachowanie), kryteria akceptacji (co obserwowalne). `Domain` niesie resztę — substancję modułu, o którą **żadna warstwa tego projektu nie pyta**: własny model, reguły, których przestrzegają jego operacje, procesy, które posiada od początku do końca, to, czego celowo nie robi. Test jest względny wobec tabeli warstw: w projekcie bez warstwy dla linii komend zachowanie komend jest substancją `Domain`; z dniem wprowadzenia takiej warstwy te same akapity stają się jej slice'em i wędrują. Moduł nietykający żadnej warstwy nie jest pusty — ma cel, `Domain` i kryteria; czysty implementor może nie mieć `Domain` wcale. Oba przypadki są poprawne.

**Trzy pytania, w kolejności, o każdy akapit.** (1) *Czy któraś warstwa projektu o to pyta?* — odpowiedź na pole schematu warstwy idzie do sekcji tej warstwy. (2) *Czy ten moduł jest właścicielem faktu?* — czy zdanie stałoby tu, gdyby wszystkie inne moduły zniknęły; cudze wnętrze to jedno zdanie i odesłanie, reguła jest zapisana raz, u właściciela. (3) *Specyfikacja czy implementacja?* — nazwy funkcji, ścieżki i wywołania bibliotek rozstrzyga zakaz kodu. Co przechodzi wszystkie trzy i nie jest celem, przypadkiem brzegowym ani kryterium — jest `Domain`. W praktyce ta substancja ma cztery postaci, które pakiet zapisuje jako **opis, nie zamkniętą listę**: model (pojęcia, tożsamość, stany), inwarianty i decyzje (z powodem; także zakres negatywny), cykl życia (proces posiadany end-to-end, kroki po jednej linii, krok cudzy = zdanie i odesłanie), granica (czego moduł celowo nie robi).

**Forma.** Treść wyłącznie pod nagłówkami `###` o nazwach dobranych przez moduł — dowolne są nagłówki, nie rodzaje; `###` jest jednostką, `####` nie występuje; pod H2 stoi co najwyżej jeden akapit mówiący, jakie są podsekcje. Osadzenia są tu **dozwolone**, inaczej niż w `Cel`: podsekcja może osadzić encję niosącą kształt, o którym rozumuje — nie może natomiast nieść kształtu sama, gdy projekt modeluje kształty gdzie indziej.

**Katalog reguł mechanicznych sekcji `Domain`** — każda rozstrzygalna na tekście sekcji, każda z nazwanym objawem: (1) co najwyżej jedna `## Domain` i jest trzecią H2 — *objaw:* `## Domain (L2)`, sufiks w nagłówku, sekcja w innym miejscu; (2) brak wariantu `n/d` — *objaw:* placeholder w treści albo `n/d` w nagłówku; (3) treść tylko pod `###`, bez `####` — *objaw:* `####` w sekcji, więcej niż jeden akapit wprost pod H2; (4) brak identyfikatora warstwy w nagłówku podsekcji — *objaw:* `###` z tokenem `L\d+`; (5) krótkie fence'y — *objaw:* blok dłuższy niż 10 linii; (6) budżety — *objaw:* podsekcja ponad 3 500 znaków lub sekcja ponad 12 000. **Pozycja siódma jest rozstrzygana przeciw tabeli warstw, nie przeciw tekstowi:** *czy schema którejś warstwy pyta o to zdanie?* — dwóch czytelników z tą samą tabelą warstw dochodzi do tej samej odpowiedzi, ale recenzent musi przeczytać pliki warstw; żaden regex tego nie zrobi. Test negatywny łapiący typową awarię: **krok cyklu życia wymieniający czasowniki innego modułu** — cudzy cykl życia zapisany drugi raz, oblewający pytanie drugie niezależnie od tego, jak płynnie brzmi.

**Gdzie rodzą się warstwy.** Gdy sekcje `Domain` kilku modułów niosą treść tego samego rodzaju w tym samym kształcie — każdy wylicza komendy, każdy wylicza kody błędów, każdy opisuje format pliku — jest to konwencja dzielona przez moduły, czyli warstwa w sensie sekcji pojęć rdzeniowych. Pakiet każe ją wtedy zaproponować wraz ze slice schema; akapity opuszczają każdy `Domain`, a test residuum zaczyna odpowiadać inaczej. Budżety istnieją po to, by ten moment był widoczny — nie po to, by skracać prozę.

**Protokół odczytu przekrojowego.** Filtr ścieżki jest jego **częścią**, nie wariantem: plik główny modułu nazywa się jak moduł, a podstrony nigdy nie zaczynają się od jego prefiksu, więc bez filtru przekrój zwraca cel pliku, który celem modułu nie jest. Protokół deklaruje przy tym dopasowanie **niewrażliwe na wielkość liter**: na dysku prefiks jest małą literą, a wzorzec nazwy w `SKILL.md` zapisuje go wielką. Niedopowiedziane, działa u jednego autora i milczy u drugiego.


## Read r2: CONTEXT lvs offset 0 limit 3

### [y3yimbqb]  > c4s-plugin-layered-vertical-slices

<after_change>
> Koperta wnosząca **typ encji wraz ze stylem, który go nakazuje**: `module-dependency` — skierowana krawędź zależności między modułami — oraz referencyjny styl pisarski `layered-vertical-slices` i dwa subagenty znające organizację specyfikacji pisanej tym stylem.

---
</after_change>

### [iqtrwb0k]  > CZĘŚĆ I — KOPERTA (raz na pakiet)

<after_change></after_change>

### [1pbsl68f] CZĘŚĆ I — KOPERTA (raz na pakiet) > Koperta pakietu (L11)

<after_change>
**Pakiet:** `c4s-plugin-layered-vertical-slices` · **Wnoszone typy:** `module-dependency` · **Status w kodzie:** **wdrożony** — pakiet żyje w `claude4spec/plugins`

> Styl `layered-vertical-slices` jedzie kopertą, nie rootem paczkowym: jego wpis w rejestrze M37 ma `source: "plugin"` i taką samą wartość zwraca <inline_mention type="endpoint" slug="get-api-writing-styles"/>. Root skilli bundled został wraz z tą wyprowadzką wygaszony (M37 <section_ref anchor="m15disc1"/>).

Koperta jest klasy **`sprzężenie`** (M13 <section_ref anchor="hevpbnsk"/>), a sprzężenie biegnie tu między **typem a skillem**, nie między dwoma typami. Styl nakazuje zapisywać relację moduł→moduł encją `module-dependency` — nakazuje ją slugiem i bezwarunkowo, a nie warunkową klauzulą formy — i stać go na to wyłącznie dlatego, że typ jedzie tą samą kopertą i schodzi z rejestru tym samym `unregisterPlugin`. Rozdzielenie na dwie koperty pozwoliłoby odpiąć typ i zostawić styl nakazujący zapis w encji, której nie ma. Konsekwencja czytelnicza: koperta wypełnia odtąd L1, L2, L3, L5, L9 i L12 na równi z każdym innym pakietem wnoszącym typ, i mieszka to w CZĘŚCI II tej strony.

**Trzy sloty, jedno sprzężenie:**

| Slot | Wkład | Gdzie żyje semantyka |
|---|---|---|
| `contributes.entities[]` | `module-dependency` — jedna encja to jedna **skierowana** krawędź zależności między modułami (`dependent`, `provider`, `needs`). Typ **ukryty**: bez `frontend.routes`, `detailPanel` i `sidebarTab` — ale z obsadzonym `renderRow`, więc listowalny. Bez `sidebarTab` świadomie: krawędź czyta się na stronie modułu albo zapytaniem o jej drugi koniec, a lista wszystkich krawędzi korpusu nie odpowiada na żadne pytanie, które ktoś faktycznie zadaje | CZĘŚĆ II tej strony; kontrakt kontrybucji — M13 <section_ref anchor="z7l89jhf"/> |
| `contributes.writingStyles[]` | `layered-vertical-slices` — `SKILL.md` (konwencje modułów, warstw, nazewnictwa i reguł jakości) plus pakiet `workflows/` i `templates/`. Niesie odtąd także **protokół odczytu przekrojowego** — instrukcję dla agenta, który niczego nie pisze, tylko orientuje się w korpusie; to nowy rodzaj treści w slocie, nie nowe brzmienie starej | M15 <section_ref anchor="n0fj7m42"/>; kontrakt podplików metodologicznych — <section_ref anchor="0iigej8b"/> |
| `contributes.subagents[]` | **dwa** wpisy: eksplorator specyfikacji zorientowany w tym stylu — wie, czym jest moduł, czym warstwa i co znaczy adres `MXX-slug/LY-slug` — oraz `spec-review`, który konfrontuje właśnie zapisaną zmianę z regułami stylu i raportuje odstępstwa | M05 <section_ref anchor="iqiwak31"/>; walidacja wkładu i rezerwacja nazw — M33 <section_ref anchor="it907gd0"/> |

**Sloty jadą razem, bo osobno tracą sens — z dwóch różnych powodów.** Typ i styl: typ bez stylu jest encją, której nikt nie każe używać, a styl bez typu nakazuje zapis w encji, której nie ma — to jest dokładnie ta reguła, którą M13 formułuje dla pary typ + skill. Subagenty i styl: `promptBody` **zastępuje** prompt rodzica, więc żaden z nich nie widzi ani aktywnego stylu, ani konwencji encji — eksplorator musiałby zgadywać organizację specyfikacji, której szuka, a recenzent nie miałby wobec czego oceniać zgodności. W drugą stronę: styl bez eksploratora zostawia rodzica z przeszukiwaniem specki na oślep, a styl bez recenzenta zostawia go jedynym sędzią własnej pracy — w tej samej turze i tym samym kontekście, w którym tę pracę napisał.

**Drugi wpis subagentowy — `spec-review`.** Eksplorator opisuje się sam wierszem tabeli wyżej; recenzent wypełnia `PluginSubagentContribution` (M13 <section_ref anchor="m13plenv"/>) tak:

| Pole | Wartość | Dlaczego akurat ta |
|---|---|---|
| `name` | `spec-review` | Wolna w całym korpusie i rozłączna z nazwami wbudowanymi, które host rezerwuje — `spec-explore` i `diff-explore` (M33 <section_ref anchor="it907gd0"/>) |
| `description` | jawnie **oceniająca**: konfrontuje zapisaną zmianę z regułami aktywnego stylu i raportuje odstępstwa — nie lokalizuje | Steruje auto-delegacją i host jej nie przepisuje, więc rozłączność z opisem eksploratora jest jedynym mechanizmem rozdziału (<section_ref anchor="dcqabr1d"/>) |
| `promptBody` | jak zastosować reguły i jak zaraportować odstępstwo — **bez powielania samych reguł** | Reguły mają jedno źródło: `SKILL.md`. Skopiowane do promptu rozjechałyby się przy pierwszej edycji stylu, a rozjazd byłby niewidoczny |
| `contextTypes` | `['chat']` — jawnie, mimo że to wartość domyślna | Jedyny krok wołający leży w workflow „zmiana i przegląd", a to workflow `chat`. Objęcie `patch` wymagałoby bliźniaczego kroku w `workflows/patch.md`, którego ta zmiana nie dokłada |
| `tools` | odczyt stron i sekcji, `load_skill_file`, read-only `release-tools` (<inline_mention type="mcp-tool" slug="release-tools-release-diff"/> / <inline_mention type="mcp-tool" slug="release-tools-release-list"/> / <inline_mention type="mcp-tool" slug="release-tools-release-show"/>) | Selekcja nad zbiorem delegowalnym hosta, przechodząca sanitizer **bez żadnej zmiany w M05**: `release-tools` jest zamontowany w `chat`, a sanitizer odejmuje wyłącznie operacje mutujące (<section_ref anchor="hmz4m74c"/>) |
| `attachInternalSkills` | `['layered-vertical-slices']` | Recenzent sięga po reguły do tego samego rejestru M37 co rodzic, tym samym <inline_mention type="mcp-tool" slug="skill-tools-load-skill-file"/> |
| `model` · `effort` · `maxTurns` | `sonnet` · `medium` · `40` | Budżet tur jest **wyprowadzony z pomiaru**, nie dobrany do sufitu: przegląd 23 sekcji w 8 plikach i 2 rootach kosztował 29 wywołań narzędzi i został przerwany na 15. turze **przed** werdyktem, więc 15 jest zmierzoną dolną granicą niewystarczalności. Dokończenie odczytu delty przy tej objętości to rząd kolejnych 15–20 round-tripów, plus tury na raportowanie przyrostowe — stąd 40, z marginesem na deltę większą niż zaobserwowana. Pomiaru przeglądu **domkniętego** nie mamy, więc przesłanką do kolejnej korekty będzie dopiero następny bieg, który w budżet uderzy |

Wartość `maxTurns` jest zadeklarowana **jawnie**, choć równa się dziś domyślnemu budżetowi tur hosta (M33 <section_ref anchor="it907gd0"/>). Zbieżność jest przypadkowa — 40 wyszło tu z pomiaru pracy recenzenta, a domyślna z rozmiaru przebiegu eksploracyjnego — więc obie liczby będą się rozjeżdżać niezależnie, a koperta, która milczy, zmienia swój budżet w chwili, gdy host zmieni domyślną. Recenzent jest przy tym **jedynym wkładem, dla którego wyczerpanie budżetu wraca do wołającego jako pustka**, a nie jako wypowiedź (<section_ref anchor="dcqabr1d"/>) — dla wkładu, którego trybem porażki jest cisza, milcząca koperta jest złym rodzajem cichości, a wartość dobiera się do najgorszego przypadku, nie do typowego.

**Trigger jest jeden i jest napisany, nie domniemany.** `spec-review` woła **krok zamykający workflow „zmiana i przegląd"** pakietu stylu — po zapisie zmiany, przed raportem końcowym. Host nie ma dla tego haka i nie będzie go szukał: `mark_plan_applied` nie wystawia punktu rozszerzenia, a slotu `contributes.hooks` w kontrakcie koperty nie ma. Wywołanie pozostaje więc miękkie wobec SDK, ale **twarde wobec workflow** — jest krokiem, który autor stylu napisał, a nie nadzieją, że `description` przekona model. Pojedynczość tego miejsca jest zarazem tym, co czyni oba opisy rozłącznymi: granica między subagentami jest **czasowa i przedmiotowa** — recenzent ogląda to, co właśnie zapisano — a nie semantyczna.

**Nośnik treści.** `PluginSkillContribution` niesie `content: string` i `files?: Record<string, string>`, więc `SKILL.md` **i cały pakiet** (`workflows/`, `templates/`) są wbudowane w moduł pluginu jako literały i serwowane z pamięci rejestru — bez lazy-readu z dysku, którym żyją rooty user (M37 <section_ref anchor="m15disc1"/>). To jedyna realna zmiana kosztu względem dostawy plikowej.

**Wiązanie z `@c4s/plugin-runtime`.** Ograniczone do **katalogu UI**: trzy sloty renderujące typu składają się z komponentów katalogu L12, i tylko tyle. Koperta nadal nie dotyka QueryClient, EditorBridge, `versionService` / `tagsService` / `referencesService` / `releasesService` ani utila line-diff, i nie wnosi własnego serwera MCP — slot `backend` w ogóle się nie pojawia, bo typ nie ma metod domenowych poza CRUD. Powierzchnia dotykana z zewnątrz sprowadza się do **kształtu trzech wkładów** (`entities[]`, `writingStyles[]`, `subagents[]`), i tylko on wchodzi do wersjonowanego `hostApiVersion`; wszystko poza tym — treść `SKILL.md`, podział na `workflows/`, brzmienie `promptBody` — jest **wewnętrzne dla pakietu** i wymienialne bez ruszania Host API.

**„Wbudowana" niesie tu jeden konkretny skutek.** Koperta jedzie w paczce hosta i ładuje się **bez bramki zaufania** `trustProjectPlugins`, a `hostApiVersion` zgadza się z konstrukcji, bo koperta i host są budowane razem. To utrzymuje **inwariant podłogi** M15 (<section_ref anchor="n0fj7m42"/>): co najmniej jeden styl rozwiązuje się w każdej instalacji paczki, więc `config.writingStyle` nie może wskazywać slugu bez nośnika. Inwariant przestaje być darmowy dopiero przy wyprowadzce pakietu do osobnego repo npm.
</after_change>


## Read r3: CONTEXT lvs offset 6 limit 1

### [x4imgq6m] CZĘŚĆ I — KOPERTA (raz na pakiet) > Wymagania wobec zawartości pakietu

<after_change>
Granica zapisana w <section_ref anchor="6vgwqwq6"/> — *spec fiksuje obowiązek, nie tekst* — bywa czytana o jedno pole za szeroko, i wtedy przestaje fiksować cokolwiek. Brzmienie akapitów `SKILL.md`, ton i dobór przykładów są wewnętrzne dla pakietu i do specyfikacji nie wchodzą. **Kontrakt zawartości wchodzi.** Powód jest mechaniczny, nie estetyczny: pliki pakietu żyją w repo z kodem, a zmiana dociera do nich jedyną drogą, jaką ma — przez release i brief — i brief niesie wyłącznie to, co stoi w specyfikacji. Wymaganie zapisane w prozie planu albo w wątku czatu nie jedzie nigdzie i nie ma komu go wykonać.

Rozstrzyga więc jeden test: **czy da się to sprawdzić, czytając repo pakietu, bez sięgania po czyjąś opinię**. Zdanie, które test przechodzi, należy tutaj. Zdanie o tym, czy akapit jest dobrze napisany — nie.

| Plik | Co pakiet ma narzucać |
|---|---|
| `templates/module.md` | Pierwszą sekcją H2 szablonu modułu jest dosłowne `## Cel`. Między nagłówkiem H1 a tą sekcją szablon nie stawia żadnej treści — w szczególności nie ma bloku hooka, który dublował cel bez własnego anchora |
| `SKILL.md` | Reguła kompozycji sekcji `Cel`: jedno zdanie nazywające **user job**, 2–4 zdania o tym, jak moduł go realizuje i **czego nie robi**, przy jawnym budżecie znaków. Do tego zakaz samodzielnościowy i katalog reguł rozstrzygalnych mechanicznie (niżej) oraz protokół odczytu przekrojowego |
| `workflows/daily.md` · `workflows/brief.md` · `workflows/patch.md` | Każdy z trzech odsyła do protokołu odczytu przekrojowego w swoim kroku lokalizowania zmiany — odpowiednio: routingu zmiany, podziału diffu i lokalizacji odstępstwa |
| `workflows/daily.md` | Krok raportowania z przeglądu stylu wylicza kształty odpowiedzi jako **zbiór rozłączny i zamknięty**, w którym jednym z kształtów jest **pusta zwrotka = wyczerpany budżet**, raportowana jak w <section_ref anchor="dcqabr1d"/>. Wymogiem jest rozłączność i zamkniętość zbioru plus obecność tego kształtu — nie brzmienie ani liczba pozycji, która jest konsekwencją. W treść `promptBody` wiersz nie wchodzi: obowiązek raportowania przyrostowego mieszka po stronie przypadku brzegowego koperty |
| `templates/module.md` | Druga sekcja H2 szablonu modułu nosi dosłownie nagłówek `## Zależności` — z diakrytyką |
| `templates/module.md` | Ta sekcja zawiera **wyłącznie** osadzenie `<tagged_list type="module-dependency" tags="mNN"/>` plus jedno zdanie prozy. Żadnej tabeli markdown |
| `templates/module.md` | Szablon nie zawiera sekcji sumującej warstwy — ani `## Wykorzystanie warstw`, ani `## Warstwy`, ani `## Layers`, ani tabeli, której pierwsza kolumna niesie `L\d+` |
| `templates/index.md` | Szablon indeksu nie zawiera sekcji relacji kluczowych — ani `### Key relations`, ani `### Relacje kluczowe`, ani żadnego bloku (ASCII, proza, osadzenie diagramu) rysującego krawędzie moduł→moduł |
| `SKILL.md` | Reguła nr 1 — indeks zgodny z plikami — nie niesie objawu odwołującego się do diagramu relacji w indeksie; jej objawy mówią wyłącznie o rozjeździe tabeli modułów i tabeli warstw z plikami. Ten sam zakaz obowiązuje w każdym workflow niosącym kopię drift-checku |
| `SKILL.md` | §5 opisuje sekcję zależności modułu jako osadzenie krawędzi moduł→moduł, nie jako „dependencies table" |
| `SKILL.md` | §6 reguła nr 3 stwierdza, że zbiór sekcji warstwowych modułu jest **jedyną** deklaracją dotykanych przez niego warstw, a treść relacji z warstwą należy do sekcji tej warstwy |
| `SKILL.md` | §6 zakazuje w pliku warstwy (`layers/LY-<slug>.md`) tokenu `[Mm]\d+` oraz `section_ref` — poza slotem `Implementor module:`, jedynym faktem, który jest o warstwie, a nie o module. Zakaz ma **nazwane objawy**: token modułu w treści pliku warstwy poza slotem; `section_ref` gdziekolwiek w pliku warstwy. Placeholder `MNN`/`mNN` we wzorcu osadzenia w schemacie slice'u naruszeniem nie jest. Reguła nie sięga plików `modules/MXX-<slug>/LY-<slug>.md`, które są slice'ami modułu |
| `templates/layer.md` | Komentarz szablonu, obok wymogu *radically thin*, mówi wprost: proza warstwy nie nazywa modułów, a slot `Implementor module:` jest jedynym miejscem, w którym identyfikator modułu w tym pliku pada. Placeholder `MNN`/`mNN` we wzorcu osadzenia jest placeholderem szablonu, nie referencją |
| `SKILL.md` | §6 niesie rejestr opisu relacji dla pola `needs`, uzasadniony przez „jeden dom dla faktu" (§6.2) — nie przez §7, który jest zawężony do sekcji `Cel` |
| `SKILL.md` | §6 stwierdza, że encja opisuje **jeden** kierunek i nosi tag wyłącznie modułu wymagającego; krawędzie przychodzące są zapytaniem, nie osadzeniem |
| `SKILL.md` | §6 zakazuje wystąpienia tokenu `M\d+` w polu `needs` — pole opisuje, co płynie, nigdy między kim |
| `SKILL.md` | §7 rozdziela dwa domy: granice relacyjne moduł→moduł należą do sekcji zależności, relacja z warstwą — do sekcji tej warstwy |
| `SKILL.md` | §8 niesie drugi protokół odczytu: ustal moduły merytorycznie → odczytaj krawędzie wychodzące po tagu → przychodzące przez `filters` na polu `provider` → dociągnij moduły po drugiej stronie |
| `SKILL.md` | Klauzula formy zapisu pozostaje pisana **bez slugu typu**; nakaz użycia `module-dependency` stoi poza nią, jako reguła treściowa stylu współdostarczanego z typem |
| `workflows/daily.md` | Krok translacji, przypadek „Cross-module relation": powstaje **jedna** encja krawędzi, otagowana tagiem modułu wymagającego |
| `workflows/daily.md` | Krok drift-check pyta, czy każdy `L\d+` w pliku modułu ma odpowiadającą sekcję warstwową, oraz czy każda krawędź nosi tag swojego `dependent` |
| `workflows/bootstrap.md` | Faza tworząca relacje między modułami tworzy krawędzie jako encje, nie jako wiersze tabeli, i nie wypełnia ich warstwami |
| `SKILL.md` | Sekcja pojęć rdzeniowych stwierdza, że `Domain` jest **sekcją modułu, nie warstwą**: nie ma pliku w `layers/`, nie ma slice schema ani slotu implementora, a jej reguły niosą workflowy — tak samo jak reguły `Cel`. Przykład warstwy rodzącej się z dzielonej konwencji zostaje |
| `templates/module.md` | Trzecią sekcją H2 szablonu modułu jest dosłowne `## Domain`, bezpośrednio po `## Zależności`, bez numeru warstwy i bez sufiksu; jej treść stoi wyłącznie pod nagłówkami `###` (co najmniej dwa placeholdery), a komentarz szablonu nazywa budżet i test przynależności |
| `workflows/daily.md` · `workflows/bootstrap.md` | Oba niosą **pełną kopię** bloku reguł sekcji `Domain` — tak jak obie niosą reguły `Cel`: test residuum względem `## Module slice schema` warstw projektu, trzy pytania w kolejności, cztery rodzaje treści jako opis, formę, katalog reguł mechanicznych z objawami i pozycję rozstrzyganą przeciw tabeli warstw. Blok nie nazywa żadnej konkretnej warstwy, kanału ani typu encji |
| `workflows/daily.md` | Krok drift-check wylicza pozycje `Dom 1`–`Dom 6`, po jednej na regułę mechaniczną, każdą z nazwanym objawem; krok translacji przy zmianie w module pyta najpierw, czy któraś warstwa projektu o tę treść pyta |
| `workflows/bootstrap.md` | Faza proponowania warstw nadal zakazuje warstwy o nazwie `Domain`, a zakaz odsyła do sekcji `Domain` modułu jako domu tej treści |
| `workflows/brief.md` | Tabela rozpoznania klasyfikuje diff w `## Domain` tak jak diff w `## Cel`: substantive, do przełożenia na zachowanie systemu |
| `workflows/brief-workflow.md` | Krok mapy wciąga do mapy **każde** aktywne kryterium `ac` i **każdą** encję, które okno utworzyło albo zmieniło — wprost z okna, nie tylko te, które wskazują sekcje zmienione w oknie albo `verifies` celujące w zmienioną encję |
| `workflows/brief-workflow.md` | Checklista końcowa wymaga, by każdy slug kryterium i encji utworzony albo zmieniony w oknie stał w linii `Read:` dokładnie jednej jednostki (z podziałem `not yet` / `completes` dla części). Slug, którego nie przypisują ani tagi modułu, ani `verifies`, trafia do jednostki, której przepis czyta sekcję albo encję, o którą chodzi; gdy takiej nie ma — do jednostki ostatniej fali. Nie wypada z przepisów |

**Kompletność przepisów workflow briefu.** Pętla implementacji buduje i weryfikuje wyłącznie to, co nazywa przepis jednostki. Kryterium spoza wszystkich przepisów nie dostaje testu, a encja spoza nich nie dostaje sprawdzenia kształtu przy `to_release`. Nic tego nie zgłasza aż do weryfikacji systemowej całego okna, czyli za późno, by któraś jednostka to zbudowała. Dobór przez zmienione sekcje modułów gubi właśnie to, co okno zmieniło bez dotykania sekcji modułu — typowo przeredagowania kryteriów i encji po zmianie nazw kluczy konfiguracji. Dlatego źródłem listy jest okno, a sekcje i `verifies` służą tylko do przypisania slugu do jednostki, nie do decyzji, czy slug w ogóle trafi do przepisów.

**Indeks bez diagramu relacji.** Krawędź moduł→moduł ma jeden dom — encję `module-dependency` otagowaną modułem wymagającym i osadzoną w jego sekcji zależności. Rysunek relacji w indeksie był drugim domem tego samego faktu: utrzymywany ręcznie, rozjeżdżał się z encjami po każdej zmianie, a jego zgodności nie da się sprawdzić na samym tekście — reguła nr 1 kazała ją sprawdzać, nie dając na to żadnego rozstrzygalnego objawu. Pakiet nie narzuca więc w indeksie żadnej formy przeglądu krawędzi: kto chce obrazu całości, czyta go zapytaniem — wychodzące po tagu modułu, przychodzące przez `filters` na polu `provider`. Zakaz jest negatywny i na tym się kończy: indeks nadal niesie tabelę modułów i tabelę warstw, bo one nie dublują niczego.

**Zakaz samodzielnościowy.** Sekcja `Cel` nie zawiera osadzeń encji, `section_ref` ani identyfikatorów modułów i warstw — także własnego. Wszystkie trzy mają jedno źródło: `Cel` odpowiada na pytanie *po co ten moduł istnieje*, a każda z nich mówi o czymś **innym niż ten moduł**. Granice relacyjne mają własną sekcję z tabelą i tam są rozstrzygalne, bo tam mają kolumnę na to, czym relacja jest. Zakres negatywny — *nie wprowadza tabel*, *nie wystawia toola* — zostaje, bo nie wymaga ani jednego obcego identyfikatora.

**Zakaz nazywania modułów w pliku warstwy.** Plik warstwy nie zawiera tokenu `[Mm]\d+` ani `section_ref` — poza slotem `Implementor module:`. Zasada nie jest nowa: styl mówi już, że warstwa nie wylicza, jakie moduły istnieją, a test layer-purity pyta, czy treść przeżyłaby usunięcie modułu. Nowa jest **forma mechaniczna**, bo zasada bez nazwanego objawu wraca opinią zamiast odstępstwa. Uzasadnienie jest identyczne jak przy `Cel` i przy polu `needs`: zakaz nic nie kosztuje, bo relacja modułu z warstwą ma jeden dom — sekcję tej warstwy w pliku modułu. Slot jest wyjątkiem, bo niesie jedyny fakt, który jest **o warstwie** — kto ją implementuje — i z tego samego powodu nie wolno go parafrazować w prozie obok: dublowanie slotu zdaniem wskazującym implementora z numeru i odsyłającym do jego sekcji daje jednemu faktowi dwa domy. `section_ref` jest zakazany **bezwarunkowo**, nie tylko wtedy, gdy celuje w stronę modułu: anchor nie mówi, gdzie mieszka, więc wersja warunkowa nie byłaby rozstrzygalna na samym tekście pliku i wypadłaby z katalogu reguł mechanicznych. Zakres negatywny zostaje bez drugiego wyjątku — *„semantyka tagów do tej warstwy nie należy”* nie wymaga ani jednego obcego identyfikatora. Zakaz obejmuje pliki `layers/LY-<slug>.md`; plik `LY-<slug>.md` wewnątrz katalogu modułu jest slice'em modułu i podlega regułom modułu.

**Katalog reguł mechanicznych.** `SKILL.md` niesie go w formie, którą recenzent stosuje wprost: każda pozycja rozstrzygalna na samym tekście sekcji, bez wiedzy o dziedzinie, i każda z **nazwanym objawem naruszenia**. Reguła bez objawu wraca opinią zamiast odstępstwa. Katalog obejmuje co najmniej: dokładnie jedną sekcję `## Cel` jako pierwszą H2; brak treści między H1 a nią; brak osadzeń i `section_ref`; brak identyfikatora modułu lub warstwy; wyłącznie akapity, bez list, tabel i cytatów; mieszczenie się w budżecie znaków. Siódma pozycja — czy zdanie otwierające nazywa user job — jest **jakościowa i tylko taka być może**, więc pakiet zapisuje ją jako pytanie z odpowiedzią tak/nie, z testem negatywnym na tautologię *„X zajmuje się X”*.

**Sekcja `Domain`.** Pakiet nakazuje, by plik główny modułu niósł co najwyżej jedną sekcję `## Domain` — trzecią H2, tuż po `## Zależności` — i by była to sekcja **modułu, nie warstwy**: bez pliku w `layers/`, bez slice schema, bez slotu implementora. Moduł, którego cała substancja jest how-mode'em warstwy, którą implementuje, sekcji po prostu nie ma; wariant `n/d` nie istnieje.

**Test przynależności jest residuum względem warstw projektu, nie listą tematów.** Warstwy decydują, co moduł mówi w sekcjach warstwowych: każdy plik warstwy ustala w `## Module slice schema` pola, na które moduł odpowiada, a zdanie odpowiadające na takie pole należy do sekcji tej warstwy i nigdzie indziej. Trzy dalsze sekcje mają własny stały podmiot: `Cel` (po co), przypadki brzegowe (sytuacja → zachowanie), kryteria akceptacji (co obserwowalne). `Domain` niesie resztę — substancję modułu, o którą **żadna warstwa tego projektu nie pyta**: własny model, reguły, których przestrzegają jego operacje, procesy, które posiada od początku do końca, to, czego celowo nie robi. Test jest względny wobec tabeli warstw: w projekcie bez warstwy dla linii komend zachowanie komend jest substancją `Domain`; z dniem wprowadzenia takiej warstwy te same akapity stają się jej slice'em i wędrują. Moduł nietykający żadnej warstwy nie jest pusty — ma cel, `Domain` i kryteria; czysty implementor może nie mieć `Domain` wcale. Oba przypadki są poprawne.

**Trzy pytania, w kolejności, o każdy akapit.** (1) *Czy któraś warstwa projektu o to pyta?* — odpowiedź na pole schematu warstwy idzie do sekcji tej warstwy. (2) *Czy ten moduł jest właścicielem faktu?* — czy zdanie stałoby tu, gdyby wszystkie inne moduły zniknęły; cudze wnętrze to jedno zdanie i odesłanie, reguła jest zapisana raz, u właściciela. (3) *Specyfikacja czy implementacja?* — nazwy funkcji, ścieżki i wywołania bibliotek rozstrzyga zakaz kodu. Co przechodzi wszystkie trzy i nie jest celem, przypadkiem brzegowym ani kryterium — jest `Domain`. W praktyce ta substancja ma cztery postaci, które pakiet zapisuje jako **opis, nie zamkniętą listę**: model (pojęcia, tożsamość, stany), inwarianty i decyzje (z powodem; także zakres negatywny), cykl życia (proces posiadany end-to-end, kroki po jednej linii, krok cudzy = zdanie i odesłanie), granica (czego moduł celowo nie robi).

**Forma.** Treść wyłącznie pod nagłówkami `###` o nazwach dobranych przez moduł — dowolne są nagłówki, nie rodzaje; `###` jest jednostką, `####` nie występuje; pod H2 stoi co najwyżej jeden akapit mówiący, jakie są podsekcje. Osadzenia są tu **dozwolone**, inaczej niż w `Cel`: podsekcja może osadzić encję niosącą kształt, o którym rozumuje — nie może natomiast nieść kształtu sama, gdy projekt modeluje kształty gdzie indziej.

**Katalog reguł mechanicznych sekcji `Domain`** — każda rozstrzygalna na tekście sekcji, każda z nazwanym objawem: (1) co najwyżej jedna `## Domain` i jest trzecią H2 — *objaw:* `## Domain (L2)`, sufiks w nagłówku, sekcja w innym miejscu; (2) brak wariantu `n/d` — *objaw:* placeholder w treści albo `n/d` w nagłówku; (3) treść tylko pod `###`, bez `####` — *objaw:* `####` w sekcji, więcej niż jeden akapit wprost pod H2; (4) brak identyfikatora warstwy w nagłówku podsekcji — *objaw:* `###` z tokenem `L\d+`; (5) krótkie fence'y — *objaw:* blok dłuższy niż 10 linii; (6) budżety — *objaw:* podsekcja ponad 3 500 znaków lub sekcja ponad 12 000. **Pozycja siódma jest rozstrzygana przeciw tabeli warstw, nie przeciw tekstowi:** *czy schema którejś warstwy pyta o to zdanie?* — dwóch czytelników z tą samą tabelą warstw dochodzi do tej samej odpowiedzi, ale recenzent musi przeczytać pliki warstw; żaden regex tego nie zrobi. Test negatywny łapiący typową awarię: **krok cyklu życia wymieniający czasowniki innego modułu** — cudzy cykl życia zapisany drugi raz, oblewający pytanie drugie niezależnie od tego, jak płynnie brzmi.

**Gdzie rodzą się warstwy.** Gdy sekcje `Domain` kilku modułów niosą treść tego samego rodzaju w tym samym kształcie — każdy wylicza komendy, każdy wylicza kody błędów, każdy opisuje format pliku — jest to konwencja dzielona przez moduły, czyli warstwa w sensie sekcji pojęć rdzeniowych. Pakiet każe ją wtedy zaproponować wraz ze slice schema; akapity opuszczają każdy `Domain`, a test residuum zaczyna odpowiadać inaczej. Budżety istnieją po to, by ten moment był widoczny — nie po to, by skracać prozę.

**Protokół odczytu przekrojowego.** Filtr ścieżki jest jego **częścią**, nie wariantem: plik główny modułu nazywa się jak moduł, a podstrony nigdy nie zaczynają się od jego prefiksu, więc bez filtru przekrój zwraca cel pliku, który celem modułu nie jest. Protokół deklaruje przy tym dopasowanie **niewrażliwe na wielkość liter**: na dysku prefiks jest małą literą, a wzorzec nazwy w `SKILL.md` zapisuje go wielką. Niedopowiedziane, działa u jednego autora i milczy u drugiego.
</after_change>


## Read r4: CHANGE c4s-plugin-ac.md offset 0 limit 2

### [fsu38c8q] c4s-plugin-ac > Koperta pakietu (L11) > Plugin manifest (`registerEntityModule`)


AC plugin to pojedyncza deklaracja (`EntityContribution` — authoring-shape, kanon M13 <section_ref anchor="z7l89jhf"/>) rejestrowana w bootstrap przez `registerEntityModule(acModule)`. CRUD, trasy i projekcję generuje host ze schematu logicznego; `backend` niesie **wyłącznie** metodę domenową (`AcAnalysisService`) i custom serwer `ac-tools` z <inline_mention type="mcp-tool" slug="ac-tools-analyze-ac-against-entities"/>.

```typescript
import type { EntityContribution } from "@inharness-ai/claude4spec/plugin-runtime";
import { CheckSquareIcon } from "lucide-react";

export const acModule: EntityContribution = {
  // ─── Tożsamość (płaska — EntityModuleManifest) ───
  type: "ac",
  label: "Acceptance Criterion",
  labelPlural: "Acceptance Criteria",
  displayOrder: 5,
  pathPrefix: "/api/acs",
  slugPattern: "ac-{truncate(slugify(title), 40)}",  // literał + slugify(title) + truncate; create-time only

  // ─── Dane — schemat logiczny (jedyne źródło kształtu; M13 L2-entity-composition) ───
  data: {
    schema: {
      // zarezerwowane pole każdego typu — dla `ac` JEDYNE pole autorskie na treść kryterium.
      // maxLength rozszerzony ponad domyślną hosta (200) — M13 L2-entity-composition.
      // Brak `computedDefault`: nie ma z czego wyprowadzać, więc `title` jest wymagany wprost.
      title:       { type: "string", required: true, maxLength: 500 },
      kind:        { type: "enum", values: ["requirement", "edge-case"], default: "requirement" },
      status:      { type: "enum", values: ["active", "deprecated"], default: "active" },
      verifies: {                               // kolekcja WARTOŚCIOWA — referencje polimorficzne
        collection: { kind: "value", identity: ["type", "slug"] },  // tożsamość elementu → delta po parze, nie po indeksie
        of: {
          type: { type: "string", required: true },   // typ encji-celu
          slug: {                                      // ref polimorficzny — typ celu z pola `type` elementu
            ref: "$type", onMissing: "warn", onDelete: "leave-dangling", required: true,
          },
        },
      },
    },
  },

  // ─── Backend (opcjonalny — WYŁĄCZNIE metody domenowe; CRUD generuje host) ───
  backend: {
    service: (ctx) => new AcAnalysisService(ctx),   // L2 — semantyczny audyt (poza ścieżką CRUD)
    mcpServer: (service, ctx) =>                    // L3 — CUSTOM tool only (CRUD żyje w entity-tools)
      createMcpServer({ name: "ac-tools", tools: [analyzeAcAgainstEntitiesTool(service, ctx)] }),
  },

  // ─── Frontend ───
  frontend: {
    routes: acRouteTree,                        // L5 — /acs, /acs/$slug, /acs/$slug/history
    sidebarTab: {
      icon: CheckSquareIcon,
      label: "Acceptance Criteria",
      order: 5,
      emptyState: "No AC yet. Create with /ac in the editor or chat.",
    },
    renderChip: AcChip,                         // L8 — `[AC]` badge + title (obcięty) + kind badge
    renderCard: AcCard,                         // L8 — full detail (single_element)
    renderRow: AcRow,                           // L8 — title + kind badge + tags
    detailPanel: AcDetail,                      // L5/L8 — entity detail page
    editorExtensions: [acSlashCommand],         // L8 — `/ac` extension
  },

  // ─── Serializacja (L9) ───
  // pola contentBearing: brak
  payloadVersion: 3,                            // v3: `text` i `description` znikają — treść żyje w `title`
  payloadUpgrades: [acV1ToV2, acV2ToV3],        // v1→2: title := truncate(text, 200)
                                                // v2→3: title := text; drop text; drop description
                                                //        ODMAWIA (nie obcina) gdy text > 500 — patrz L9

  // ─── System prompt agenta (M05) ───
  systemPrompt: {
    roleNoun: "Acceptance criteria",
    // defaultPredicate — deklaratywny filtr licznika (równość/przynależność po polach schematu):
    // licznik encji (agregat sidebara) liczy wylacznie AC aktywne, etykieta z labelPlural.
    defaultPredicate: { field: "status", in: ["active"] },
    mcpToolsLine: "ac-tools: analyze_ac_against_entities",  // OPCJONALNE — tylko custom serwer; blok <mcp> dla entity-tools komponuje HOST
    narrativeBlock: `
      Twórz AC gdy moduł lub feature ma observable behavior do sprawdzenia.
      Konwencja tagowania: AC modułu MNN → tag "mNN"; AC encji X → tag "entity-X";
      project-level AC → brak module/entity tagu, tylko klasyfikacyjne (security, breaking, perf, ...).
<before_change>      Jeśli AC dotyczy konkretnego endpointa/DTO/UI view, wypełnij pole verifies — M19 sprawdzi
      referential integrity i wykryje orphan'y. kind='edge-case' dla warunków brzegowych</before_change>
<after_change>      Jeśli podmiotem AC jest konkretna encja (endpoint, DTO, UI view, tabela, narzędzie MCP),
      wypełnij pole verifies — M19 sprawdzi referential integrity i wykryje orphan'y. AC o
      zachowaniu opisanym prozą modułu zostawia verifies puste: kontraktem jest wtedy title,
      moduł wyznacza tag mNN, a warstwę tag lNN (gdy jest). kind='edge-case' dla warunków brzegowych</after_change>
      (rare conditions, error paths); default 'requirement'. Preferuj status='deprecated'
      nad hard delete — zachowuje historię i referencje.
    `.trim(),
  },
};

// Bootstrap (entities/index.ts):
import { host } from "core/plugin-host";
host.registerEntityModule(acModule);
```

### [eoi2kf2k] c4s-plugin-ac > Domain & services (L2) > `verifies[]` — kolekcja referencji polimorficznych w schemacie


`verifies[]` jest **kolekcją wartościową** schematu logicznego o elementach `{ type, slug }` — **referencją polimorficzną**: typ encji-celu pochodzi z pola `type` elementu, a `slug` niesie flagę `ref` z politykami `onMissing: 'warn'` / `onDelete: 'leave-dangling'` (M13 <section_ref anchor="uuvadx9p"/>). Kolekcja deklaruje **tożsamość elementu** — `collection: { kind: 'value', identity: ['type', 'slug'] }` (M13 <section_ref anchor="jtrrt7k9"/>): para `(type, slug)` jest tym, po czym host dopasowuje elementy przy liczeniu delty. Konsekwencje:

- **propagacja rename** — rename sluga encji **dowolnego** typu przepisuje pasujące wpisy `verifies[]` generycznie, po flagach schematu, bez kodu per-typ (M19 <section_ref anchor="m19xentrn"/>);
- **delta po tożsamości, nie po indeksie** — przetasowanie `verifies[]` bez innych zmian daje `op: 'noop'`, bo dopasowanie idzie po zadeklarowanej parze `(type, slug)`, a nie po pozycji w tablicy. Kolejność w `verifies[]` nie niesie semantyki, więc jej zmiana nie kosztuje wpisu w delcie;
- **walidacja** — M19 reguła 9 (<inline_mention type="mcp-tool" slug="reference-tools-check-consistency"/>) rozpoznaje wpisy po tej samej deklaracji; soft warning, **NIE blokuje save** (polityka `onMissing: 'warn'` — autor naprawia warningiem, nie błędem). Kategorie:
  - niezarejestrowany typ encji (`ref.type ∉ host.listAvailable()`) → warning kategorii `unknown-type-verify`;
  - inactive plugin (`ref.type ∈ host.listAvailable() && ∉ host.listEntities()`) → warning kategorii `inactive-plugin-verify`;
  - missing slug (`type aktywny, slug nie istnieje`) → warning kategorii `missing-verify`.
<after_change>**Pusty `verifies[]` — kryterium weryfikujące prozę.** `verifies[]` wskazuje wyłącznie encje (`{ type, slug }`); sekcji strony nie wskaże. Kryterium, którego podmiotem jest zachowanie opisane prozą modułu — przebieg w czasie działania, reguła walidacji, proces — a nie kształt jednej encji, zostawia `verifies[]` puste i jest to stan poprawny, nie brak. Puste pole nie znaczy jednak „bez adresu”: takie kryterium weryfikuje się po treści, a umieszcza po tagach:
- **kontraktem jest `title`** — jedyne pole autorskie typu; weryfikacja sprawdza, że system robi to, co tytuł nazywa, i nie dociąga żadnej encji;
- **moduł** wyznacza tag modułu (`mNN`, `mNN-edge`, `mNN-edge-*`) — ten sam, który wpina kryterium w sekcję kryteriów modułu;
- **warstwę** wyznacza tag warstwy `lNN`, gdy kryterium go niesie; bez niego — ta sekcja warstwowa modułu, której dotyczy tytuł.
Kryterium, którego podmiotem **jest** encja — narzędzie MCP, ekran, tabela, endpoint, DTO — wskazuje ją w `verifies[]`; puste pole jest wtedy luką, nie wyborem.</after_change>


## Read r5: CONTEXT ac offset 1 limit 2

### [plugac01] c4s-plugin-ac > Koperta pakietu (L11)

<after_change>
> **Pakiet nie istnieje jeszcze w kodzie — ten opis wyprzedza implementację.** W `claude4spec/plugins` są dziś cztery pakiety (`c4s-plugin-api-contracts`, `c4s-plugin-database-tables`, `c4s-plugin-frontend-mockups`, `c4s-plugin-spreadsheets`); `c4s-plugin-ac` nie jest jednym z nich. Typ `ac` działa dziś jako typ rdzenia hosta. Wydzielenie do pakietu jest zadeklarowanym kierunkiem, nie stanem faktycznym.

**Pakiet:** `c4s-plugin-ac` · **Wkład:** `entities[]`: `ac` · `subagents[]`: `ac-audit` · **Status w kodzie:** NIE ISTNIEJE — opis wyprzedza implementację

Pakiet wniósłby do powierzchni hosta dwa rodzaje capability. Pierwszym jest wpis `contributes.entities` — typ `ac` — z pełnym slice'em: schematem logicznym (`title` z rozszerzonym `maxLength`, `kind`, `status`, kolekcja wartościowa `verifies[]`), wzorcem sluga i projekcją, którą host generuje sam. Po stronie backendu obsadza dwa sloty: `backend.service` z jedyną metodą domenową poza ścieżką CRUD (`AcAnalysisService` — semantyczny audyt LLM) oraz `backend.mcpServer`, w którym rejestruje **własny serwer MCP `ac-tools`** z jednym narzędziem <inline_mention type="mcp-tool" slug="ac-tools-analyze-ac-against-entities"/>. CRUD, trasy REST, rekord odczytu i snapshot/restore pochodzą z generacji hosta — pakiet ich nie wnosi. Drugim rodzajem capability jest wpis `contributes.subagents` — jedna definicja `ac-audit`, audytora spójności kryteriów w zadanym zakresie (<section_ref anchor="qi00udo2"/>).

Po stronie frontu pakiet obsadza wpis ELEMENTS w sidebarze (`frontend.sidebarTab` — ikona `CheckSquare`, label „Acceptance Criteria", order 5), własne trasy (`/acs`, `/acs/$slug`, `/acs/$slug/history`), trzy renderery encji (chip / card / row) oraz rozszerzenie edytora ze slashem `/ac`. Osobliwością tego pakietu wobec pozostałych jest pole `verifies[]` — **kolekcja referencji polimorficznych**, wskazujących na encję dowolnego zarejestrowanego typu. Pakiet konsumuje więc powierzchnię hosta w obie strony: nie tylko wnosi typ, ale też odczytuje shape'y typów cudzych — wyłącznie przez rdzeń odczytu i `host.listAvailable()`, bez wiedzy o konkretnych pluginach.

**Komu wydzielenie służy.** Utrzymującemu hosta — przez odchudzenie rdzenia. Dopóki `ac` jest typem rdzenia, drzewo `entities/` mieści dwa typy wbudowane bezpośrednie, a reguła jednej abstrakcji wyprowadza z tej liczby, ile jest legalnych miejsc literału nazwy typu (M13 <section_ref anchor="no8witqs"/>). Po wydzieleniu zostaje jeden typ: z rdzenia schodzi cały slice `ac` — trasy, renderery, serwis domenowy, serwer MCP i blok promptu — a przesłanka tamtej reguły staje się węższa, więc łatwiejsza do utrzymania. Nie jest to porządkowanie dla samego porządku: każdy typ trzymany w rdzeniu jest typem, którego nie da się odpiąć ani wymienić bez ruszania hosta.

**Co z powierzchni hosta wlicza się do `hostApiVersion` koperty.** Pięć pozycji — parytetem z `c4s-plugin-database-tables`, gdzie ta sama lista jest zapisana dla pakietu bez własnego backendu (<section_ref anchor="91vq520g"/>). (1) Kształty **slotów koperty**, które pakiet obsadza: `contributes.entities` i `contributes.subagents`. (2) **Deklaratywna część kontraktu danych**, na której stoi schemat logiczny — w szczególności kolekcja wartościowa `verifies[]` wraz z flagami referencyjnymi `ref` / `onMissing` / `onDelete` — oraz wyprowadzany z niej kontrakt serializacji L9. (3) **Sygnatury slotów renderujących** i panelu detalu. (4) **Sloty backendowe** `backend.service` i `backend.mcpServer` wraz z fasadowym typem `McpServerFactory` i sygnaturami budowniczej `createMcpServer` / `mcpTool`. (5) **Operacje encjowe rdzenia odczytu, wiązane przez `MountContext`** — koperta czyta nimi encje typów cudzych, w które celuje `verifies[]`, i dostaje rekord zserializowany, nie surowy wiersz tabeli projekcji (M39 <section_ref anchor="gz7q92lz"/>). **Wewnętrzne dla pakietu** — zmienne bez ruszania `hostApiVersion` — pozostają: `AcAnalysisService` i kształt jego werdyktu, remit subagenta `ac-audit`, treść bloku system-promptu oraz układ ekranu listy i panelu detalu.

</after_change>

### [fsu38c8q] c4s-plugin-ac > Koperta pakietu (L11) > Plugin manifest (`registerEntityModule`)

<after_change>
AC plugin to pojedyncza deklaracja (`EntityContribution` — authoring-shape, kanon M13 <section_ref anchor="z7l89jhf"/>) rejestrowana w bootstrap przez `registerEntityModule(acModule)`. CRUD, trasy i projekcję generuje host ze schematu logicznego; `backend` niesie **wyłącznie** metodę domenową (`AcAnalysisService`) i custom serwer `ac-tools` z <inline_mention type="mcp-tool" slug="ac-tools-analyze-ac-against-entities"/>.

```typescript
import type { EntityContribution } from "@inharness-ai/claude4spec/plugin-runtime";
import { CheckSquareIcon } from "lucide-react";

export const acModule: EntityContribution = {
  // ─── Tożsamość (płaska — EntityModuleManifest) ───
  type: "ac",
  label: "Acceptance Criterion",
  labelPlural: "Acceptance Criteria",
  displayOrder: 5,
  pathPrefix: "/api/acs",
  slugPattern: "ac-{truncate(slugify(title), 40)}",  // literał + slugify(title) + truncate; create-time only

  // ─── Dane — schemat logiczny (jedyne źródło kształtu; M13 L2-entity-composition) ───
  data: {
    schema: {
      // zarezerwowane pole każdego typu — dla `ac` JEDYNE pole autorskie na treść kryterium.
      // maxLength rozszerzony ponad domyślną hosta (200) — M13 L2-entity-composition.
      // Brak `computedDefault`: nie ma z czego wyprowadzać, więc `title` jest wymagany wprost.
      title:       { type: "string", required: true, maxLength: 500 },
      kind:        { type: "enum", values: ["requirement", "edge-case"], default: "requirement" },
      status:      { type: "enum", values: ["active", "deprecated"], default: "active" },
      verifies: {                               // kolekcja WARTOŚCIOWA — referencje polimorficzne
        collection: { kind: "value", identity: ["type", "slug"] },  // tożsamość elementu → delta po parze, nie po indeksie
        of: {
          type: { type: "string", required: true },   // typ encji-celu
          slug: {                                      // ref polimorficzny — typ celu z pola `type` elementu
            ref: "$type", onMissing: "warn", onDelete: "leave-dangling", required: true,
          },
        },
      },
    },
  },

  // ─── Backend (opcjonalny — WYŁĄCZNIE metody domenowe; CRUD generuje host) ───
  backend: {
    service: (ctx) => new AcAnalysisService(ctx),   // L2 — semantyczny audyt (poza ścieżką CRUD)
    mcpServer: (service, ctx) =>                    // L3 — CUSTOM tool only (CRUD żyje w entity-tools)
      createMcpServer({ name: "ac-tools", tools: [analyzeAcAgainstEntitiesTool(service, ctx)] }),
  },

  // ─── Frontend ───
  frontend: {
    routes: acRouteTree,                        // L5 — /acs, /acs/$slug, /acs/$slug/history
    sidebarTab: {
      icon: CheckSquareIcon,
      label: "Acceptance Criteria",
      order: 5,
      emptyState: "No AC yet. Create with /ac in the editor or chat.",
    },
    renderChip: AcChip,                         // L8 — `[AC]` badge + title (obcięty) + kind badge
    renderCard: AcCard,                         // L8 — full detail (single_element)
    renderRow: AcRow,                           // L8 — title + kind badge + tags
    detailPanel: AcDetail,                      // L5/L8 — entity detail page
    editorExtensions: [acSlashCommand],         // L8 — `/ac` extension
  },

  // ─── Serializacja (L9) ───
  // pola contentBearing: brak
  payloadVersion: 3,                            // v3: `text` i `description` znikają — treść żyje w `title`
  payloadUpgrades: [acV1ToV2, acV2ToV3],        // v1→2: title := truncate(text, 200)
                                                // v2→3: title := text; drop text; drop description
                                                //        ODMAWIA (nie obcina) gdy text > 500 — patrz L9

  // ─── System prompt agenta (M05) ───
  systemPrompt: {
    roleNoun: "Acceptance criteria",
    // defaultPredicate — deklaratywny filtr licznika (równość/przynależność po polach schematu):
    // licznik encji (agregat sidebara) liczy wylacznie AC aktywne, etykieta z labelPlural.
    defaultPredicate: { field: "status", in: ["active"] },
    mcpToolsLine: "ac-tools: analyze_ac_against_entities",  // OPCJONALNE — tylko custom serwer; blok <mcp> dla entity-tools komponuje HOST
    narrativeBlock: `
      Twórz AC gdy moduł lub feature ma observable behavior do sprawdzenia.
      Konwencja tagowania: AC modułu MNN → tag "mNN"; AC encji X → tag "entity-X";
      project-level AC → brak module/entity tagu, tylko klasyfikacyjne (security, breaking, perf, ...).
      Jeśli podmiotem AC jest konkretna encja (endpoint, DTO, UI view, tabela, narzędzie MCP),
      wypełnij pole verifies — M19 sprawdzi referential integrity i wykryje orphan'y. AC o
      zachowaniu opisanym prozą modułu zostawia verifies puste: kontraktem jest wtedy title,
      moduł wyznacza tag mNN, a warstwę tag lNN (gdy jest). kind='edge-case' dla warunków brzegowych
      (rare conditions, error paths); default 'requirement'. Preferuj status='deprecated'
      nad hard delete — zachowuje historię i referencje.
    `.trim(),
  },
};

// Bootstrap (entities/index.ts):
import { host } from "core/plugin-host";
host.registerEntityModule(acModule);
```
</after_change>


## Read r6: CONTEXT ac offset 5 limit 2

### [5f8l7spw] c4s-plugin-ac > Cel

<after_change>
AC to **observable behavior do sprawdzenia** — pojedyncze zdanie które reader może zweryfikować używając systemu. AC żyją niezależnie od modułów/encji i mogą wskazywać na konkretne encje przez pole `verifies` (referential integrity sprawdzane przez M19 reguła 9). Powiązanie AC z modułem / encją / cross-cutting feature realizowane przez tagi M18 — bez kolumn FK, bez junction tables. To czyni AC pierwszym-class encją w release-diff (M17): zmiany AC pojawiają się strukturalnie w `RawDelta.entities[]` (L2) oraz w jego self-contained projekcji `MCPReleaseDiff.entities[]` (L3 MCP) z `op: created/updated/deleted`. Brief workflow (M21) konsumuje MCP-shape i eksponuje zmienione AC bez specjalnego trybu w kontekście `brief`.

**Czemu encja, nie bullet listy w prozie:**

1. **Cytowanie cross-page** — `<inline_mention type="ac" slug="ac-email-required-before-login"/>` zamiast prozy "see acceptance criterion in M07".
2. **Cross-cutting klasyfikacja** — tag `security` zbiera AC ze wszystkich modułów; `<tagged_list type="ac" tags="security"/>` na stronie compliance.
3. **Versioning** — release-diff wykrywa zmienione/dodane/usunięte AC strukturalnie; M21 brief eksponuje to w sekcji "Changed acceptance criteria".
4. **Referential integrity** — `verifies[]` wskazuje konkretną encję; M19 reguła 9 wykrywa orphan'y gdy encja zostanie usunięta.
5. **System-wide export** — `c4s tagged_list type="ac"` (M11), `c4s-reader.list_entities type="ac" tags=…` (M12, transport nad `list_entities` rdzenia M39) — zewnętrzny agent (Claude Code w innym terminalu) czyta wszystkie AC jako strukturyzowany checklist DoD.
</after_change>

### [205ctsev] c4s-plugin-ac > Zależności specyficzne

<after_change>
| Moduł / Encja | Relacja |
| --- | --- |
| Plugin host (M13) | Aktywacja per projekt przez `config.entities`. AC plugin to `EntityModule` rejestrowany przez `registerEntityModule(acModule)` |
| M18 Tags | Powiązanie AC ↔ moduł / encja / klasyfikacja przez tagi (konwencje: `mNN`, `entity-{slug}`, klasyfikacyjne `security`/`compliance`/`breaking`/`perf`/`accessibility`). Bez junction tables po stronie AC |
| M19 References & Consistency | Reguła 9 (broken `verifies`), reguła 10 (entity bez AC coverage), reguła 11 (module bez AC) — czysta *referential integrity*, patrz <section_ref anchor="q91m4kgl"/>. Semantyczny audyt LLM (<inline_mention type="mcp-tool" slug="ac-tools-analyze-ac-against-entities"/> — czy treść AC pasuje do shape encji) **nie** jest w M19, lecz częścią tego slice'u AC (serwer `ac-tools`) — patrz "Domain & services (L2)" niżej |
| M17 Snapshots & Releases | AC uczestniczy w release'ach przez **wygenerowany** snapshot/restore oraz **wygenerowany** `EntityDiff` (L9 <section_ref anchor="l9snap001"/>). `RawDelta.entities[]` (L2) zawiera AC entries; `MCPReleaseDiff.entities[]` (L3 MCP) zawiera AC z `type: 'ac'` w `entityTypes` enum (<section_ref anchor="m17mcpdf"/>) — M21 brief workflow konsumuje MCP-shape bez specjalnego trybu |
| M21 Briefs | Agent w wątku `context_type='brief'` widzi zmienione AC w `MCPReleaseDiff` (L3 MCP projection — patrz <section_ref anchor="m17mcpdf"/>) jak każdą inną encję, z pełnym `before?` / `after?` `AcSnapshot` per zmienione AC w `MCPEntityDelta`. Generic entity inlining z `brief.md §B` działa out-of-the-box; **brief NIE drill-down'uje przez** `get_ac(slug)` (decyzja 0 self-contained — reguły domenowe typu `brief` w <section_ref anchor="m21bauth"/>) — porównuje dwa snapshoty bezpośrednio z diff'u. Opcjonalna kosmetyka w v2: dedykowana sekcja `## Changed acceptance criteria` z grouping per scope-tag |
| Encje rdzenia i typy wniesione przez pluginy | AC może wskazywać na konkretną encję przez `verifies: [{type, slug}]`. Bidirectional discovery: AC → encje przez `verifies`; encja → AC przez <inline_mention type="mcp-tool" slug="reference-tools-find-references"/> lub `list_acs({tags: ["entity-{slug}"]})` |
| M05 Chat & Agent | Agent tworzy/edytuje AC przez generyczny serwer `entity-tools` (CRUD); audyt semantyczny przez custom `ac-tools`. System prompt narrative block sugeruje konwencję tagowania (`mNN` dla modułu, `entity-{slug}` dla encji, plus klasyfikacyjne). Koperta wnosi ponadto subagenta `ac-audit` do rezolwera `subagentsFor()` (<section_ref anchor="sqtt3hox"/>) — jego `tools` przechodzi sanitizer (<section_ref anchor="hmz4m74c"/>), a `promptBody` jedzie w ramce hosta (<section_ref anchor="dbqwhkcw"/>); patrz <section_ref anchor="qi00udo2"/> |
| M33 Plugin Loader | Walidacja wkładu subagentowego przy fan-oucie: deterministyczny dedupe `name` (nazwy wbudowane zarezerwowane), `model` poza enumem `sonnet`\|`haiku` → odmowa wpisu, `maxTurns` ponad sufit 120 → obcięcie, `maxTurns` pominięty → domyślny budżet tur hosta — i to jest ścieżka, którą chodzi `ac-audit` (<section_ref anchor="it907gd0"/>) |

Boilerplate (M13 plugin host: mounting/deactivation/versioning; M18 tagi cross-cutting; M19 reference framework + slug rename sync; L1/L2/L3/L4/L5/L8/L9) — wniesione przez kontrakt pluginu lub konsumowane z hosta.

> **Co świadomie NIE jest częścią encji AC:**
>
> - **Edge cases jako osobna encja** — odrzucone. `kind: 'edge-case'` field jako intrinsic property AC (jak `method` w Endpoint). Edge case to wariant AC (warunek brzegowy / error path), nie inna kategoria z osobną tabelą.
> - **Open questions / decisions** — zostają w prozie modułu albo w `## Otwarte pytania` indeksu (<section_ref anchor="e6nqwep9"/>) jeśli żywe; M17 `RawDelta.notes[]` jeśli pojawi się tam (zakres przyszłego planu, nie tego).
> - `scope_kind` **/** `scope` **columns** — odrzucone, duplikowałyby M18. "Łączenie" AC z modułem/encją realizuje system tagów (konwencje `mNN`, `entity-{slug}`).
> - **Wymuszenie reguły "moduł LVS musi mieć AC" w schemie encji** — odrzucone. Reguła jakościowa zostaje w writing style M15 (`layered-vertical-slices`); M19 reguła 11 (config-flagged) ją operacjonalizuje. Otwarte pytanie #4 z <section_ref anchor="e6nqwep9"/> (M15 → entity registration per styl) **NIE** rozstrzygane przez tę encję.
</after_change>


## Read r7: CONTEXT ac offset 8 limit 1

### [3tr1sjuw] c4s-plugin-ac > Domain & services (L2)

<after_change></after_change>


## Read r8: CONTEXT ac offset 10 limit 1

### [eoi2kf2k] c4s-plugin-ac > Domain & services (L2) > `verifies[]` — kolekcja referencji polimorficznych w schemacie

<after_change>
`verifies[]` jest **kolekcją wartościową** schematu logicznego o elementach `{ type, slug }` — **referencją polimorficzną**: typ encji-celu pochodzi z pola `type` elementu, a `slug` niesie flagę `ref` z politykami `onMissing: 'warn'` / `onDelete: 'leave-dangling'` (M13 <section_ref anchor="uuvadx9p"/>). Kolekcja deklaruje **tożsamość elementu** — `collection: { kind: 'value', identity: ['type', 'slug'] }` (M13 <section_ref anchor="jtrrt7k9"/>): para `(type, slug)` jest tym, po czym host dopasowuje elementy przy liczeniu delty. Konsekwencje:

- **propagacja rename** — rename sluga encji **dowolnego** typu przepisuje pasujące wpisy `verifies[]` generycznie, po flagach schematu, bez kodu per-typ (M19 <section_ref anchor="m19xentrn"/>);
- **delta po tożsamości, nie po indeksie** — przetasowanie `verifies[]` bez innych zmian daje `op: 'noop'`, bo dopasowanie idzie po zadeklarowanej parze `(type, slug)`, a nie po pozycji w tablicy. Kolejność w `verifies[]` nie niesie semantyki, więc jej zmiana nie kosztuje wpisu w delcie;
- **walidacja** — M19 reguła 9 (<inline_mention type="mcp-tool" slug="reference-tools-check-consistency"/>) rozpoznaje wpisy po tej samej deklaracji; soft warning, **NIE blokuje save** (polityka `onMissing: 'warn'` — autor naprawia warningiem, nie błędem). Kategorie:
  - niezarejestrowany typ encji (`ref.type ∉ host.listAvailable()`) → warning kategorii `unknown-type-verify`;
  - inactive plugin (`ref.type ∈ host.listAvailable() && ∉ host.listEntities()`) → warning kategorii `inactive-plugin-verify`;
  - missing slug (`type aktywny, slug nie istnieje`) → warning kategorii `missing-verify`.


**Pusty `verifies[]` — kryterium weryfikujące prozę.** `verifies[]` wskazuje wyłącznie encje (`{ type, slug }`); sekcji strony nie wskaże. Kryterium, którego podmiotem jest zachowanie opisane prozą modułu — przebieg w czasie działania, reguła walidacji, proces — a nie kształt jednej encji, zostawia `verifies[]` puste i jest to stan poprawny, nie brak. Puste pole nie znaczy jednak „bez adresu”: takie kryterium weryfikuje się po treści, a umieszcza po tagach:

- **kontraktem jest `title`** — jedyne pole autorskie typu; weryfikacja sprawdza, że system robi to, co tytuł nazywa, i nie dociąga żadnej encji;
- **moduł** wyznacza tag modułu (`mNN`, `mNN-edge`, `mNN-edge-*`) — ten sam, który wpina kryterium w sekcję kryteriów modułu;
- **warstwę** wyznacza tag warstwy `lNN`, gdy kryterium go niesie; bez niego — ta sekcja warstwowa modułu, której dotyczy tytuł.

Kryterium, którego podmiotem **jest** encja — narzędzie MCP, ekran, tabela, endpoint, DTO — wskazuje ją w `verifies[]`; puste pole jest wtedy luką, nie wyborem.
</after_change>


## Criteria (ac, op create; verifies empty — checked against own title + unit pages per build override)

- `ac-gdy-kryterium-albo-encji-z-okna-nie-p` [edge-case, active] — Gdy kryterium albo encji z okna nie przypisują do modułu ani tagi, ani `verifies`, `workflows/brief-workflow.md` kieruje je do jednostki czytającej sekcję lub encję, której dotyczy, a w braku takiej — do jednostki ostatniej fali.

- `ac-load-skill-file-layered-vertical-slic-18` [requirement, active] — `load_skill_file('layered-vertical-slices', 'workflows/brief-workflow.md')` zwraca krok mapy, który wciąga każde aktywne kryterium `ac` i każdą encję utworzone albo zmienione w oknie, niezależnie od tego, czy wskazuje je sekcja zmieniona w oknie.

- `ac-load-skill-file-layered-vertical-slic-19` [requirement, active] — `load_skill_file('layered-vertical-slices', 'workflows/brief-workflow.md')` zwraca checklistę końcową wymagającą, by każdy slug kryterium i encji utworzony albo zmieniony w oknie stał w linii `Read:` dokładnie jednej jednostki.

