# Packet — m06-zakres-kotwic
- window: 2.1.13 → 2.1.14 (delta), project app-spec / workspace default
- unit: m06-zakres-kotwic
- goal: Zakres poziomów nagłówków, którym injekcja kotwic nadaje kotwicę, zależy od tego, czy rodzaj korzenia wybrał indekser sekcji. Rodzaj z indekserem (korzenie stron) dostaje kotwice na wszystkich sześciu poziomach. Rodzaj z samą injekcją (plany) dostaje je tylko na poziomach 2–4. Ten sam zakres obowiązuje na ścieżce zapisu serwisu i przy write-backu z dysku.
- layers touched: L7 (File Change Reactions — m06-anchor-injection), L13 (root kinds: pages vs plans), M10 domain (plan anchors)
- entities: 3 ac; criteria: 3; jobs: none
- packet size: ~49338 bytes

## Change (2.1.13 → 2.1.14)

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > File Change Reactions (L7) (anchor `o8crf4hk`)

M06 deklaruje **dwie** definicje reakcji — jeden write-back i jedną projekcję. Obie są wybierane przez rodzaje korzeni: źródła montuje i reakcje wiąże implementor L13 (M02 <section_ref anchor="m02l13001"/>); M06 deklaruje definicje. Który rodzaj wybiera którą reakcję, stoi w deklaracjach rodzajów u ich właścicieli. Przemianowanie przestrzeni daje nowe źródło, z którym implementor ponownie wiąże obie reakcje po `id`.

| Pole | `m06-anchor-injection` | `m06-section-indexer` |
|---|---|---|
| **Źródło** | wybierana przez rodzaje (L13) | wybierana przez rodzaje (L13) |
| **Kontrakt przyjęcia** | `id` `m06-anchor-injection`; format: markdown, bez wymaganego kontraktu nagłówka; wymagania: brak; `rootId` na wejściu i w kluczu stanu `(rootId, path)` | `id` `m06-section-indexer`; format: markdown, bez wymaganego kontraktu nagłówka; wymagania: `m06-anchor-injection` na tym samym rodzaju (indeks jest kluczowany kotwicą) oraz `references = tak` (indekser buduje `section_entity_link`, trwałą część grafu referencji); `rootId` na wejściu i w kluczu stanu `(rootId, path)` |
| **Rodzaj reakcji** | `write-back` | `projekcja` |
| **Wyzwalacz** | `oba` — nagłówek dopisany z dysku i nagłówek dopisany operacją muszą dostać kotwicę tak samo | `oba` — zdarzenie z obserwowanego katalogu oraz łańcuch in-band zapisu własnego; reakcja nad treścią specyfikacji nie ma powodu widzieć tylko jednej drogi |
| **Kolejność** | faza `write-back` — przed `projekcja` i przed `capture` (M17), żeby indeks i snapshot widziały kotwice | niezależna (faza `projekcja`); kotwice nadała już `m06-anchor-injection` w fazie wcześniejszej |
| **Tryb store** | — | **hybrid SQLite-primary** — <inline_mention type="database-table" slug="section-index"/> + junction <inline_mention type="database-table" slug="section-entity-link"/>; zapytania wymagają joinów i filtrów, więc `byPath` Mapa nie występuje |
| **Wyzwalacz pełnej odbudowy** | — | `indexAll()` przy budowie `ProjectContext`; ten sam full pass po checkout brancha (M31) **oraz po przemianowaniu identyfikatora przestrzeni** — przełączenie rejestru nie zapisuje pliku, więc pełny przebieg jest jedyną drogą, którą adresy indeksu trafiają pod nowy `rootId` |
| **Query API** | — | **sibling** `SectionsService` nad tym samym SQLite (hybrid preferuje sibling — indexer-writer nie prowadzi projekcji zapytań) |
| **Parser** | — | parser sekcji M06 (<section_ref anchor="xvstp85z"/>) — nagłówki, kotwice i zakresy wykluczone, w tym regiony JSX — + wspólny parser znaczników XML `parseXmlTags()` (kontrakt — M51 <section_ref anchor="sjjkc8bt"/>) dla auto-linku encji (krok 8) |
| **Co pisze / `suppress`** | `<!-- anchor: … -->` przed nagłówkami bez anchora, tylko przed nagłówkami zwróconymi przez parser — nigdy wewnątrz bloku kodu; `suppress()` **przed** zapisem | — |
| **Event WS** | brak | `section:indexed { rootId, pagePath, anchors }`; po przemianowaniu przestrzeni payload niesie już nowy `rootId`; zmiana stanu świeżości — w obie strony — emituje dodatkowo `index:status-changed` (L4 <section_ref anchor="7xmafzkd"/>) |
| **Gotowość projektu** | — | **nie blokuje** — strona renderuje się bez gotowego `section_index`, więc `indexAll()` jest fire-and-forget |
| **Stan świeżości** | — | **zakres lokalny = jedna strona** (`(rootId, path)`); globalny = cały indeks sekcji wraz z junction encji. Nieudane przeliczenie oznacza **tę stronę** jako nieświeżą; odczyt i zapis jej sekcji kończy się `INDEX_STALE`, operacje na pozostałych stronach biegną bez zmian. Powrót: ponowny przebieg indeksera dla tej strony albo pełny `indexAll()`. Granularność stronowa nie jest wyborem wygody — przebieg indeksera i tak zastępuje zbiór wierszy dla jednego `(rootId, path)` (<section_ref anchor="efn44e96"/>), więc drobniejsze oznaczenie nie miałoby czego opisywać. Oznaczenie jest kluczowane `(rootId, path)`, więc przemianowanie przestrzeni nie przenosi go pod nowy adres — znika razem z kontekstem, a świeżość odtwarza pełny przebieg |

