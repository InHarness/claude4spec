# Packet — unit m02-update-page-body
- window: 2.1.13 → 2.1.14 (delta)
- goal: Dosłowny tryb zapisu strony przyjmuje treść pod nową nazwą parametru, a do tego opcjonalny frontmatter, który zastępuje dotychczasowy w całości. Zapis działa jako „utwórz albo zastąp”: brakująca strona w znanym korzeniu powstaje, zamiast kończyć się błędem. Trasa REST zapisu strony renderuje ten tryb. Hash zwracany przez zapis jest liczony po wstrzyknięciu kotwic, więc kolejny zapis z tym hashem przechodzi. Usunięte są: dawna nazwa parametru treści i odmowa nieistniejącej strony w trybie dosłownym.
- layers touched: L3, L4
- entities: mcp-tool 1 (page-tools-update-page), endpoint 1 (put-api-pages), spreadsheet 1 (katalog-operacji-m02, per-entity: item katalog-operacji-m02#update_page changed)
- criteria: 7 ac (all active)
- jobs: none
- Not yet: none. Completes: none.
- Remove: legacy `content` param name of update_page literal mode (renamed `body`); NOT_FOUND refusal for missing page in known root in literal mode (now create-or-replace).

## Change (2.1.13→2.1.14) — m02-pages.md change offset 0 limit 1

### [gj2vdsjm] M02 — Pages > Domain > Warunki wyzwolenia kodów błędów

Pole `kody błędów` w katalogu operacji niesie same nazwy; przy jakim argumencie kod leci, jest wartością modułu:

- **`PAGE_CONFLICT`** (409, z `currentHash`) — zapis na cudzej wersji.
- **`PAGE_EXISTS`** (409) — kolizja ścieżki przy tworzeniu oraz zajęta ścieżka docelowa przy przeniesieniu.
<before_change>- **`NOT_FOUND`** — nieznana para `(rootId, relPath)`, z listą korzeni z fasadą w nawigacji błędu. Nieznany korzeń kanał agentowy zgłasza tym kodem, jako nieznaną parę; REST zgłasza go jako `404 ROOT_NOT_FOUND` (<section_ref anchor="l4rootseg"/>).
- **`INVALID_ARGUMENT`** — ścieżka poza rootem (`resolveSafe`); `update_page` bez `expectedHash`; `content` i `textEdits` podane naraz albo żadne z nich; dwa `find` o nakładających się dopasowaniach; `dropAnchors` z anchorem spoza zakresu dotkniętego — w trybie różnicowym nietkniętym przez żadne dopasowanie, w trybie `content` nieobecnym w indeksie tej strony; `move_page` ze ścieżką docelową w innym roocie niż źródłowa; odmowy składniowe tekstu nagłówka w zapisie sekcji idą pod tym samym kodem, a ich warunki należą do M06.</before_change>
<after_change>- **`NOT_FOUND`** — nieznana para `(rootId, relPath)`, z listą korzeni z fasadą w nawigacji błędu. Nieistniejąca strona w znanym korzeniu nie wyzwala go w `update_page` w trybie dosłownym — ten zapis jest create-or-replace i stronę tworzy. Nieznany korzeń kanał agentowy zgłasza tym kodem, jako nieznaną parę; REST zgłasza go jako `404 ROOT_NOT_FOUND` (<section_ref anchor="l4rootseg"/>).
- **`INVALID_ARGUMENT`** — ścieżka poza rootem (`resolveSafe`); `update_page` bez `expectedHash`; `body` i `textEdits` podane naraz albo żadne z nich; dwa `find` o nakładających się dopasowaniach; `dropAnchors` z anchorem spoza zakresu dotkniętego — w trybie różnicowym nietkniętym przez żadne dopasowanie, w trybie dosłownym (`body`) nieobecnym w indeksie tej strony; `move_page` ze ścieżką docelową w innym roocie niż źródłowa; odmowy składniowe tekstu nagłówka w zapisie sekcji idą pod tym samym kodem, a ich warunki należą do M06.</after_change>
- **`FIND_NOT_FOUND`** (400, klasa `INVALID_ARGUMENT`) — `find` bez trafienia; koperta niesie diagnozę normalizacyjną.
- **`MATCH_COUNT_MISMATCH`** (400, klasa `INVALID_ARGUMENT`) — liczba trafień różna od `expectedMatches`; koperta niesie liczbę faktyczną i pozycje jako anchor sekcji plus numer linii. Numer linii zostaje tu świadomie: anchor jest, ale sam nie wystarcza, bo trafień wewnątrz **jednej** sekcji bywa wiele i rozróżnia je dopiero linia — to drugi przypadek **Reguły adresowania** rdzenia odkrywania (M39 <section_ref anchor="n9qp5ja7"/>).
<before_change>- **`ANCHOR_LOSS`** (400) — w obu trybach: kotwica z referentami, która po zapisie znika z indeksu strony, a nie jest wymieniona w `dropAnchors`. W trybie różnicowym zakresem są dopasowane fragmenty, w trybie `content` cała strona (M06 <section_ref anchor="m06batch0"/>). Akcja zmiany nazwy nagłówka zapisu sekcji nie ma tu producenta: linia kotwicy zostaje nietknięta, więc z indeksu nie znika nic (M06 <section_ref anchor="s6h57wha"/>).</before_change>
<after_change>- **`ANCHOR_LOSS`** (400) — w obu trybach: kotwica z referentami, która po zapisie znika z indeksu strony, a nie jest wymieniona w `dropAnchors`. W trybie różnicowym zakresem są dopasowane fragmenty, w trybie dosłownym (`body`) cała strona (M06 <section_ref anchor="m06batch0"/>). Akcja zmiany nazwy nagłówka zapisu sekcji nie ma tu producenta: linia kotwicy zostaje nietknięta, więc z indeksu nie znika nic (M06 <section_ref anchor="s6h57wha"/>).</after_change>

Koperty obu kodów trybu różnicowego są wspólne z M06 — jedna taksonomia, jedno miejsce.

## Context at 2.1.14 — m02-pages.md offset 1 limit 3

### [487vmesk] M02 — Pages > Cel
<after_change>
Autor specyfikacji trzyma jej treść jako zwykłe pliki markdown na dysku i pracuje na nich zarówno z poziomu aplikacji, jak i poza nią — edytorem, agentem, gitem. Ten moduł odpowiada za odczyt i zapis tych plików, za drzewo nawigacji po nich, za odczyt opcjonalnego frontmatter oraz za to, żeby zmiana wprowadzona poza aplikacją dotarła do otwartego widoku, a zapis własny serwera nie był z nią mylony.

Nie interpretuje treści strony ponad składnię markdown: nie indeksuje sekcji, nie waliduje referencji i nie zna znaczenia osadzonych w prozie znaczników. Nie ma też własnego mechanizmu obserwacji dysku — deklaruje jedynie, które katalogi mają być obserwowane, i reaguje na to, co z nich przychodzi.
</after_change>

### [lzt9r2fu] M02 — Pages > Zależności
<after_change>
Moduł wnosi prymityw plikowy i rejestr korzeni, więc na zewnątrz sięga wyłącznie po to, czego prymityw nie ma sam z siebie: źródło konfiguracji korzeni, nadzór nad zmianą pliku, zakres projektu i widok dla stron, których nie renderuje edytor markdown.

<tagged_list type="module-dependency" tags="m02"/>
</after_change>

### [6o9jy3sm] M02 — Pages > Domain
<after_change>
Podsekcje niżej niosą to, o co żadna warstwa tego projektu nie pyta: rozwiązywanie drzewa i strony startowej, kontrakt frontmatteru, prymityw operacji plikowych, blokadę optymistyczną, własny tor wersjonowania plików oraz kształt rekordu, w którym strona i jej sekcje wychodzą do konsumenta zewnętrznego.

</after_change>

## Context at 2.1.14 — m02-pages.md offset 5 limit 3

### [jc82k6v6] M02 — Pages > Domain > Tworzenie strony a pusta treść
<after_change>
`content` w żądaniu tworzenia jest opcjonalny i jego brak **nie** daje pustej strony: trasa generuje wtedy domyślny szablon, więc żeby utworzyć stronę pustą, trzeba ją zaraz po utworzeniu nadpisać.
</after_change>

### [7orm2v10] M02 — Pages > Domain > Tryb różnicowy — co obejmuje zasięg stronowy
<after_change>
Kryterium wyboru między zasięgiem sekcyjnym a stronowym należy do M06 (<section_ref anchor="m06batch0"/>). Z M02 wynika, **czym ten zasięg jest**: zakresem dopasowania `find` jest pełna treść pliku, wraz z frontmatterem. Stąd zasięg stronowy obsługuje także cel leżący poza jakąkolwiek sekcją oraz stronę bez pojedynczego korzenia H1, której podział na poddrzewa nie pokrywa w całości.

Guard referencyjny działa na każdym korzeniu stron dokładnie tak jak w M06, z zakresem liczonym po **dopasowanych fragmentach**, nie po całej stronie — szersze brzmienie zdegenerowałoby się tu do tautologii i guard straciłby połowę działania (<section_ref anchor="v20a8y6o"/>).
</after_change>

### [gj2vdsjm] M02 — Pages > Domain > Warunki wyzwolenia kodów błędów
<after_change>
Pole `kody błędów` w katalogu operacji niesie same nazwy; przy jakim argumencie kod leci, jest wartością modułu:

- **`PAGE_CONFLICT`** (409, z `currentHash`) — zapis na cudzej wersji.
- **`PAGE_EXISTS`** (409) — kolizja ścieżki przy tworzeniu oraz zajęta ścieżka docelowa przy przeniesieniu.
- **`NOT_FOUND`** — nieznana para `(rootId, relPath)`, z listą korzeni z fasadą w nawigacji błędu. Nieistniejąca strona w znanym korzeniu nie wyzwala go w `update_page` w trybie dosłownym — ten zapis jest create-or-replace i stronę tworzy. Nieznany korzeń kanał agentowy zgłasza tym kodem, jako nieznaną parę; REST zgłasza go jako `404 ROOT_NOT_FOUND` (<section_ref anchor="l4rootseg"/>).
- **`INVALID_ARGUMENT`** — ścieżka poza rootem (`resolveSafe`); `update_page` bez `expectedHash`; `body` i `textEdits` podane naraz albo żadne z nich; dwa `find` o nakładających się dopasowaniach; `dropAnchors` z anchorem spoza zakresu dotkniętego — w trybie różnicowym nietkniętym przez żadne dopasowanie, w trybie dosłownym (`body`) nieobecnym w indeksie tej strony; `move_page` ze ścieżką docelową w innym roocie niż źródłowa; odmowy składniowe tekstu nagłówka w zapisie sekcji idą pod tym samym kodem, a ich warunki należą do M06.
- **`FIND_NOT_FOUND`** (400, klasa `INVALID_ARGUMENT`) — `find` bez trafienia; koperta niesie diagnozę normalizacyjną.
- **`MATCH_COUNT_MISMATCH`** (400, klasa `INVALID_ARGUMENT`) — liczba trafień różna od `expectedMatches`; koperta niesie liczbę faktyczną i pozycje jako anchor sekcji plus numer linii. Numer linii zostaje tu świadomie: anchor jest, ale sam nie wystarcza, bo trafień wewnątrz **jednej** sekcji bywa wiele i rozróżnia je dopiero linia — to drugi przypadek **Reguły adresowania** rdzenia odkrywania (M39 <section_ref anchor="n9qp5ja7"/>).
- **`ANCHOR_LOSS`** (400) — w obu trybach: kotwica z referentami, która po zapisie znika z indeksu strony, a nie jest wymieniona w `dropAnchors`. W trybie różnicowym zakresem są dopasowane fragmenty, w trybie dosłownym (`body`) cała strona (M06 <section_ref anchor="m06batch0"/>). Akcja zmiany nazwy nagłówka zapisu sekcji nie ma tu producenta: linia kotwicy zostaje nietknięta, więc z indeksu nie znika nic (M06 <section_ref anchor="s6h57wha"/>).

Koperty obu kodów trybu różnicowego są wspólne z M06 — jedna taksonomia, jedno miejsce.
</after_change>

## Context at 2.1.14 — m02-pages.md offset 12 limit 1

### [m02octconc] M02 — Pages > Domain > Optimistic concurrency on PUT (`expectedHash`)
<after_change>
`PUT /api/pages/:path` (i bratni <inline_mention type="endpoint" slug="put-api-artifacts-kind-path-content"/> z M21/M23) przyjmuje opcjonalne pole `expectedHash` w body — sha256 contentu znanego klientowi przed zapisem. Server liczy sha256 aktualnego contentu na dysku przed write i porownuje:

<single_element type="code-snippet" slug="page-write-optimistic-lock" caption="Sprawdzenie expectedHash przed zapisem strony"/>

**Zachowanie:**
- `expectedHash === undefined` → backward-compat: zapis bez sprawdzenia (legacy clients).
- `expectedHash === currentHash` → zapis OK, zwraca `{ newHash }`.
- `expectedHash !== currentHash` → 409 z body `{ code: 'PAGE_CONFLICT', currentHash, currentContent }`. Instancja edytora **strony** otwiera okno `page-resolve` (pole Okna, <section_ref anchor="oo81p8sj"/>). Ręcznego scalania nie ma. <todo comment="Zweryfikować gałęzie stronowego 409 wobec kodu — wywiedzione z M40, nie z obserwacji implementera"/>

**Artefakty (`brief`, `patch`) — banner, nie dialog:** dla artefaktów odpowiedź 409 (`BRIEF_CONFLICT` / `PATCH_CONFLICT`) **nie otwiera dialogu**. Instancja edytora artefaktu pokazuje inline banner z jedyną akcją „Reload"; nie ma „Override" ani ręcznego scalania i nic nie jest nadpisywane. Dialog `confirmDestructive` zostaje wyłącznie na ścieżce zmiany zewnętrznej pliku (M40 <section_ref anchor="j37qjvvh"/>).

**Forward-compat dla M21 brief — wyłącznie o obowiązkowości `expectedHash`:** brief zawsze wysyla `expectedHash` (mandatory w <inline_mention type="endpoint" slug="put-api-artifacts-kind-path-content"/> dla `:kind=brief`); pages na razie opcjonalnie. Po feedbacku z briefow rolloutujemy mandatory na pages w drugim podejsciu.

**Race-relacje z reakcjami na zmianę pliku:** mechanizm chroni przed agent vs user vs vim. M02 emituje `file:changed` po wykryciu external write na źródle `pages:<rootId>`; klient pobiera treść i hash ponownie (mapa w polu Stan, <section_ref anchor="ndzne920"/>). Drugi PUT z nieaktualnym `expectedHash` → 409, user widzi diff, decyduje.

**Hash payload:** sha256 hex (64 chars), liczony z `content` (frontmatter + body, byte-for-byte zgodnie z `FileSnapshotData.content` z M17). Źródłem hasha jest prymityw `MarkdownFileStore` (<section_ref anchor="gnxw0ua1"/>) — wspólny dla stron i artefaktów.
</after_change>

## Context at 2.1.14 — m02-pages.md offset 32 limit 2

### [o01s9mwl] M02 — Pages > Spec Operations (L3)
<after_change>
M02 jest rdzeniem-właścicielem **zapisu stron**. Read-side (`list_pages` / `get_page` / `search_pages`) należy do rdzenia odkrywania M39; M02 dostarcza mu prymityw odczytu i rejestr rootów, ale nie deklaruje tych wierszy. `get_page` M39 jest odczytem strukturalnym — kolekcją sekcji całej strony; surowy odczyt pliku należy do M02 i ma wyłącznie kanał REST, trasę edytora (<section_ref anchor="l4rootseg"/>).

Zapis strony jest **bezkontekstowy** i każdy wołający niesie go własnym guardem, więc żadne pole kanału nie potrzebuje `n/a` — cztery operacje mają pełny parytet czterech kanałów. Cztery operacje adresują korzenie z fasadą (<section_ref anchor="m02l13001"/>) w każdym kanale; dziedzina `rootId` nie zależy od kanału. Że agent pisze skille przez `update_skill_file`, wynika z promptu i opisu narzędzia M52 <section_ref anchor="hdkx97wq"/>, nie z odmowy tych operacji.

<single_element type="spreadsheet" slug="katalog-operacji-m02" caption="Cztery operacje zapisu strony w piętnastopolowym kształcie wiersza — pole reguł cytuje identyfikatory z M43, zamiast streszczać ich brzmienie"/>

Kontrakt wire renderowań agentowych — nazwy narzędzi, schematy wejścia, kształty zwrotek — niosą encje, zgodnie z regułą z <section_ref anchor="p3th8bt4"/>. Serwerem grupującym te renderowania jest `page-tools`; ta sama grupa niesie też <inline_mention type="mcp-tool" slug="page-tools-update-sections"/>, którego własność merytoryczna zostaje przy M06 (<section_ref anchor="m06mcp01"/>):

<tagged_list type="mcp-tool" tags="m02" filter="and"/>
</after_change>

### [jmh3f1fl] M02 — Pages > API (L4)
<after_change>
**Powierzchnia**

<tagged_list type="endpoint" tags="m02" filter="and"/>

**DTO**

<tagged_list type="dto" tags="m02" filter="and"/>

**Montowanie:** `własny router: /api/pages/:rootId` — strona jest plikiem na dysku, nie typem encji rejestrowanym w hoście pluginów (<section_ref anchor="xlx33i1v"/>), więc host nie generuje jej CRUD-u pod `pathPrefix`. Trasa odczytu `GET /api/pages/:rootId/*` jest w tym routerze własnym odczytem pliku dla edytora, nie renderowaniem operacji rdzenia odkrywania. Adresowanie segmentem przestrzeni opisuje <section_ref anchor="l4rootseg"/>. Tablica akordeonów sidebaru ma `własny router: /api/sidebar-accordions` — obejmuje wszystkie korzenie naraz, więc nie leży pod segmentem `:rootId`.

**Odstępstwa**

| Trasa | Od czego odstępstwo | Dlaczego |
|---|---|---|
| `GET /api/pages/:rootId` | `Koperta` | drzewo jedzie pod bespoke kluczem `tree` zamiast `data` — serwer i klient są na `tree` spójne |
| `POST /api/pages/:rootId/move`, `GET /api/pages/:rootId/search` | `Ścieżki` | ostatni segment jest czasownikiem stojącym na **kolekcji rootu**, a nie za splatem: `…/foo.md/move` byłoby nieodróżnialne od strony `move` leżącej w katalogu `foo.md` |
</after_change>

## Entities — mcp-tool
```json
[
 {
  "type": "mcp-tool",
  "slug": "page-tools-update-page",
  "name": "update_page",
  "op": "update",
  "before": {
   "slug": "page-tools-update-page",
   "title": "page-tools · update_page",
   "name": "update_page",
   "server": "page-tools",
   "description": "Write an existing specification page, addressed by `(rootId, path)`. You describe the new content in ONE of two ways, never both: literally via `content` (the complete new page), or differentially via `textEdits` (a list of literal find/replace substitutions applied to the current content). Giving both, or neither, is an error.\n\nWHICH SCOPE TO USE. For a punctual change inside a page that has a section index, prefer `update_sections` with the target section's anchor — the narrower scope lets your `find` be shorter and shrinks the space of accidental matches. Changing a heading's TEXT is no longer a reason to come here: `update_sections` carries a `rename` action that rewrites the heading line and keeps the anchor, whereas a `find` swallowing the anchor comment destroys it and needs `dropAnchors`. Reach for `textEdits` here when the target crosses sections, lies outside any section (frontmatter, the preamble before the first heading), or the page has no section index at all. Reach for `content` when you are rewriting the page wholesale.\n\nDIFFERENTIAL MODE. `find` matches BYTE FOR BYTE — no whitespace normalisation, no regular expressions; whitespace copied inexactly is the single most common reason a `find` misses. `expectedMatches` OMITTED MEANS EXACTLY ONE match — that default is invisible in the schema, so read it here: pass a number to require exactly that many, or `\"all\"` to replace every occurrence without declaring how many. All `find` patterns are counted against the content BEFORE the write, so the list declares a SET of substitutions, not a sequence: two matches may not overlap, and one may not sit inside another edit's range.\n\n`expectedHash` is REQUIRED in both modes. Renaming one thing across N pages is N calls, each with its own hash — there is no cross-page batch, because the hash guards one file.",
   "params": [
    {
     "description": "Page root id. Part of a page's identity — `(rootId, path)` — not a filter.",
     "name": "rootId",
     "required": true,
     "type": "string"
    },
    {
     "description": "Page path relative to the root, e.g. \"guides/auth.md\".",
     "name": "path",
     "required": true,
     "type": "string"
    },
    {
     "description": "LITERAL mode: the complete new content of the page, frontmatter included. Everything not present here is gone after the write. Mutually exclusive with `textEdits` — giving both, or neither, is INVALID_ARGUMENT.",
     "name": "content",
     "required": false,
     "type": "string"
    },
    {
     "description": "DIFFERENTIAL mode: `[{ find, replaceWith, expectedMatches? }]`, matched against the FULL file content INCLUDING frontmatter. `find` is literal, byte for byte. `expectedMatches` omitted means EXACTLY ONE match; a number means exactly that many; `\"all\"` means every occurrence. Zero matches → FIND_NOT_FOUND, whose envelope tells you how many times the pattern would have matched after whitespace normalisation. A count other than declared → MATCH_COUNT_MISMATCH, carrying the real count and each hit as section anchor + line number. Mutually exclusive with `content`.",
     "name": "textEdits",
     "required": false,
     "type": "TextEdit[]"
    },
    {
     "description": "sha256 of the full file as you last read it — the `hash` from get_page, from the get_page_outline envelope, or from your previous write. REQUIRED in both modes. Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT carrying the current hash, so you can refresh and retry instead of overwriting blind.",
     "name": "expectedHash",
     "required": true,
     "type": "string"
    },
    {
     "description": "BOTH modes. Anchors this call is allowed to destroy — needed when the write removes an `<!-- anchor: … -->` comment whose anchor is cited elsewhere; without them the write is refused with ANCHOR_LOSS listing who cites what. In DIFFERENTIAL mode every entry must sit inside a MATCHED fragment, not merely somewhere on the page. In LITERAL (`content`) mode the touched scope is the whole page, so every entry must be an anchor this page has now; an anchor you leave out of the new content and do not name here is refused if anything cites it. On a root with no section index the guard has no subject and this parameter is meaningless.",
     "name": "dropAnchors",
     "required": false,
     "type": "string[]"
    }
   ],
   "returns": "`{ hash, version, changedAnchors[], replacements? }` — nowy sha256, numer złapanej wersji strony, anchory dotknięte przez edycję oraz — w trybie różnicowym — liczba wykonanych podmian. Zserializowana strona nie wraca; wołający, który chce zobaczyć wynik, robi osobny odczyt.",
   "sampleReturn": null,
   "readOnlyHint": 0,
   "destructiveHint": 1,
   "idempotentHint": 0,
   "openWorldHint": 0,
   "logic": "Read-modify-write całego pliku przez adapter markdown prymitywu rekordu: zapis tłumi własne zdarzenie mountu i wykonuje łańcuch faz in-band, więc `hash` i `version` w zwrotce są stanem po osiadnięciu. Guard współbieżności jest częścią kontraktu operacji: serwer liczy sha256 aktualnej treści przed zapisem i odmawia, gdy różni się od `expectedHash`. W obu trybach działa guard referencyjny dziedziczony z edycji sekcji: przed zapisem liczone są anchory, które znikną z `section_index`; zakresem są w trybie różnicowym **dopasowane fragmenty**, w trybie `content` cała strona. Zapis w trybie `content`, którego nowa treść gubi anchor mający referentów, a niewymieniony w `dropAnchors`, jest odrzucany z `ANCHOR_LOSS`. Tryb dosłowny jest idempotentny po treści, różnicowy **nie** — powtórka kończy się `FIND_NOT_FOUND`. W obu każde wywołanie łapie wersję w `file_version`.",
   "tags": [
    "m02"
   ],
   "createdAt": "2026-08-20T13:16:18.063Z",
   "updatedAt": "2026-10-05T16:45:55.445Z"
  },
  "after": {
   "slug": "page-tools-update-page",
   "title": "page-tools · update_page",
   "name": "update_page",
   "server": "page-tools",
   "description": "Write a specification page, addressed by `(rootId, path)`. A literal write creates the page when it does not exist yet — this is the create-or-replace primitive. Describe the new content in ONE of two ways, never both: literally via `body` (the complete markdown, optionally with a `frontmatter` object beside it), or differentially via `textEdits` (literal find/replace substitutions applied to the current file). Giving both, or neither, is an error.\n\nWHICH SCOPE TO USE. For a punctual change inside a page with a section index, prefer `update_sections` with the target section's anchor — a shorter `find` and fewer accidental matches. To change a heading's TEXT use its `rename` action, which keeps the anchor; a `find` swallowing the anchor comment destroys it and needs `dropAnchors`. Reach for `textEdits` here when the target crosses sections, lies outside any section (frontmatter, the preamble before the first heading), or the page has no section index. Reach for `body` when rewriting the page wholesale.\n\nDIFFERENTIAL MODE. `find` matches BYTE FOR BYTE — no whitespace normalisation, no regular expressions; whitespace copied inexactly is the single most common reason a `find` misses. `expectedMatches` OMITTED MEANS EXACTLY ONE match — that default is invisible in the schema, so read it here: pass a number to require exactly that many, or `\"all\"` to replace every occurrence without declaring how many. All `find` patterns are counted against the content BEFORE the write, so the list declares a SET of substitutions, not a sequence: two matches may not overlap, and one may not sit inside another edit's range.\n\n`expectedHash` is REQUIRED in both modes. Renaming one thing across N pages is N calls, each with its own hash — there is no cross-page batch, because the hash guards one file.",
   "params": [
    {
     "name": "rootId",
     "type": "string",
     "required": true,
     "description": "Page root id. Part of a page's identity — `(rootId, path)` — not a filter."
    },
    {
     "name": "path",
     "type": "string",
     "required": true,
     "description": "Page path relative to the root, e.g. \"guides/auth.md\"."
    },
    {
     "name": "body",
     "type": "string",
     "required": false,
     "description": "LITERAL mode: the complete markdown — either the body alone, with the frontmatter sent beside it in `frontmatter`, or the whole file assembled from get_page (`frontmatter.raw`, preamble, then per item its anchor line, heading line and body) with `frontmatter` omitted. Everything not present here is gone after the write; a page that does not exist yet is created. Mutually exclusive with `textEdits` — giving both, or neither, is INVALID_ARGUMENT."
    },
    {
     "name": "frontmatter",
     "type": "object",
     "required": false,
     "description": "LITERAL mode only: replaces the page's frontmatter wholesale. Omit it to write a page without frontmatter, or when `body` already carries the whole file, frontmatter block included."
    },
    {
     "name": "textEdits",
     "type": "TextEdit[]",
     "required": false,
     "description": "DIFFERENTIAL mode: `[{ find, replaceWith, expectedMatches? }]`, matched against the FULL file content INCLUDING frontmatter. `find` is literal, byte for byte. `expectedMatches` omitted means EXACTLY ONE match; a number means exactly that many; `\"all\"` means every occurrence. Zero matches → FIND_NOT_FOUND, whose envelope tells you how many times the pattern would have matched after whitespace normalisation. A count other than declared → MATCH_COUNT_MISMATCH, carrying the real count and each hit as section anchor + line number. Mutually exclusive with `body`."
    },
    {
     "name": "expectedHash",
     "type": "string",
     "required": true,
     "description": "sha256 of the full file as you last read it — the `hash` from get_page, from the get_page_outline envelope, or from your previous write. REQUIRED in both modes. Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT carrying the current hash, so you can refresh and retry instead of overwriting blind."
    },
    {
     "name": "dropAnchors",
     "type": "string[]",
     "required": false,
     "description": "BOTH modes. Anchors this call is allowed to destroy — needed when the write removes an `<!-- anchor: … -->` comment whose anchor is cited elsewhere; without them the write is refused with ANCHOR_LOSS listing who cites what. In DIFFERENTIAL mode every entry must sit inside a MATCHED fragment, not merely somewhere on the page. In LITERAL (`body`) mode the touched scope is the whole page, so every entry must be an anchor this page has now; an anchor you leave out of the new content and do not name here is refused if anything cites it. On a root with no section index the guard has no subject and this parameter is meaningless."
    }
   ],
   "returns": "`{ hash, version, changedAnchors[], replacements? }` — nowy sha256, numer złapanej wersji strony, anchory dotknięte przez edycję oraz — w trybie różnicowym — liczba wykonanych podmian. Zserializowana strona nie wraca; wołający, który chce zobaczyć wynik, robi osobny odczyt.",
   "sampleReturn": null,
   "readOnlyHint": 0,
   "destructiveHint": 1,
   "idempotentHint": 0,
   "openWorldHint": 0,
   "logic": "Read-modify-write całego pliku przez adapter markdown prymitywu rekordu: zapis tłumi własne zdarzenie mountu i wykonuje łańcuch faz in-band, więc `hash` i `version` w zwrotce są stanem po osiadnięciu. Tryb dosłowny (`body` + opcjonalny `frontmatter`) to create-or-replace: brak strony nie jest błędem, zapis ją tworzy. Guard współbieżności: serwer liczy sha256 aktualnej treści i odmawia, gdy różni się od `expectedHash`. W obu trybach działa guard referencyjny z edycji sekcji: liczone są anchory, które znikną z `section_index`; zakresem są w trybie różnicowym **dopasowane fragmenty**, w dosłownym cała strona. Anchor z referentami, niewymieniony w `dropAnchors`, odrzuca zapis z `ANCHOR_LOSS`. Tryb dosłowny jest idempotentny po treści, różnicowy **nie** — powtórka kończy się `FIND_NOT_FOUND`. Każde wywołanie łapie wersję w `file_version`.",
   "tags": [
    "m02"
   ],
   "createdAt": "2026-08-20T13:16:18.063Z",
   "updatedAt": "2026-10-09T09:31:01.347Z"
  }
 }
]
```

## Entities — endpoint
```json
[
 {
  "type": "endpoint",
  "slug": "put-api-pages",
  "name": "PUT /api/pages/:rootId/*",
  "op": "update",
  "before": {
   "slug": "put-api-pages",
   "title": "PUT /api/pages/:rootId/*",
   "method": "PUT",
   "path": "/api/pages/:rootId/*",
   "summary": "Zapisz treść strony w roocie :rootId (auto-save z tiptap, splat = ścieżka względna)",
   "description": "Root-aware (L13): segment `:rootId` = przestrzeń stron, splat (`*`) = ścieżka pliku względem `dir` tego rootu; tożsamość pliku = `(rootId, relPath)`. Korzeń spoza korzeni z fasadą → `404 ROOT_NOT_FOUND`.\n\nZapis idzie przez prymityw rekordu, który **tłumi** zdarzenie źródła korzenia `:rootId` i wykonuje łańcuch faz synchronicznie, po czym trasa odpowiada. Etykietowanie własnego zapisu — dawne rozróżnienie `origin: \"server\"` od `\"external\"` po stronie watchera — przestało być mechanizmem zapisu strony: zapis własny tłumi swoje zdarzenie zamiast je etykietować, a watcher pozostaje wyzwalaczem tego samego łańcucha wyłącznie dla zmian spoza aplikacji. Debounce mountu nie dotyczy przez to zapisu własnego.\n\n`expectedHash` jest **wymagany**; niezgodność → `409 PAGE_CONFLICT` niosący `currentHash` i `currentContent`. Odpowiedź niesie stan **po osiadnięciu** — hash, wersję i osiadłą treść — bo hash policzony przed wstrzyknięciem kotwic byłby martwy w chwili wydania, a sam hash mówiłby wołającemu tylko tyle, że jego kopia jest nieaktualna, nie czym się różni.",
   "linkedDtos": [
    {
     "dto": "update-page-response",
     "relation": "response",
     "statusCode": 200
    }
   ],
   "tags": [
    "api",
    "m02"
   ],
   "createdAt": "2026-04-23T13:26:15.000Z",
   "updatedAt": "2026-10-05T21:23:09.717Z"
  },
  "after": {
   "slug": "put-api-pages",
   "title": "PUT /api/pages/:rootId/*",
   "method": "PUT",
   "path": "/api/pages/:rootId/*",
   "summary": "Zapisz stronę w roocie :rootId — utwórz albo zastąp (auto-save z tiptap, splat = ścieżka względna)",
   "description": "Root-aware (L13): segment `:rootId` = przestrzeń stron, splat (`*`) = ścieżka pliku względem `dir` tego rootu; tożsamość pliku = `(rootId, relPath)`. Korzeń spoza korzeni z fasadą → `404 ROOT_NOT_FOUND`.\n\nTrasa renderuje tryb dosłowny operacji `update_page`: ciało żądania niesie `body` (markdown) i opcjonalny obiekt `frontmatter`, który zastępuje frontmatter strony w całości. Zapis jest create-or-replace — brak strony pod `(rootId, relPath)` nie jest błędem, trasa ją tworzy.\n\nZapis idzie przez prymityw rekordu, który **tłumi** zdarzenie źródła korzenia `:rootId` i wykonuje łańcuch faz synchronicznie, po czym trasa odpowiada. Etykietowanie własnego zapisu — dawne rozróżnienie `origin: \"server\"` od `\"external\"` po stronie watchera — przestało być mechanizmem zapisu strony: zapis własny tłumi swoje zdarzenie zamiast je etykietować, a watcher pozostaje wyzwalaczem tego samego łańcucha wyłącznie dla zmian spoza aplikacji. Debounce mountu nie dotyczy przez to zapisu własnego.\n\n`expectedHash` jest **wymagany**; niezgodność → `409 PAGE_CONFLICT` niosący `currentHash` i `currentContent`. Odpowiedź niesie stan **po osiadnięciu** — hash, wersję i osiadłą treść — bo hash policzony przed wstrzyknięciem kotwic byłby martwy w chwili wydania, a sam hash mówiłby wołającemu tylko tyle, że jego kopia jest nieaktualna, nie czym się różni.",
   "linkedDtos": [
    {
     "dto": "update-page-response",
     "relation": "response",
     "statusCode": 200
    }
   ],
   "tags": [
    "api",
    "m02"
   ],
   "createdAt": "2026-04-23T13:26:15.000Z",
   "updatedAt": "2026-10-09T09:31:59.782Z"
  }
 }
]
```

## Entities — spreadsheet (per-entity; part built: every operation row, key nazwa; changed item in window: `update_page` row 3, cols 1 and 11)
```json
[
 {
  "type": "spreadsheet",
  "slug": "katalog-operacji-m02",
  "name": "Katalog operacji (M02)",
  "op": "update",
  "before": {
   "slug": "katalog-operacji-m02",
   "title": "Katalog operacji (M02)",
   "nRows": 5,
   "nCols": 15,
   "headerRow": 1,
   "headerCol": 0,
   "cells": [
    {
     "r": 1,
     "c": 1,
     "value": "nazwa"
    },
    {
     "r": 1,
     "c": 2,
     "value": "zasięg"
    },
    {
     "r": 1,
     "c": 3,
     "value": "mediacja"
    },
    {
     "r": 1,
     "c": 4,
     "value": "internal"
    },
    {
     "r": 1,
     "c": 5,
     "value": "cli"
    },
    {
     "r": 1,
     "c": 6,
     "value": "mcp"
    },
    {
     "r": 1,
     "c": 7,
     "value": "rest"
    },
    {
     "r": 1,
     "c": 8,
     "value": "efekty"
    },
    {
     "r": 1,
     "c": 9,
     "value": "idempotencja"
    },
    {
     "r": 1,
     "c": 10,
     "value": "adresowanie"
    },
    {
     "r": 1,
     "c": 11,
     "value": "opis treści"
    },
    {
     "r": 1,
     "c": 12,
     "value": "guard"
    },
    {
     "r": 1,
     "c": 13,
     "value": "krotność"
    },
    {
     "r": 1,
     "c": 14,
     "value": "reguły"
    },
    {
     "r": 1,
     "c": 15,
     "value": "kody błędów"
    },
    {
     "r": 2,
     "c": 1,
     "value": "`create_page` — utworzenie strony"
    },
    {
     "r": 2,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 2,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 2,
     "c": 9,
     "value": "`nie` — powtórka → `PAGE_EXISTS`"
    },
    {
     "r": 2,
     "c": 10,
     "value": "`(rootId, relPath)`"
    },
    {
     "r": 2,
     "c": 11,
     "value": "`dosłowny`"
    },
    {
     "r": 2,
     "c": 12,
     "value": "`n/d` — kolizja ścieżki jest guardem z natury aktu"
    },
    {
     "r": 2,
     "c": 13,
     "value": "`jedno-celowa` — tworzenie jest aktem pojedynczym, a wołający zakładający N stron i tak zna N ścieżek"
    },
    {
     "r": 2,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `operation-only-write`"
    },
    {
     "r": 2,
     "c": 15,
     "value": "`PAGE_EXISTS`, `INVALID_ARGUMENT`, `ROOT_NOT_WRITABLE`"
    },
    {
     "r": 3,
     "c": 1,
     "value": "`update_page` — nadpisanie treści"
    },
    {
     "r": 3,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 3,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 3,
     "c": 9,
     "value": "`warunkowa` — dosłownie tak (po treści), różnicowo nie (powtórka → `FIND_NOT_FOUND`)"
    },
    {
     "r": 3,
     "c": 10,
     "value": "`(rootId, relPath)`"
    },
    {
     "r": 3,
     "c": 11,
     "value": "`obydwa` — `content` albo `textEdits`, rozłącznie"
    },
    {
     "r": 3,
     "c": 12,
     "value": "`wymagany` — nadpisanie bez guardu kasuje cudzą zmianę cicho, a następny czytelnik widzi spójną stronę i nie ma jak się dowiedzieć, że czegoś w niej brakuje"
    },
    {
     "r": 3,
     "c": 13,
     "value": "`jedno-celowa` — `expectedHash` jest hashem pliku, więc batch po stronach mnożyłby guardy"
    },
    {
     "r": 3,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `destructive-declared`, `operation-only-write`, `literal-match`, `match-count-declared`, `edit-set-not-procedure`, `replacements-returned`, `diff-field-names`"
    },
    {
     "r": 3,
     "c": 15,
     "value": "`PAGE_CONFLICT`, `NOT_FOUND`, `INVALID_ARGUMENT`, `FIND_NOT_FOUND`, `MATCH_COUNT_MISMATCH`, `ANCHOR_LOSS`, `ROOT_NOT_WRITABLE`"
    },
    {
     "r": 4,
     "c": 1,
     "value": "`delete_page` — usunięcie strony"
    },
    {
     "r": 4,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 4,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 4,
     "c": 9,
     "value": "`tak` — powtórka → `NOT_FOUND`"
    },
    {
     "r": 4,
     "c": 10,
     "value": "`(rootId, relPath)`"
    },
    {
     "r": 4,
     "c": 11,
     "value": "`n/d`"
    },
    {
     "r": 4,
     "c": 12,
     "value": "`opcjonalny` — usunięcie jest widoczne natychmiast i odwracalne z osi wersji"
    },
    {
     "r": 4,
     "c": 13,
     "value": "`jedno-celowa` — usunięcie N stron jest rzadkie i nieodwracalne, więc pojedynczość jest hamulcem, nie kosztem"
    },
    {
     "r": 4,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `destructive-declared`, `operation-only-write`"
    },
    {
     "r": 4,
     "c": 15,
     "value": "`NOT_FOUND`, `INVALID_ARGUMENT`, `ROOT_NOT_WRITABLE`"
    },
    {
     "r": 5,
     "c": 1,
     "value": "`move_page` — zmiana `relPath` przy nietkniętej treści"
    },
    {
     "r": 5,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 5,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 5,
     "c": 9,
     "value": "`nie` — powtórka trafia w nieistniejące źródło → `NOT_FOUND`"
    },
    {
     "r": 5,
     "c": 10,
     "value": "para `(rootId, relPath)` → `(rootId, relPath')` w jednym roocie"
    },
    {
     "r": 5,
     "c": 11,
     "value": "`n/d` — treść nietknięta"
    },
    {
     "r": 5,
     "c": 12,
     "value": "`wymagany` — ten sam argument co przy `update_page`: zajęta ścieżka docelowa musi odmówić, nie nadpisać"
    },
    {
     "r": 5,
     "c": 13,
     "value": "`jedno-celowa` — ten sam argument co przy `update_page`; przeniesienie katalogu to N wywołań"
    },
    {
     "r": 5,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `destructive-declared`, `operation-only-write`"
    },
    {
     "r": 5,
     "c": 15,
     "value": "`PAGE_EXISTS`, `NOT_FOUND`, `INVALID_ARGUMENT`, `ROOT_NOT_WRITABLE`"
    }
   ],
   "tags": [
    "l3-katalog",
    "m02"
   ],
   "createdAt": "2026-09-13T19:17:52.230Z",
   "updatedAt": "2026-09-13T19:42:38.879Z"
  },
  "after": {
   "slug": "katalog-operacji-m02",
   "title": "Katalog operacji (M02)",
   "nRows": 5,
   "nCols": 15,
   "headerRow": 1,
   "headerCol": 0,
   "cells": [
    {
     "r": 1,
     "c": 1,
     "value": "nazwa"
    },
    {
     "r": 1,
     "c": 2,
     "value": "zasięg"
    },
    {
     "r": 1,
     "c": 3,
     "value": "mediacja"
    },
    {
     "r": 1,
     "c": 4,
     "value": "internal"
    },
    {
     "r": 1,
     "c": 5,
     "value": "cli"
    },
    {
     "r": 1,
     "c": 6,
     "value": "mcp"
    },
    {
     "r": 1,
     "c": 7,
     "value": "rest"
    },
    {
     "r": 1,
     "c": 8,
     "value": "efekty"
    },
    {
     "r": 1,
     "c": 9,
     "value": "idempotencja"
    },
    {
     "r": 1,
     "c": 10,
     "value": "adresowanie"
    },
    {
     "r": 1,
     "c": 11,
     "value": "opis treści"
    },
    {
     "r": 1,
     "c": 12,
     "value": "guard"
    },
    {
     "r": 1,
     "c": 13,
     "value": "krotność"
    },
    {
     "r": 1,
     "c": 14,
     "value": "reguły"
    },
    {
     "r": 1,
     "c": 15,
     "value": "kody błędów"
    },
    {
     "r": 2,
     "c": 1,
     "value": "`create_page` — utworzenie strony"
    },
    {
     "r": 2,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 2,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 2,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 2,
     "c": 9,
     "value": "`nie` — powtórka → `PAGE_EXISTS`"
    },
    {
     "r": 2,
     "c": 10,
     "value": "`(rootId, relPath)`"
    },
    {
     "r": 2,
     "c": 11,
     "value": "`dosłowny`"
    },
    {
     "r": 2,
     "c": 12,
     "value": "`n/d` — kolizja ścieżki jest guardem z natury aktu"
    },
    {
     "r": 2,
     "c": 13,
     "value": "`jedno-celowa` — tworzenie jest aktem pojedynczym, a wołający zakładający N stron i tak zna N ścieżek"
    },
    {
     "r": 2,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `operation-only-write`"
    },
    {
     "r": 2,
     "c": 15,
     "value": "`PAGE_EXISTS`, `INVALID_ARGUMENT`, `ROOT_NOT_WRITABLE`"
    },
    {
     "r": 3,
     "c": 1,
     "value": "`update_page` — zapis strony (utwórz albo zastąp)"
    },
    {
     "r": 3,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 3,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 3,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 3,
     "c": 9,
     "value": "`warunkowa` — dosłownie tak (po treści), różnicowo nie (powtórka → `FIND_NOT_FOUND`)"
    },
    {
     "r": 3,
     "c": 10,
     "value": "`(rootId, relPath)`"
    },
    {
     "r": 3,
     "c": 11,
     "value": "`obydwa` — `body` (z opcjonalnym `frontmatter`) albo `textEdits`, rozłącznie"
    },
    {
     "r": 3,
     "c": 12,
     "value": "`wymagany` — nadpisanie bez guardu kasuje cudzą zmianę cicho, a następny czytelnik widzi spójną stronę i nie ma jak się dowiedzieć, że czegoś w niej brakuje"
    },
    {
     "r": 3,
     "c": 13,
     "value": "`jedno-celowa` — `expectedHash` jest hashem pliku, więc batch po stronach mnożyłby guardy"
    },
    {
     "r": 3,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `destructive-declared`, `operation-only-write`, `literal-match`, `match-count-declared`, `edit-set-not-procedure`, `replacements-returned`, `diff-field-names`"
    },
    {
     "r": 3,
     "c": 15,
     "value": "`PAGE_CONFLICT`, `NOT_FOUND`, `INVALID_ARGUMENT`, `FIND_NOT_FOUND`, `MATCH_COUNT_MISMATCH`, `ANCHOR_LOSS`, `ROOT_NOT_WRITABLE`"
    },
    {
     "r": 4,
     "c": 1,
     "value": "`delete_page` — usunięcie strony"
    },
    {
     "r": 4,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 4,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 4,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 4,
     "c": 9,
     "value": "`tak` — powtórka → `NOT_FOUND`"
    },
    {
     "r": 4,
     "c": 10,
     "value": "`(rootId, relPath)`"
    },
    {
     "r": 4,
     "c": 11,
     "value": "`n/d`"
    },
    {
     "r": 4,
     "c": 12,
     "value": "`opcjonalny` — usunięcie jest widoczne natychmiast i odwracalne z osi wersji"
    },
    {
     "r": 4,
     "c": 13,
     "value": "`jedno-celowa` — usunięcie N stron jest rzadkie i nieodwracalne, więc pojedynczość jest hamulcem, nie kosztem"
    },
    {
     "r": 4,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `destructive-declared`, `operation-only-write`"
    },
    {
     "r": 4,
     "c": 15,
     "value": "`NOT_FOUND`, `INVALID_ARGUMENT`, `ROOT_NOT_WRITABLE`"
    },
    {
     "r": 5,
     "c": 1,
     "value": "`move_page` — zmiana `relPath` przy nietkniętej treści"
    },
    {
     "r": 5,
     "c": 2,
     "value": "`project`"
    },
    {
     "r": 5,
     "c": 3,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 4,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 5,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 6,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 7,
     "value": "`direct`"
    },
    {
     "r": 5,
     "c": 8,
     "value": "`plik`, `db`, `ui-notify`"
    },
    {
     "r": 5,
     "c": 9,
     "value": "`nie` — powtórka trafia w nieistniejące źródło → `NOT_FOUND`"
    },
    {
     "r": 5,
     "c": 10,
     "value": "para `(rootId, relPath)` → `(rootId, relPath')` w jednym roocie"
    },
    {
     "r": 5,
     "c": 11,
     "value": "`n/d` — treść nietknięta"
    },
    {
     "r": 5,
     "c": 12,
     "value": "`wymagany` — ten sam argument co przy `update_page`: zajęta ścieżka docelowa musi odmówić, nie nadpisać"
    },
    {
     "r": 5,
     "c": 13,
     "value": "`jedno-celowa` — ten sam argument co przy `update_page`; przeniesienie katalogu to N wywołań"
    },
    {
     "r": 5,
     "c": 14,
     "value": "`echo-free`, `error-code-once`, `destructive-declared`, `operation-only-write`"
    },
    {
     "r": 5,
     "c": 15,
     "value": "`PAGE_EXISTS`, `NOT_FOUND`, `INVALID_ARGUMENT`, `ROOT_NOT_WRITABLE`"
    }
   ],
   "tags": [
    "l3-katalog",
    "m02"
   ],
   "createdAt": "2026-09-13T19:17:52.230Z",
   "updatedAt": "2026-10-09T09:31:09.492Z"
  }
 }
]
```

## Entities — ac (criteria, 7)
```json
[
 {
  "type": "ac",
  "slug": "ac-content-i-textedits-w-update-page-sa",
  "name": "`body` i `textEdits` w `update_page` są rozłączne: dokładnie jeden z nich opisuje nową treść, a `expectedHash` jest wymagany w obu trybach.",
  "op": "update",
  "before": {
   "slug": "ac-content-i-textedits-w-update-page-sa",
   "title": "`content` i `textEdits` w `update_page` są rozłączne: dokładnie jeden z nich opisuje nową treść, a `expectedHash` jest wymagany w obu trybach.",
   "text": "`content` i `textEdits` w `update_page` są rozłączne: dokładnie jeden z nich opisuje nową treść, a `expectedHash` jest wymagany w obu trybach.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "type": "mcp-tool",
     "slug": "page-tools-update-page"
    }
   ],
   "description": null,
   "tags": [
    "m02"
   ],
   "createdAt": "2026-08-20T13:31:22.532Z",
   "updatedAt": "2026-08-20T13:31:22.532Z"
  },
  "after": {
   "slug": "ac-content-i-textedits-w-update-page-sa",
   "title": "`body` i `textEdits` w `update_page` są rozłączne: dokładnie jeden z nich opisuje nową treść, a `expectedHash` jest wymagany w obu trybach.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02"
   ],
   "createdAt": "2026-08-20T13:31:22.532Z",
   "updatedAt": "2026-10-09T09:31:43.567Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-textedits-gubiacy-anchor-majacy-refer",
  "name": "`textEdits` gubiący anchor mający referentów, bez wymienienia go w `dropAnchors` → `ANCHOR_LOSS` — tryb różnicowy podlega temu samemu guardowi referencyjnemu co tryb dosłowny (`body`).",
  "op": "update",
  "before": {
   "slug": "ac-textedits-gubiacy-anchor-majacy-refer",
   "title": "`textEdits` gubiący anchor mający referentów, bez wymienienia go w `dropAnchors` → `ANCHOR_LOSS` — tryb różnicowy dziedziczy guard referencyjny, którego tryb `content` nie ma.",
   "text": "`textEdits` gubiący anchor mający referentów, bez wymienienia go w `dropAnchors` → `ANCHOR_LOSS` — tryb różnicowy dziedziczy guard referencyjny, którego tryb `content` nie ma.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "type": "dto",
     "slug": "update-page-diff-request"
    },
    {
     "type": "mcp-tool",
     "slug": "page-tools-update-page"
    }
   ],
   "description": null,
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-08-20T13:31:22.539Z",
   "updatedAt": "2026-08-20T13:31:22.539Z"
  },
  "after": {
   "slug": "ac-textedits-gubiacy-anchor-majacy-refer",
   "title": "`textEdits` gubiący anchor mający referentów, bez wymienienia go w `dropAnchors` → `ANCHOR_LOSS` — tryb różnicowy podlega temu samemu guardowi referencyjnemu co tryb dosłowny (`body`).",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "slug": "update-page-diff-request",
     "type": "dto"
    },
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-08-20T13:31:22.539Z",
   "updatedAt": "2026-10-09T09:31:43.590Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-update-page-bez-content-i-bez-textedi",
  "name": "`update_page` bez `body` i bez `textEdits` → `INVALID_ARGUMENT` — operacja nie ma wtedy żadnego opisu nowej treści.",
  "op": "update",
  "before": {
   "slug": "ac-update-page-bez-content-i-bez-textedi",
   "title": "`update_page` bez `content` i bez `textEdits` → `INVALID_ARGUMENT` — operacja nie ma wtedy żadnego opisu nowej treści.",
   "text": "`update_page` bez `content` i bez `textEdits` → `INVALID_ARGUMENT` — operacja nie ma wtedy żadnego opisu nowej treści.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "type": "mcp-tool",
     "slug": "page-tools-update-page"
    }
   ],
   "description": null,
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-08-20T13:31:22.537Z",
   "updatedAt": "2026-08-20T13:31:22.537Z"
  },
  "after": {
   "slug": "ac-update-page-bez-content-i-bez-textedi",
   "title": "`update_page` bez `body` i bez `textEdits` → `INVALID_ARGUMENT` — operacja nie ma wtedy żadnego opisu nowej treści.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-08-20T13:31:22.537Z",
   "updatedAt": "2026-10-09T09:31:43.579Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-update-page-w-trybie-content-ktorego",
  "name": "`update_page` w trybie dosłownym (`body`), którego nowa treść gubi kotwicę mającą referentów, zapisuje stronę, gdy ta kotwica jest wymieniona w `dropAnchors`.",
  "op": "update",
  "before": {
   "slug": "ac-update-page-w-trybie-content-ktorego",
   "title": "`update_page` w trybie `content`, którego nowa treść gubi kotwicę mającą referentów, zapisuje stronę, gdy ta kotwica jest wymieniona w `dropAnchors`.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "type": "endpoint",
     "slug": "put-api-pages"
    },
    {
     "type": "mcp-tool",
     "slug": "page-tools-update-page"
    }
   ],
   "tags": [
    "m02"
   ],
   "createdAt": "2026-10-02T18:50:22.751Z",
   "updatedAt": "2026-10-02T18:50:22.751Z"
  },
  "after": {
   "slug": "ac-update-page-w-trybie-content-ktorego",
   "title": "`update_page` w trybie dosłownym (`body`), którego nowa treść gubi kotwicę mającą referentów, zapisuje stronę, gdy ta kotwica jest wymieniona w `dropAnchors`.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "slug": "put-api-pages",
     "type": "endpoint"
    },
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02"
   ],
   "createdAt": "2026-10-02T18:50:22.751Z",
   "updatedAt": "2026-10-09T09:31:43.585Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-update-page-w-trybie-content-na-rooci",
  "name": "`update_page` w trybie dosłownym (`body`) na korzeniu stron, którego nowa treść nie niesie kotwicy mającej referentów, odrzuca zapis kodem `ANCHOR_LOSS`.",
  "op": "update",
  "before": {
   "slug": "ac-update-page-w-trybie-content-na-rooci",
   "title": "`update_page` w trybie `content` na korzeniu stron, którego nowa treść nie niesie kotwicy mającej referentów, odrzuca zapis kodem `ANCHOR_LOSS`.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "slug": "put-api-pages",
     "type": "endpoint"
    },
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02"
   ],
   "createdAt": "2026-10-02T18:50:22.730Z",
   "updatedAt": "2026-10-05T15:23:21.913Z"
  },
  "after": {
   "slug": "ac-update-page-w-trybie-content-na-rooci",
   "title": "`update_page` w trybie dosłownym (`body`) na korzeniu stron, którego nowa treść nie niesie kotwicy mającej referentów, odrzuca zapis kodem `ANCHOR_LOSS`.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "slug": "put-api-pages",
     "type": "endpoint"
    },
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02"
   ],
   "createdAt": "2026-10-02T18:50:22.730Z",
   "updatedAt": "2026-10-09T09:31:43.588Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-update-page-z-content-i-textedits-pod",
  "name": "`update_page` z `body` i `textEdits` podanymi naraz → `INVALID_ARGUMENT`.",
  "op": "update",
  "before": {
   "slug": "ac-update-page-z-content-i-textedits-pod",
   "title": "`update_page` z `content` i `textEdits` podanymi naraz → `INVALID_ARGUMENT`.",
   "text": "`update_page` z `content` i `textEdits` podanymi naraz → `INVALID_ARGUMENT`.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "type": "mcp-tool",
     "slug": "page-tools-update-page"
    }
   ],
   "description": null,
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-08-20T13:31:22.536Z",
   "updatedAt": "2026-08-20T13:31:22.536Z"
  },
  "after": {
   "slug": "ac-update-page-z-content-i-textedits-pod",
   "title": "`update_page` z `body` i `textEdits` podanymi naraz → `INVALID_ARGUMENT`.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-08-20T13:31:22.536Z",
   "updatedAt": "2026-10-09T09:31:43.583Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-zapis-strony-wprowadzajacy-nowy-naglo",
  "name": "`hash` zwrócony przez zapis strony wprowadzający nowy nagłówek jest policzony **po** wstrzyknięciu kotwic przez indekser, więc kolejny zapis uzbrojony tą wartością przechodzi bez `PAGE_CONFLICT`.",
  "op": "update",
  "before": {
   "slug": "ac-zapis-strony-wprowadzajacy-nowy-naglo",
   "title": "Zapis strony wprowadzający nowy nagłówek zwraca `hash` policzony **przed** wstrzyknięciem kotwic przez indekser — kolejny zapis uzbrojony tą wartością kończy się `PAGE_CONFLICT`, choć strony nie ruszył nikt inny.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "type": "mcp-tool",
     "slug": "page-tools-update-page"
    },
    {
     "type": "mcp-tool",
     "slug": "page-tools-update-sections"
    }
   ],
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-09-09T07:21:27.543Z",
   "updatedAt": "2026-09-09T07:21:27.543Z"
  },
  "after": {
   "slug": "ac-zapis-strony-wprowadzajacy-nowy-naglo",
   "title": "`hash` zwrócony przez zapis strony wprowadzający nowy nagłówek jest policzony **po** wstrzyknięciu kotwic przez indekser, więc kolejny zapis uzbrojony tą wartością przechodzi bez `PAGE_CONFLICT`.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [
    {
     "slug": "page-tools-update-page",
     "type": "mcp-tool"
    },
    {
     "slug": "page-tools-update-sections",
     "type": "mcp-tool"
    }
   ],
   "tags": [
    "m02-edge"
   ],
   "createdAt": "2026-09-09T07:21:27.543Z",
   "updatedAt": "2026-10-09T09:35:05.118Z"
  }
 }
]
```

<!-- packet size bytes: 57068 -->