<before_change>**Injekcja kotwic planów — jedna definicja, dwa wyzwalacze (R7).** Rodzaj `plans` wybiera `m06-anchor-injection` (deklaracja rodzaju u M10), więc plik planu dostaje kotwice **tą samą definicją** co strona, wywoływaną hybrydowo:</before_change>
<after_change>**Injekcja kotwic planów — jedna definicja, dwa wyzwalacze (R7).** Rodzaj `plans` wybiera `m06-anchor-injection` (deklaracja rodzaju u M10), więc plik planu dostaje kotwice **tą samą definicją** co strona — z zakresem poziomów rodzaju z samą injekcją, czyli przed `##`, `###` i `####` (<section_ref anchor="v9zrytp8"/>) — wywoływaną hybrydowo:</after_change>

1. **synchronicznie w write-path** (`PlanService.update`, M10) — adresowanie sekcji planu anchorem musi widzieć anchory natychmiast po zapisie, bez okna debounce;
2. **przez wiązanie ze źródłem korzenia rodzaju `plans`** — dla zapisów zewnętrznych (agent lub user piszący plik planu z dysku).

**Zakres indeksowania nie zmienia się:** rodzaj `plans` nie wybiera `m06-section-indexer`, więc sekcje planu **nie wchodzą** do `section_index`, a `<section_ref/>` i discovery M39 nadal ich nie widzą. Injekcja kotwic ≠ indeksowanie sekcji; ewentualne indeksowanie planów — rodzaj `plans` wybierający `m06-section-indexer` — wymaga guardu z <section_ref anchor="efn44e96"/> (jednorazowy sweep kolizji) oraz `references = tak` i jest osobną decyzją.

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > File Change Reactions (L7) > Generacja i injekcja kotwic (anchor `v9zrytp8`)

<before_change>Reakcja `m06-anchor-injection` nadaje kotwice nagłówkom bez kotwicy — wyłącznie tym, które zwrócił parser sekcji (<section_ref anchor="xvstp85z"/>). **Reakcja nie zmienia wnętrza bloku kodu — ani dopisując, ani usuwając.**</before_change>
<after_change>Reakcja `m06-anchor-injection` nadaje kotwice nagłówkom bez kotwicy — wyłącznie tym, które zwrócił parser sekcji (<section_ref anchor="xvstp85z"/>), i wyłącznie z zakresu poziomów wynikającego z wyboru reakcji przez rodzaj (niżej). **Reakcja nie zmienia wnętrza bloku kodu — ani dopisując, ani usuwając.**</after_change>

<after_change>- **Zakres poziomów nagłówków wynika z wyboru reakcji przez rodzaj** — tak jak zasięg sprawdzenia zajętości i z tego samego powodu: kotwica powstaje tam, gdzie ktoś ją rozwiązuje. Na korzeniach rodzajów, które wybrały `m06-section-indexer`, kotwicę dostają nagłówki **wszystkich sześciu poziomów**, bo indekser indeksuje każdy z nich (<section_ref anchor="s2r014vw"/>), a `<section_ref/>` i odczyt sekcji muszą móc trafić w każdy. Na korzeniach rodzajów z samą injekcją kotwicę dostają wyłącznie nagłówki **`##`, `###` i `####`**: jedynym konsumentem takich kotwic jest adresowanie elementu paczki edycji w obrębie pliku (<section_ref anchor="anchnmsp"/>), więc reakcja nie znaczy tytułu pliku (`#`) ani szczegółów wewnątrz sekcji (`#####`, `######`). Zakres jest wspólny dla obu wyzwalaczy reakcji, a rozróżnienie czyta wybór `m06-section-indexer` przez rodzaj, nie nazwę rodzaju.</after_change>
- Wartość ośmioznakowa z alfabetu kotwicy (kontrakt generacji — <section_ref anchor="15u7sazr"/>).
- **Sprawdzenie zajętości** wygenerowanej wartości ma zasięg wynikający z wyboru reakcji przez rodzaj (<section_ref anchor="anchnmsp"/>): na korzeniach rodzajów, które wybrały `m06-section-indexer`, lookup jest globalny w `section_index` across korzeni tych rodzajów; na korzeniach rodzajów z samą injekcją — w obrębie pliku. W obu przypadkach wartość sprawdzana jest także wśród kotwic sparsowanych w tym przebiegu; przy trafieniu losowanie ponowne — kotwica wstrzyknięta automatycznie **nigdy** nie wprowadza duplikatu w swoim zasięgu.
- Injekcja w linii **przed** nagłówkiem zwróconym przez parser. Linia o kształcie nagłówka wewnątrz bloku kodu nie jest nagłówkiem, więc nigdy nie dostaje kotwicy.
- **Frontmatter-safe (D5, uniwersalny inwariant L13):** gdy nagłówek jest pierwszą treścią po bloku `---`, kotwica idzie **między** zamknięcie bloku a nagłówek i **nigdy** do jego wnętrza.
- Injekcja **tylko raz** — przy pierwszym przebiegu, który zastaje nowy nagłówek bez kotwicy.

### [pages/modules/m10-plans.md] M10 — Plans > Domain > Unikalnosc anchorow planu — zakres plan-lokalny (anchor `m10anchu`)

Anchor planu jest jedynym adresem, po ktorym element paczki `edits[]` trafia w sekcje (<section_ref anchor="m10dactn"/>), wiec duplikat wewnatrz **jednego pliku planu** czyni takie adresowanie niejednoznacznym. Zakres unikalnosci to **ten plik planu** — nie zbior wszystkich planow i nie `section_index` (reguła nadrzedna: M06 <section_ref anchor="anchnmsp"/>). Trzy mechanizmy, analogiczne do kontraktu kolizji stron:

1. **Zapobieganie przy generacji** — krok 2 pipeline'u, przed przypisaniem wygenerowanej wartosci, sprawdza jej zajetosc **wsrod anchorow juz obecnych w skladanej tresci tego planu** (istniejacych i wstrzyknietych w tym samym passie) i losuje ponownie przy trafieniu. Zajetosc anchorow stron ani innych planow **nie jest** sprawdzana — inny magazyn, inny zakres.
2. **Raport przy kolizji istniejacej** — duplikat moze wejsc do planu tylko sciezka omijajaca generacje (user paste w tiptap, agent podajacy `content` z gotowym anchorem). Wykrywany przy walidacji: element paczki adresujacy zdublowany anchor zwraca `AMBIGUOUS_ANCHOR`, a zapis loguje warning z lista zdublowanych wartosci. Duplikat **nie** blokuje zapisu planu — plan zapisuje sie zawsze, jak strona (soft validation, M06).
3. **Deterministyczna regula odczytu** — gdy duplikat juz jest, kazdy odczyt sekcji planu po anchorze bierze **pierwszy wystepujacy w pliku** (ta sama regula co w indexerze stron, M06 <section_ref anchor="3w9tn8jj"/>), zeby zachowanie nie zalezalo od kolejnosci passow.

Akcja `rename` kroku generacji w ogóle nie dotyka: przepisuje linię nagłówka, nad którą anchor już stoi, więc duplikatu wyprodukować nie może.

Rodzaj `plans` wybiera `m06-anchor-injection`, ale nie `m06-section-indexer` (<section_ref anchor="q1txzrf0"/>). Plany nie mają więc `section_index`, a zatem ani `<section_ref/>`, ani discovery M39 nie mogą w te kotwice trafić — są adresowalne wyłącznie wewnątrz paczki edycji planu.
<after_change>**Nagłówki bez kotwicy z założenia.** Nagłówki `#`, `#####` i `######` planu kotwic nie dostają (zakres poziomów — M06 <section_ref anchor="v9zrytp8"/>), więc element paczki nie adresuje ich jako własnych sekcji. `#####` i `######` leżą w poddrzewie najbliższej sekcji z kotwicą i są osiągalne przez jej `edit` albo `delete`; nagłówek `#` — wyłącznie przez wariant `content` całego planu.</after_change>

## Context at 2.1.14

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > Cel (anchor `1aq60bj4`)
<after_change>
Autor specyfikacji chce wskazać konkretny fragment strony — linkiem, z innej strony, z rozmowy z agentem — i chce, żeby to wskazanie przeżyło zmianę nagłówka, przeniesienie fragmentu i przebudowę pliku. Ten moduł nadaje każdemu nagłówkowi trwały identyfikator, wstawiany jeden raz i odtąd niezmienny, utrzymuje indeks fragmentów odświeżany automatycznie po każdym zapisie pliku, bez ręcznego wyzwalacza, oraz liczy odcisk treści zmieniający się wyłącznie przy zmianie znaczenia, nie formatowania. Tekst strony dzieli na fragmenty jedną czystą funkcją, którą wołają wszyscy konsumenci fragmentów, zamiast dzielić go każdy po swojemu.

Na tym się zatrzymuje. Nie interpretuje treści fragmentu, nie rozstrzyga, czy cokolwiek wskazanego istnieje, i nie wystawia własnego widoku — kto adresuje fragment i po co, należy do jego konsumentów.
</after_change>

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > Zależności (anchor `ko9x8zqw`)
<after_change>
Moduł wnosi wyłącznie znacznik sekcji i jego indeks, więc na zewnątrz sięga po źródła plików do obserwowania, zakres projektu i tożsamość, na której stoi złączenie sekcji z encją.

<tagged_list type="module-dependency" tags="m06"/>
</after_change>

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > Domain (anchor `pb7v6bmz`)
<after_change>
</after_change>

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > Domain > Anchor — stable section ID (anchor `wwnud9yz`)
<after_change>
Kotwica to komentarz HTML stojący w linii bezpośrednio przed nagłówkiem; kanoniczny kształt zapisu — wraz z przypadkiem pierwszego nagłówka po bloku frontmatter — niesie <inline_mention type="code-snippet" slug="kanoniczny-zapis-kotwicy-sekcji"/>.

- **HTML comment** — invisible w rendererze markdown, Tiptap, GitHub preview
- **Alfabet `[a-z0-9]`**, długość 6–12 znaków (kontrakt walidacji — patrz <section_ref anchor="15u7sazr"/> poniżej)
- **Generacja domyślna:** `nanoid(8)` — auto-inject przez reakcję `m06-anchor-injection` (<section_ref anchor="v9zrytp8"/>) wstawia 8-znakowy ID
- **Podaza za trescia** — move/reorder sekcji nie lamie referencji
- **Heading rename nie lamie niczego** — anchor jest niezalezny od tekstu naglowka
- **Jedno-razowa injekcja** — reakcja `m06-anchor-injection` wstawia anchor dla nowych headingow (write-back przez `MarkdownFileStore` z `suppress()`)
- **Frontmatter-safe (D5, uniwersalny inwariant L13)** — injekcja anchora **nigdy** nie modyfikuje bloku `---` frontmatter (dotyczy plików korzeni każdego rodzaju, który wybrał tę reakcję); anchor idzie przed heading, **poza** blokiem frontmatter. Dzięki temu wybór injekcji przez dowolny rodzaj z wpisami markdown jest bezpieczny
- **Globalnie unikalne na korzeniach rodzajów z indekserem sekcji (D7, L13)** — anchor jednoznacznie identyfikuje sekcję w całym projekcie, więc `<section_ref anchor=…/>` resolwuje się globalnie (bez scope korzenia); `section_index` niesie `rootId` wyłącznie do nawigacji. Na rodzajach z samą injekcją zakres jest lokalny w pliku (<section_ref anchor="anchnmsp"/>)
</after_change>

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > Domain > Zakres unikalności anchora — wynika z magazynu (anchor `anchnmsp`)
<after_change>
**Reguła nadrzędna:** zakres, w którym anchor musi być unikalny i w którym jest rozwiązywany, wynika z **magazynu, w którym anchor żyje** — nigdy z samej wartości anchora. Składnia (`[a-z0-9]{6,12}`) jest wspólna dla wszystkich magazynów i **nie** niesie informacji o magazynie; niesie ją kontekst wywołania.

| Magazyn | Zakres unikalności | Kto rozwiązuje |
|---------|--------------------|----------------|
| `section_index` (korzenie rodzajów z indekserem sekcji) | **globalny** na korzeniach wszystkich rodzajów, które wybrały `m06-section-indexer` (D7, L13) | `<section_ref anchor=…/>`, `@page.md#anchor` (M14), `check_consistency` reguła 8, `get_sections` / `find_references` (M39) |
| Plik planu (rodzaj `plans` — sama injekcja, zakres pliku) | **lokalny** — w obrębie tego jednego pliku planu | wyłącznie elementy paczki `update_plan({ edits })` (M10 <section_ref anchor="m10dactn"/>) |

**Dlaczego brak rozróżnienia składniowego (bez prefiksu, bez dodatkowego atrybutu):** żaden konsument nie rozwiązuje anchora bez wiedzy o magazynie. Rodzaj `plans` nie wybiera `m06-section-indexer`, więc plany nie wchodzą do `section_index` — `<section_ref/>` i discovery M39 **nie mogą** trafić w anchor planu (M39 adresuje wyłącznie korzenie `kind: pages`). W drugą stronę paczka edycji planu (cel kotwic planu — M10 <section_ref anchor="m10art36"/>) operuje na pliku planu wskazanym przez `chat_thread.plan_path`, więc nie widzi anchorów stron. Adnotacje planu wiążą się przez `page: '/plans/:slug'` + tekst, nie przez anchor (M10 <section_ref anchor="m10ucomm"/>). Kolizja **wartości** między magazynami jest zatem bez konsekwencji i nie wymaga ani wspólnego rejestru zajętości, ani odrębnej składni.

**Warunek przejścia (guard na przyszłość):** gdyby plany miały kiedyś stać się przeszukiwalne lub cytowalne ze stron spec (rodzaj `plans` wybierający `m06-section-indexer` albo `plan` jako EntityModule — M10 <section_ref anchor="m10ref00"/>), wchodzą tym samym pod **globalny** zakres tej tabeli i wymagają **jednorazowego sweepu kolizji** anchorów planów przeciw `section_index` przed przełączeniem. Do tego momentu żaden mechanizm cross-magazynowy nie jest potrzebny.
</after_change>

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > File Change Reactions (L7) (anchor `o8crf4hk`)
<after_change>
M06 deklaruje **dwie** definicje reakcji — jeden write-back i jedną projekcję. Obie są wybierane przez rodzaje korzeni: źródła montuje i reakcje wiąże implementor L13 (M02 <section_ref anchor="m02l13001"/>); M06 deklaruje definicje. Który rodzaj wybiera którą reakcję, stoi w deklaracjach rodzajów u ich właścicieli. Przemianowanie przestrzeni daje nowe źródło, z którym implementor ponownie wiąże obie reakcje po `id`.

| Pole | `m06-anchor-injection` | `m06-section-indexer` |
|---|---|---|
| **Źródło** | wybierana przez rodzaje (L13) | wybierana przez rodzaje (L13) |
| **Kontrakt przyjęcia** | `id` `m06-anchor-injection`; format: markdown, bez wymaganego kontraktu nagłówka; wymagania: brak; `rootId` na wejściu i w kluczu stanu `(rootId, path)` | `id` `m06-section-indexer`; format: markdown, bez wymaganego kontraktu nagłówka; wymagania: `m06-anchor-injection` na tym samym rodzaju (indeks jest kluczowany kotwicą) oraz `references = tak` (indekser buduje `section_entity_link`, trwałą część grafu referencji); `rootId` na wejściu i w kluczu stanu `(rootId, path)` |
| **Rodzaj reakcji** | `write-back` | `projekcja` |
| **Wyzwalacz** | `oba` — nagłówek dopisany z dysku i nagłówek dopisany operacją muszą dostać kotwicę tak samo | `oba` — zdarzenie z obserwowanego katalogu oraz łańcuch in-band zapisu własnego; reakcja nad treścią specyfikacji nie ma powodu widzieć tylko jednej drogi |
| **Kolejność** | faza `write-back` — przed `projekcja` i przed `capture` (M17), żeby indeks i snapshot widziały kotwice | niezależna (faza `projekcja`); kotwice nadała już `m06-anchor-injection` w fazie wcześniejszej |
| **Tryb store** | — | **hybrid SQLite-primary** — <inline_mention type="database-table" slug="section-index"/> + junction <inline_mention type="database-table" slug="section-entity-link"/>; zapytania wymagają joinów i filtrów, więc `byPath` Mapa nie występuje |
| **Wyzwalacz pełnej odbudowy** | — | `indexAll()` przy budowie `ProjectContext`; ten sam full pass po checkout brancha (M31) **oraz po przemianowaniu identyfikatora przestrzeni** — przełączenie rejestru nie zapisuje pliku, więc pełny przebieg jest jedyną drogą, którą adresy indeksu trafiają pod nowy `rootId` |
| **Query API** | — | **sibling** `SectionsService` nad tym samym SQLite (hybrid preferuje sibling — indexer-writer nie prowadzi projekcji zapytań) |
| **Parser** | — | parser sekcji M06 (<section_ref anchor="xvstp85z"/>) — nagłówki, kotwice i zakresy wykluczone, w tym regiony JSX — + wspólny parser znaczników XML `parseXmlTags()` (kontrakt — M51 <section_ref anchor="sjjkc8bt"/>) dla auto-linku encji (krok 8) |
| **Co pisze / `suppress`** | `<!-- anchor: … -->` przed nagłówkami bez anchora, tylko przed nagłówkami zwróconymi przez parser — nigdy wewnątrz bloku kodu; `suppress()` **przed** zapisem | — |
| **Event WS** | brak | `section:indexed { rootId, pagePath, anchors }`; po przemianowaniu przestrzeni payload niesie już nowy `rootId`; zmiana stanu świeżości — w obie strony — emituje dodatkowo `index:status-changed` (L4 <section_ref anchor="7xmafzkd"/>) |
| **Gotowość projektu** | — | **nie blokuje** — strona renderuje się bez gotowego `section_index`, więc `indexAll()` jest fire-and-forget |
| **Stan świeżości** | — | **zakres lokalny = jedna strona** (`(rootId, path)`); globalny = cały indeks sekcji wraz z junction encji. Nieudane przeliczenie oznacza **tę stronę** jako nieświeżą; odczyt i zapis jej sekcji kończy się `INDEX_STALE`, operacje na pozostałych stronach biegną bez zmian. Powrót: ponowny przebieg indeksera dla tej strony albo pełny `indexAll()`. Granularność stronowa nie jest wyborem wygody — przebieg indeksera i tak zastępuje zbiór wierszy dla jednego `(rootId, path)` (<section_ref anchor="efn44e96"/>), więc drobniejsze oznaczenie nie miałoby czego opisywać. Oznaczenie jest kluczowane `(rootId, path)`, więc przemianowanie przestrzeni nie przenosi go pod nowy adres — znika razem z kontekstem, a świeżość odtwarza pełny przebieg |

**Injekcja kotwic planów — jedna definicja, dwa wyzwalacze (R7).** Rodzaj `plans` wybiera `m06-anchor-injection` (deklaracja rodzaju u M10), więc plik planu dostaje kotwice **tą samą definicją** co strona — z zakresem poziomów rodzaju z samą injekcją, czyli przed `##`, `###` i `####` (<section_ref anchor="v9zrytp8"/>) — wywoływaną hybrydowo:

1. **synchronicznie w write-path** (`PlanService.update`, M10) — adresowanie sekcji planu anchorem musi widzieć anchory natychmiast po zapisie, bez okna debounce;
2. **przez wiązanie ze źródłem korzenia rodzaju `plans`** — dla zapisów zewnętrznych (agent lub user piszący plik planu z dysku).

**Zakres indeksowania nie zmienia się:** rodzaj `plans` nie wybiera `m06-section-indexer`, więc sekcje planu **nie wchodzą** do `section_index`, a `<section_ref/>` i discovery M39 nadal ich nie widzą. Injekcja kotwic ≠ indeksowanie sekcji; ewentualne indeksowanie planów — rodzaj `plans` wybierający `m06-section-indexer` — wymaga guardu z <section_ref anchor="efn44e96"/> (jednorazowy sweep kolizji) oraz `references = tak` i jest osobną decyzją.
</after_change>

### [pages/modules/m06-sections.md] M06 — Anchors & Section Index > File Change Reactions (L7) > Generacja i injekcja kotwic (anchor `v9zrytp8`)
<after_change>
Reakcja `m06-anchor-injection` nadaje kotwice nagłówkom bez kotwicy — wyłącznie tym, które zwrócił parser sekcji (<section_ref anchor="xvstp85z"/>), i wyłącznie z zakresu poziomów wynikającego z wyboru reakcji przez rodzaj (niżej). **Reakcja nie zmienia wnętrza bloku kodu — ani dopisując, ani usuwając.**

- **Zakres poziomów nagłówków wynika z wyboru reakcji przez rodzaj** — tak jak zasięg sprawdzenia zajętości i z tego samego powodu: kotwica powstaje tam, gdzie ktoś ją rozwiązuje. Na korzeniach rodzajów, które wybrały `m06-section-indexer`, kotwicę dostają nagłówki **wszystkich sześciu poziomów**, bo indekser indeksuje każdy z nich (<section_ref anchor="s2r014vw"/>), a `<section_ref/>` i odczyt sekcji muszą móc trafić w każdy. Na korzeniach rodzajów z samą injekcją kotwicę dostają wyłącznie nagłówki **`##`, `###` i `####`**: jedynym konsumentem takich kotwic jest adresowanie elementu paczki edycji w obrębie pliku (<section_ref anchor="anchnmsp"/>), więc reakcja nie znaczy tytułu pliku (`#`) ani szczegółów wewnątrz sekcji (`#####`, `######`). Zakres jest wspólny dla obu wyzwalaczy reakcji, a rozróżnienie czyta wybór `m06-section-indexer` przez rodzaj, nie nazwę rodzaju.
- Wartość ośmioznakowa z alfabetu kotwicy (kontrakt generacji — <section_ref anchor="15u7sazr"/>).
- **Sprawdzenie zajętości** wygenerowanej wartości ma zasięg wynikający z wyboru reakcji przez rodzaj (<section_ref anchor="anchnmsp"/>): na korzeniach rodzajów, które wybrały `m06-section-indexer`, lookup jest globalny w `section_index` across korzeni tych rodzajów; na korzeniach rodzajów z samą injekcją — w obrębie pliku. W obu przypadkach wartość sprawdzana jest także wśród kotwic sparsowanych w tym przebiegu; przy trafieniu losowanie ponowne — kotwica wstrzyknięta automatycznie **nigdy** nie wprowadza duplikatu w swoim zasięgu.
- Injekcja w linii **przed** nagłówkiem zwróconym przez parser. Linia o kształcie nagłówka wewnątrz bloku kodu nie jest nagłówkiem, więc nigdy nie dostaje kotwicy.
- **Frontmatter-safe (D5, uniwersalny inwariant L13):** gdy nagłówek jest pierwszą treścią po bloku `---`, kotwica idzie **między** zamknięcie bloku a nagłówek i **nigdy** do jego wnętrza.
- Injekcja **tylko raz** — przy pierwszym przebiegu, który zastaje nowy nagłówek bez kotwicy.
</after_change>

### [pages/modules/m10-plans.md] M10 — Plans > Cel (anchor `m10cel00`)
<after_change>
Użytkownik, zanim każe agentowi cokolwiek wykonać, chce zobaczyć zamiar na piśmie, skomentować go fragment po fragmencie i poprawić ręcznie — i dopiero wtedy uruchomić. Ten moduł daje temu zamiarowi trwałą postać: plik na dysku z własną stroną i historią wersji, który agent zapisuje zamiast wypisywać długą prozę w rozmowie, a użytkownik czyta, adnotuje i edytuje jak każdą inną stronę.

Zamiar nie należy do jednej rozmowy — może być dyskutowany w kilku równolegle, a wykonanie startuje albo w nowej, albo w bieżącej. Rozmowa nie jest jednak warunkiem jego powstania: kto zamiar ma już napisany, powołuje go jednym wywołaniem z zewnątrz, a wątek, w którym będzie omawiany, zakłada się wtedy razem z nim — jako skutek powołania, nie jego przesłanka. Czego nie ma, to zakładania planu ręcznie z listy. Moduł nie wnosi własnego wersjonowania ani własnego mechanizmu komentarzy — korzysta ze wspólnych.
</after_change>

### [pages/modules/m10-plans.md] M10 — Plans > Zależności (anchor `m10dep00`)
<after_change>
Plan jest artefaktem zbudowanym w całości z cudzej maszynerii — pliku na dysku, osi wersji i wspólnej generyki artefaktów — więc moduł wnosi do niego wyłącznie własny cykl życia.

<tagged_list type="module-dependency" tags="m10"/>
</after_change>

### [pages/modules/m10-plans.md] M10 — Plans > Domain > Unikalnosc anchorow planu — zakres plan-lokalny (anchor `m10anchu`)
<after_change>
Anchor planu jest jedynym adresem, po ktorym element paczki `edits[]` trafia w sekcje (<section_ref anchor="m10dactn"/>), wiec duplikat wewnatrz **jednego pliku planu** czyni takie adresowanie niejednoznacznym. Zakres unikalnosci to **ten plik planu** — nie zbior wszystkich planow i nie `section_index` (reguła nadrzedna: M06 <section_ref anchor="anchnmsp"/>). Trzy mechanizmy, analogiczne do kontraktu kolizji stron:

1. **Zapobieganie przy generacji** — krok 2 pipeline'u, przed przypisaniem wygenerowanej wartosci, sprawdza jej zajetosc **wsrod anchorow juz obecnych w skladanej tresci tego planu** (istniejacych i wstrzyknietych w tym samym passie) i losuje ponownie przy trafieniu. Zajetosc anchorow stron ani innych planow **nie jest** sprawdzana — inny magazyn, inny zakres.
2. **Raport przy kolizji istniejacej** — duplikat moze wejsc do planu tylko sciezka omijajaca generacje (user paste w tiptap, agent podajacy `content` z gotowym anchorem). Wykrywany przy walidacji: element paczki adresujacy zdublowany anchor zwraca `AMBIGUOUS_ANCHOR`, a zapis loguje warning z lista zdublowanych wartosci. Duplikat **nie** blokuje zapisu planu — plan zapisuje sie zawsze, jak strona (soft validation, M06).
3. **Deterministyczna regula odczytu** — gdy duplikat juz jest, kazdy odczyt sekcji planu po anchorze bierze **pierwszy wystepujacy w pliku** (ta sama regula co w indexerze stron, M06 <section_ref anchor="3w9tn8jj"/>), zeby zachowanie nie zalezalo od kolejnosci passow.

Akcja `rename` kroku generacji w ogóle nie dotyka: przepisuje linię nagłówka, nad którą anchor już stoi, więc duplikatu wyprodukować nie może.

Rodzaj `plans` wybiera `m06-anchor-injection`, ale nie `m06-section-indexer` (<section_ref anchor="q1txzrf0"/>). Plany nie mają więc `section_index`, a zatem ani `<section_ref/>`, ani discovery M39 nie mogą w te kotwice trafić — są adresowalne wyłącznie wewnątrz paczki edycji planu.


**Nagłówki bez kotwicy z założenia.** Nagłówki `#`, `#####` i `######` planu kotwic nie dostają (zakres poziomów — M06 <section_ref anchor="v9zrytp8"/>), więc element paczki nie adresuje ich jako własnych sekcji. `#####` i `######` leżą w poddrzewie najbliższej sekcji z kotwicą i są osiągalne przez jej `edit` albo `delete`; nagłówek `#` — wyłącznie przez wariant `content` całego planu.
</after_change>

### [pages/modules/m10-plans.md] M10 — Plans > Korzenie i rodzaje korzeni (L13) (anchor `vgopt1vq`)
<after_change>
Slice schema (`layers/L13-page-roots.md` <section_ref anchor="l13slice0"/>). Moduł wnosi rodzaj korzenia `plans` i jest zarazem konsumentem tego rodzaju: wszystko, co robi z plikiem planu, robi na korzeniu wziętym z rejestru po rodzaju.
</after_change>

### [pages/modules/m10-plans.md] M10 — Plans > Korzenie i rodzaje korzeni (L13) > Deklaracja rodzaju korzenia: `plans` (anchor `q1txzrf0`)
<after_change>
- **`kind`** — `plans`; rodzaj o jednym korzeniu, więc `id` korzenia = `plans`, identyfikator zastrzeżony.
- **źródło** — kod: dokładnie jeden korzeń.
- **`dir`** — stały `.claude4spec/plans`, poza plikiem konfiguracji.
- **sidebar** — `hidden`; plan ma własną listę i stronę (<section_ref anchor="m10ui000"/>).
- **mapa plików** (wygrywa pierwszy pasujący wzorzec):
  1. `*.md` → markdown; kontrakt zmian: pola nagłówka niezmienne `type` (= `plan`), `created_at`, `created_by` — **bez** pola `id`, bo tożsamość jest ścieżkowa, a slug niezmienny (<section_ref anchor="4tg2qv4h"/>); zmienne `title` oraz `applied` (boolean, domyślnie `false`) — jedyne pola dopuszczone do <inline_mention type="endpoint" slug="patch-api-artifacts-kind-path-frontmatter"/> (<section_ref anchor="m10appl0"/>); tor wersji `file_version`.
- **flagi** — `release` nie, `references` nie, `gitignore` tak, `agentDirectFs` nie.
- **reakcje** — `m06-anchor-injection`, `m02-frontmatter-indexer`, `m17-capture`, `m10-plan-updated`.

Rodzaj wybiera `m06-anchor-injection`, ale nie `m06-section-indexer`: kotwice planu służą wyłącznie adresowaniu sekcji w paczce `edits[]`, więc zasięgiem ich unikalności jest plik planu (<section_ref anchor="m10anchu"/>), a plan nie ma indeksu sekcji. Adnotacje wiążą się z planem przez `page: '/plans/:slug'` i tekst, nie przez kotwicę (<section_ref anchor="m10ucomm"/>).
</after_change>

## Criteria (ac, active, empty `verifies` — checked against own title and the pages above)

- `ac-na-korzeniu-rodzaju-ktory-wybral-m06` [active, tags ['m06']] — Na korzeniu rodzaju, który wybrał `m06-section-indexer`, injekcja kotwic nadaje kotwicę nagłówkowi `#####` bez kotwicy.
- `ac-naglowek-dopisany-do-planu-nie-dostaj-2` [active, tags ['m10']] — Nagłówek `#` dopisany do planu nie dostaje kotwicy.
- `ac-naglowek-dopisany-do-planu-nie-dostaj` [active, tags ['m10']] — Nagłówek `#####` dopisany do planu nie dostaje kotwicy.

## Conventions (L7, L13)

### [pages/layers/L7-file-change-reactions.md]  > L7 — File Change Reactions (anchor `gt9eelm9`)
<after_change>
Cross-cutting konwencja opisu **reakcji modułu na zapis pliku**. Warstwa nie enumeruje konsumentów — fiksuje kształt wiersza, którym moduł deklaruje: na jakim źródle reaguje, jakiego rodzaju jest ta reakcja, **który wyzwalacz ją odpala** i w jakiej kolejności biegnie.
</after_change>

### [pages/layers/L7-file-change-reactions.md] L7 — File Change Reactions > Cel (anchor `c872jd2a`)
<after_change>
Część danych specyfikacji jest w pełni wyprowadzalna z zawartości plików (pozycje `<todo/>`, indeks sekcji, encje w `.claude4spec/entities/`). Dla takich danych **source of truth pozostaje plik**, a projekcja w pamięci serwera lub w SQLite jest tylko przyspieszonym widokiem odbudowywanym przy aktywacji projektu i utrzymywanym przez reakcje na zmianę pliku. **Test odtwarzalności:** jeżeli usunięcie wpisu z bazy po restarcie serwera nic nie zmienia (bo i tak zostanie odtworzony z plików), dane nie należą do SQLite — należą do L7. Projekcja to jednak tylko jeden rodzaj reakcji; warstwa obejmuje również capture wersji, write-backi do obserwowanego katalogu, powiadomienia WS i przeładowania runtime.

**Zmiana pliku nie jest jedynym wyzwalaczem tych reakcji.** Ten sam łańcuch biegnie synchronicznie w ścieżce zapisu własnego aplikacji — wtedy zdarzenie plikowe jest stłumione, a łańcuch wykonuje prymityw zapisu — oraz asynchronicznie dla zapisu spoza aplikacji, wtedy z obserwowanego katalogu. Rodzaj reakcji, kolejność faz i kontrakt subskrybenta są w obu drogach identyczne; różni je wyłącznie to, kto woła. Dlatego wiersz deklaruje wyzwalacz jako osobne pole, a nie jako właściwość źródła.
</after_change>

### [pages/layers/L7-file-change-reactions.md] L7 — File Change Reactions > Role in the system (anchor `6qppsun2`)
<after_change>
L7 jest warstwą framework-shaped: jeden moduł dostarcza mechanizm, pozostałe deklarują swoje reakcje wg schematu poniżej.

`Implementor module:` **M40 — File Watch Runtime** (@modules/m40-file-watch-runtime.md)

Implementor jest jedynym wejściem do obserwowania plików w systemie: montowanie źródeł ze `scope`, `markOrigin`/`suppress`, rejestr definicji reakcji i ich wiązań, fazy i kolejność, broadcast WS. Moduł **nie konstruuje własnego watchera** — **deklaruje definicję reakcji**. Źródła korzeni rejestru montuje i wiąże z reakcjami implementor warstwy L13, a źródła spoza rejestru montuje i wiąże ich właściciel.

</after_change>

### [pages/layers/L7-file-change-reactions.md] L7 — File Change Reactions > Module slice schema (anchor `3nzulmvf`)
<after_change>
Moduł wypełnia **jeden wiersz per reakcja** (może mieć ich kilka). Każdemu wierszowi odpowiada dokładnie jedna **definicja reakcji** ze stabilnym `id` w runtime implementora; jedna definicja bywa związana z wieloma źródłami.

| Pole | Wymóg |
|---|---|
| **Źródło** | jeden z trzech wariantów. **Źródła korzeni rejestru** — wartość „wybierana przez rodzaje (L13)”; wiersz nie wymienia ani źródeł, ani rodzajów, bo wybór stoi w deklaracjach rodzajów korzeni. **Źródła spoza rejestru** — nazwa źródła (np. `plugins:base`, `plugins:overlay`) plus `scope: process \| context`; właściciel wiersza montuje źródło i wiąże reakcję sam. **Źródła korzeni rejestru wiązane przez implementora L13** — wartość „wiązana przez implementora L13 dla rodzajów z reduktorem `sidebar`”; dotyczy wyłącznie reakcji, którą implementor L13 wiąże ze źródłem każdego korzenia rodzaju deklarującego w polu `sidebar` reduktor, bez wpisu w liście `reakcje` deklaracji; wiersz nie wymienia ani źródeł, ani rodzajów, a rodzaj nie może tej reakcji wybrać ani wyłączyć |
| **Kontrakt przyjęcia** | wymagany w obu wariantach źródeł korzeni rejestru: stabilne `id`; akceptowane formaty wpisu mapy plików (`markdown` \| `json` \| `surowy`, z kontraktem, jeśli reakcja go wymaga) — reakcja działa wyłącznie na wpisach w tych formatach i pomija resztę plików źródła; wymagania (inne reakcje na tym samym rodzaju, flagi rodzaju); `rootId` na wejściu i w kluczu stanu `(rootId, path)` |
| **Rodzaj reakcji** | dokładnie jedno z zamkniętej taksonomii: `projekcja` \| `capture` \| `write-back` \| `powiadomienie` \| `reload` |
| **Wyzwalacz** | `watcher` \| `prymityw` \| `oba` — która droga dojścia odpala tę reakcję. `watcher`: wyłącznie zdarzenie z obserwowanego katalogu. `prymityw`: wyłącznie zapis własny wykonujący łańcuch in-band. `oba`: obie, i to jest wartość oczekiwana dla reakcji nad treścią specyfikacji — reakcja zawężona do jednej drogi deklaruje **dlaczego** druga jej nie dotyczy |
| **Bramka** | wyłącznie dla źródeł spoza rejestru: warunek montu albo wiązania **i jego właściciel** (np. „bramka zaufania do pakietów projektu”; „brak”). Źródła korzeni rejestru bramki nie mają — o tym, czy reakcja biegnie, decyduje wybór rodzaju |
| **Kolejność** | `after: [...]` (nazwa fazy albo stabilne `id` innej definicji, rozwiązywane per źródło; definicja niezwiązana z danym źródłem spełnia zależność) + faza własna, albo „niezależna” |
| **Dla `projekcja`** | **tryb store** — pure in-memory `Map` keyed `(rootId, relPath)` albo hybrid SQLite-primary; kryterium: jeżeli zapytania wymagają joinów / filtrów / paginacji wygodniejszych w SQL → hybrid, w przeciwnym razie → in-memory. **Wyzwalacz pełnej odbudowy** — `indexAll()` przy budowie `ProjectContext` oraz wyzwalacze zewnętrzne (np. przebudowa po zmianie HEAD repozytorium). **Właściciel query API** — sam indekser czy sibling czytający ten sam store. **Parser** — projekcja, która dzieli treść markdown na sekcje albo czyta z niej znaczniki XML, robi to **wyłącznie wspólnymi parserami systemu**, nigdy własnym skanem; wiersz modułu nazywa każdy użyty parser i wskazuje adres jego kontraktu, plus filtr, którym zawęża wynik. Projekcja, która nie czyta ani sekcji, ani znaczników, wpisuje, czym czyta treść. **Stan świeżości** — jak projekcja zostaje oznaczona jako **nieświeża**, gdy faza `projekcja` zawiodła po ponowieniu; jaki jest **zakres** oznaczenia (**globalny** — cała projekcja nie do użycia, albo **lokalny** — pojedynczy artefakt się nie przeliczył); **które operacje odczytu są wtedy odrzucane**; co przywraca stan świeży. Reguła jest **fail-closed**: odczyt biorący z projekcji współrzędne albo tożsamości, na podstawie których wołający potem pisze, zostaje **odrzucony**, a nie wykonany na stanie sprzed przeliczenia — cicha odpowiedź ze starych danych jest uszkodzeniem treści, nie nieświeżym widokiem |
| **Dla `write-back`** | co moduł pisze do obserwowanego katalogu + jawne wywołanie `suppress()` bezpośrednio przed zapisem |
| **Event WS** | `kind` + payload (`rootId` obowiązkowy dla źródeł korzeni rejestru; źródła spoza rejestru deklarują payload wg własnej domeny); albo „brak”. Co klient robi po otrzymaniu zdarzenia, nie należy do tego pola — to fakt konsumenta w jego sekcji UI |
| **Gotowość projektu** | czy pełna odbudowa blokuje aktywację `ProjectContext` (warstwa L10) — tak/nie + uzasadnienie |

**Reguła kompletności:** zbiór wierszy w sekcji modułu = zbiór jego definicji reakcji w runtime warstwy. Definicja jest **jedna niezależnie od liczby wyzwalaczy i źródeł**: wywołanie in-band nie jest drugą definicją, tylko drugą drogą dojścia do tej samej reakcji, więc reakcja dwuwyzwalaczowa to nadal jeden wiersz z wartością `oba` w polu wyzwalacza; wiązanie definicji z kolejnym źródłem też nie jest nowym wierszem. Reakcja bazowa o zmianie pliku, którą implementor warstwy L13 dokłada do każdego korzenia rejestru, nie jest wierszem wybieralnym — opisuje ją implementor L13 w how-mode. Moduł, który tylko *czyta* cudzą projekcję, nie ma wiersza — jego sekcja L7 to `— n/d` z jednolinijkowym uzasadnieniem.

**Wiersz właściciela prymitywu zapisu jest jedynym wyjątkiem od reguły powyżej.** Moduł, który *wykonuje* łańcuch zamiast w nim uczestniczyć, nie ma żadnej definicji reakcji, a mimo to jego sekcja L7 nie jest `— n/d`: czyta się ją w how-mode obok sekcji implementora warstwy i deklaruje ona sekwencję zapisu, punkt commitu, moment stłumienia zdarzenia oraz moment, w którym łańcuch uznaje się za osiadły. Tabela slice schema takiego wiersza nie mieści, bo wszystkie jej pola opisują reakcję.
</after_change>

### [pages/layers/L13-page-roots.md]  > L13 — Korzenie i rodzaje korzeni (anchor `l13top001`)
<after_change>
> Konwencja, w której moduł obsługujący pliki specyfikacji albo **wnosi rodzaj korzenia** — dopisuje wartość do enumu rodzajów i deklaruje jej mapę plików, flagi i reakcje L7 — albo deklaruje, **którą flagę lub który rodzaj czyta**, zamiast wskazywać katalog.

</after_change>

### [pages/layers/L13-page-roots.md] L13 — Korzenie i rodzaje korzeni > Role in the system (anchor `l13role01`)
<after_change>
L13 jest warstwą framework-shaped. Implementor:

- trzyma rejestr korzeni — korzenie z konfiguracji oraz korzenie zarejestrowane w kodzie;
- składa enum rodzajów z deklaracji modułów;
- rozstrzyga typ pliku z mapy rodzaju;
- egzekwuje flagi w jednym miejscu;
- montuje źródło zdarzeń każdego korzenia, podpina do niego reakcje L7 wybrane przez rodzaj, waliduje ich wymagania i dokłada reakcję bazową o zmianie pliku.

Warstwa nie definiuje transportu, routingu, wersjonowania ani indeksowania. Ustala wyłącznie kontrakt: **każde zachowanie per plik jest bramkowane flagą albo rodzajem korzenia, nigdy katalogiem ani identyfikatorem**.

</after_change>

### [pages/layers/L13-page-roots.md] L13 — Korzenie i rodzaje korzeni > Module slice schema (anchor `l13slice0`)
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
None to close (stubs.json has no entry with provider = this unit); none expected to open.

## Not yet
None.

## Completes
None.

## Remove
None (no op: delete, no lone <before_change> section).
