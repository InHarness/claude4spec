# Packet — m39-get-page-range

- window: 2.1.13 → 2.1.14 (delta)
- unit: m39-get-page-range
- goal: Odczyt całej strony w rdzeniu odmawia pozostawionego parametru okna linii błędem nieprawidłowego argumentu. Komunikat odmowy kieruje do konspektu strony, a potem do odczytu sekcji. Renderowania operacji (MCP i CLI) nie odrzucają już po drodze nieznanych kluczy, więc taki parametr dociera do rdzenia i zostaje odrzucony.
- layers touched: L2 (m39 domain), L3 (operation renderings: MCP), L14 (CLI rendering)
- entities: mcp-tool 2 (c4s-reader-get-page, reference-tools-get-page — both update)
- criteria: 3 (ac-get-page-wywolane-z-parametrem-range [create], ac-message-odmowy-get-page-z-parametrem [create], ac-get-page-zwraca-hash-liczony-z-pelneg [update])
- jobs: none
- Not yet: none · Completes: none · Remove: none (entity/criterion level; see before/after inside mcp-tool updates for removed fields)
- stubs to close: none · stubs.json empty
- packet size: see split result (packetBytes)

## Change — pages/modules/m39-discovery-core/L2-domain.md (change offset 1 limit 1)
```json
{
  "from": {
    "id": 24010,
    "name": "2.1.13"
  },
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 2
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m39-discovery-core/L2-domain.md",
      "op": "update",
      "sections": [
        {
          "kind": "section",
          "anchor": "984v8437",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)",
            "Strony i sekcje",
            "6. `get_page`"
          ],
          "heading": "Wznowienie odczytu",
          "content": "\n- **`get_page` nie ma okna linii.** Każdy adresowalny korzeń jest korzeniem `kind: pages` z indeksem sekcji (<section_ref anchor=\"03u16u7g\"/>), więc parametr zawężający odczyt do zakresu linii nie miałby żadnego poprawnego wywołania.\n- **Wznowienie odczytu ma jedną udokumentowaną ścieżkę:** `get_page_outline` → `get_sections` — po kotwicach itemów przyciętych, które wróciły w tej samej odpowiedzi razem z `hash`. Wznowienie idzie przez **strukturę dokumentu**, nie przez okno linii.\n<after_change>- **Pozostawiony `range` jest odmawiany, nie ignorowany.** Wołający z kontraktem sprzed usunięcia okna — klient MCP z zapamiętaną definicją narzędzia, skrypt wołający CLI z `--range` — wciąż może go wysłać. Zignorowanie odpowiedziałoby całą stroną wołającemu, który wierzy, że zawęził odczyt: zapłaciłby za treść, której nie zamawiał, i nic w zwrotce nie powiedziałoby mu, że jego parametr przepadł. Dlatego `range` w wejściu `get_page` kończy się `INVALID_ARGUMENT`, a `message` niesie ścieżkę naprawy z punktu wyżej — `get_page_outline`, potem `get_sections` (<section_ref anchor=\"7dad4wt0\"/>). Odmawia **rdzeń**; renderowanie operacji nie zrzuca nieznanego klucza po drodze, bo wtedy rdzeń nie miałby czego odmówić, a wołający dostałby właśnie tę cichą całą stronę.</after_change>"
        }
      ]
    }
  ]
}
```
## Context at 2.1.14 — L2-domain.md sections 43–48
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 83
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m39-discovery-core/L2-domain.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "llrqdo0o",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)",
            "Strony i sekcje"
          ],
          "heading": "6. `get_page`",
          "content": "<after_change>\n`(rootId, path)`. Odczyt **całej strony jako kolekcji sekcji**: koperta strony z frontmatterem i preambułą, a w niej płaska lista itemów kluczowanych kotwicą, w kolejności dokumentu. Bez `select` i bez wariantu anchorowego — do wskazanych sekcji prowadzi `get_sections`. Budżet obowiązkowy.\n\n**Kotwica jest kluczem itemu, nie komentarzem w treści** — z tego samego powodu, dla którego rozwinięcie poddrzewa w `get_sections` wydaje dziecko jako osobny item (<section_ref anchor=\"9sry9beb\"/>). Wołający, który chce zaadresować sekcję przeczytanej strony, nie wyparsowuje kotwicy z własnej zwrotki, a ucięcie budżetem wskazuje konkretne kotwice do dobrania. Strona wydana jako jeden tekst z liniami kotwic była dokładnie tym kształtem, który tamta reguła odrzuciła dla poddrzewa.\n\n**Źródłem jest plik, nie projekcja.** Strukturę liczy parser sekcji M06 (<section_ref anchor=\"xvstp85z\"/>) na bieżącej treści pliku, w tym samym odczycie co `hash`, więc item zgadza się z hashem, którym wołający potem pisze, a operacja pozostaje poza bramką świeżości (<section_ref anchor=\"l18ur90v\"/>).\n\n**Bez projekcji rozwiniętych osadzeń** — `body` jest surowe, tagi XML nietknięte. Rozwijanie to potrzeba renderu (M30, edytor), nie agenta: tag XML **jest** krawędzią, a rozwinięcie wkleja payload i kasuje krawędź. Treść surowa jest jednocześnie tańsza i bogatsza informacyjnie.\n\n**Plik bajt w bajt nie jest tą operacją.** Wydaje go edytorowi rekord strony M02 (<section_ref anchor=\"xlx33i1v\"/>) — to osobny odczyt, nie renderowanie `get_page`.\n</after_change>"
        },
        {
          "kind": "section",
          "anchor": "b61e5lbd",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)",
            "Strony i sekcje",
            "6. `get_page`"
          ],
          "heading": "Zwrotka i `hash`",
          "content": "<after_change>\n- **Koperta** — `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`. `rootId` i `path` wracają raz na wywołanie, nie w każdym itemie, bo dla jednego klucza są stałe — tak samo jak w outline'ie (pkt 4). **Bez `hasMore`, `total` i `limit`/`offset`:** odpowiedź kluczowana jednym zasobem nie deklaruje paginacji (<section_ref anchor=\"8suur17i\"/>), a ucięcie sygnalizują `truncated` przy itemach i `message` koperty (<section_ref anchor=\"avzm9pa5\"/>).\n- **`hash` jest liczony z pełnego pliku, nigdy ze zwróconego ładunku.** Sha256 całej treści strony (frontmatter + body, byte-for-byte — M02 <section_ref anchor=\"m02octconc\"/>), więc przy `truncated: true` **pozostaje ważny** jako `expectedHash` zapisu. Warunek musi stać w kontrakcie wprost, bo bez niego implementator ma prawo policzyć hash z ładunku, który akurat zmieścił się w budżecie, albo ze struktury złożonej z powrotem w tekst — i wołający dostałby guard, który nigdy nie przechodzi. Pole domyka pętlę odczyt→zapis: kopiuje się je wprost do `expectedHash` w `update_page` i `update_sections`. Tę samą wartość niesie rekord strony, który edytor czyta przez REST (M02 <section_ref anchor=\"xlx33i1v\"/>).\n</after_change>"
        },
        {
          "kind": "section",
          "anchor": "s8c7lww7",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)",
            "Strony i sekcje",
            "6. `get_page`"
          ],
          "heading": "Item, frontmatter i preambuła",
          "content": "<after_change>\n- **Item** — `{ anchor?, heading_text, heading_level, body, truncated? }`; `results` to lista **płaska, w kolejności dokumentu**. Pozycję w drzewie czyta się z `heading_level` i kolejności, jak przy rozwinięciu poddrzewa w `get_sections` (<section_ref anchor=\"9sry9beb\"/>), a sekcja nadrzędna niesie wyłącznie **ciało własne**, do pierwszego nagłówka dziecka. `body` **nie zawiera** linii kotwicy ani linii nagłówka — obie są już polami itemu — i poza nimi jest dosłownym wycinkiem pliku, więc `textEdits` zapisu dopasowuje się do niego literalnie.\n- **`anchor` bywa nieobecny** pod nagłówkiem, któremu indekser jeszcze nie wstrzyknął kotwicy (parser zwraca wtedy kotwicę `null` — M06 <section_ref anchor=\"o8qmucgr\"/>). Pole jest wtedy pominięte, nie `null`. Item bez `anchor` jest czytelny, ale nie jest adresowalny przez `get_sections`.\n- **`frontmatter`** — `{ raw, fields? }`. `raw` to dosłowny tekst bloku, potrzebny do `textEdits` zapisu; `fields` to klucze sparsowane z tego samego `raw` regułą M02 (<section_ref anchor=\"m02fmidx\"/>). Przy błędzie składni YAML `fields` jest nieobecne, a `raw` zostaje — to on jest drogą do naprawy. Strona bez frontmattera nie niesie tego pola.\n- **`preamble`** — tekst między frontmatterem a pierwszą sekcją (M06 <section_ref anchor=\"7fhe3ft7\"/>); nieobecna, gdy strona jej nie ma. Strona bez nagłówków daje `results: []` i samą `preamble`.\n- **Złożenie z powrotem.** Stronę przepisywaną w całości składa się ze struktury regułą serializacji M06 (<section_ref anchor=\"o8qmucgr\"/>); kotwice, których złożona treść już nie niesie, łapie guard utraty kotwicy w trybie dosłownym (`body`) (M06 <section_ref anchor=\"m06batch0\"/>).\n</after_change>"
        },
        {
          "kind": "section",
          "anchor": "984v8437",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)",
            "Strony i sekcje",
            "6. `get_page`"
          ],
          "heading": "Wznowienie odczytu",
          "content": "<after_change>\n- **`get_page` nie ma okna linii.** Każdy adresowalny korzeń jest korzeniem `kind: pages` z indeksem sekcji (<section_ref anchor=\"03u16u7g\"/>), więc parametr zawężający odczyt do zakresu linii nie miałby żadnego poprawnego wywołania.\n- **Wznowienie odczytu ma jedną udokumentowaną ścieżkę:** `get_page_outline` → `get_sections` — po kotwicach itemów przyciętych, które wróciły w tej samej odpowiedzi razem z `hash`. Wznowienie idzie przez **strukturę dokumentu**, nie przez okno linii.\n- **Pozostawiony `range` jest odmawiany, nie ignorowany.** Wołający z kontraktem sprzed usunięcia okna — klient MCP z zapamiętaną definicją narzędzia, skrypt wołający CLI z `--range` — wciąż może go wysłać. Zignorowanie odpowiedziałoby całą stroną wołającemu, który wierzy, że zawęził odczyt: zapłaciłby za treść, której nie zamawiał, i nic w zwrotce nie powiedziałoby mu, że jego parametr przepadł. Dlatego `range` w wejściu `get_page` kończy się `INVALID_ARGUMENT`, a `message` niesie ścieżkę naprawy z punktu wyżej — `get_page_outline`, potem `get_sections` (<section_ref anchor=\"7dad4wt0\"/>). Odmawia **rdzeń**; renderowanie operacji nie zrzuca nieznanego klucza po drodze, bo wtedy rdzeń nie miałby czego odmówić, a wołający dostałby właśnie tę cichą całą stronę.\n</after_change>"
        },
        {
          "kind": "section",
          "anchor": "avzm9pa5",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)",
            "Strony i sekcje",
            "6. `get_page`"
          ],
          "heading": "Ucięcie budżetem i `message`",
          "content": "<after_change>\n- **Wentylem jest sam budżet** (<section_ref anchor=\"8suur17i\"/>). Item, który nie mieści się w budżecie, zachowuje `anchor`, `heading_text` i `heading_level`, traci `body` i niesie `truncated: true` — nigdy nie jest pomijany (<section_ref anchor=\"b7dg3xq2\"/>). **Pierwszy item nie jest degradowany:** jego ciało wraca ucięte tekstowo z `truncated: true`, tak jak w `get_sections` (<section_ref anchor=\"m39budg01\"/>).\n- **Preambuła większa niż budżet wraca ucięta tekstowo** — koperta niesie `truncated: true`, a `message` mówi to wprost. Reszty nie da się dobrać żadną operacją odkrywania: preambuła nie jest sekcją, nie ma kotwicy, a `get_page` nie ma okna linii. Koszt jest nazwany wprost: agent nie przeczyta końca takiej preambuły.\n- **`message` koperty zamiast osobnego pola z podpowiedzią.** Osobne pole `truncationHint` było uzasadnione wyłącznie brakiem koperty per-item; odczyt całej strony ma ją teraz w kształcie `get_sections`, więc obie operacje dają jeden sygnał (`truncated` przy itemie) i jedną instrukcję (`message` koperty), a item nie niesie pola-bliźniaka (<section_ref anchor=\"sjalvz95\"/>).\n- **`message` ma jeden wariant** (zasada podpowiedzi — <section_ref anchor=\"0a5ziojd\"/>): wymienia kotwice itemów przyciętych, kieruje do `get_sections({ anchors })` i domyka ścieżkę wskazaniem `update_sections`, dla którego `hash` z koperty jest `expectedHash`em.\n\n<todo comment=\"Zachowanie frontmatter ponad budżetem w get_page nie jest rozstrzygnięte (D4 obejmuje itemy i preambułę) — do decyzji: cięcie raw, degradacja czy pierwsza pozycja jak w outline\"/>\n</after_change>"
        },
        {
          "kind": "section",
          "anchor": "0a5ziojd",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)",
            "Strony i sekcje",
            "6. `get_page`"
          ],
          "heading": "Zasada podpowiedzi",
          "content": "<after_change>\n- **Zasada ogólna: podpowiedź nigdy nie proponuje wywołania, które ta sama operacja odrzuci.** Tekst kierujący do parametru musi być bramkowany **tym samym warunkiem**, co walidacja tego parametru — inaczej agent wpada w pętlę „podpowiedź → `INVALID_ARGUMENT` → ta sama podpowiedź\", spalając kontekst na każdym obrocie.\n- **Wariant drugi tej samej zasady: podpowiedź nie kieruje do ścieżki, z której nie ma wyjścia na operację, po którą wołający przyszedł.** Pierwszy wariant pilnuje, żeby proponowane wywołanie nie zostało odrzucone; ten pilnuje, żeby **ciąg** wywołań się domykał. Ścieżka sekcyjna czytała stronę ponad budżetem tanio i poprawnie, po czym kończyła się ślepo — nie miała czym uzbroić guardu zapisu. Podpowiedź prowadząca do odczytu jest niepełna, dopóki nie prowadzi też do zapisu.\n\n</after_change>"
        }
      ]
    }
  ]
}
```
## Context at 2.1.14 — L2-domain.md section 82 (7dad4wt0)
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 83
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m39-discovery-core/L2-domain.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "7dad4wt0",
          "headingPath": [
            "M39 — Discovery Core: Domain (L2)",
            "Domain (L2)"
          ],
          "heading": "Taksonomia błędów",
          "content": "<after_change>\nRdzeń jest właścicielem katalogu kodów; format L2 `{ error, code }`. M11 (`CliErrorCode`) i M12 mapują kody rdzenia na swoje powierzchnie.\n\n| Kod | Znaczenie |\n|---|---|\n| `ENTITY_NOT_FOUND` | slug nieznany dla podanego typu; `message` niesie dostępne alternatywy |\n| `SECTION_NOT_FOUND` | anchor **nieznany**; `message` kieruje do szukania anchora (`search_pages`, `get_page_outline`) |\n| `PAGE_NOT_FOUND` | `(rootId, path)` nie istnieje; `message` niesie listę korzeni `kind: pages` |\n| `INVALID_TYPE` | typ nieznany lub nieaktywny; `message` niesie listę typów aktywnych |\n| `INVALID_ARGUMENT` | argument sprzeczny z kontraktem operacji; `message` **niesie właściwą ścieżkę**, nie tylko odmowę |\n| `AMBIGUOUS_*` | wejście wieloznaczne w danym reżimie tożsamości; `message` niesie kandydatów |\n| `INDEX_NOT_MATERIALIZED` | indeks nie zbudowany dla tego projektu (semantyka M29) |\n| `INDEX_STALE` | projekcja istnieje, ale została oznaczona jako nieświeża i nie opisuje już stanu plików; `message` niesie zakres oznaczenia i ścieżkę odbudowy |\n| `SEARCH_BUDGET_EXCEEDED` | przebieg wyszukiwania wyczerpał budżet czasu przed zakończeniem; `message` niesie wentyle zawężenia zakresu |\n\n**Nawigacja w błędzie jest wymiarem, nie uprzejmością:** każdy `NOT_FOUND` niesie alternatywy, każdy `INVALID_ARGUMENT` niesie ścieżkę naprawy.\n\n**`INDEX_STALE` jest osobnym kodem, choć katalog jest mały celowo — i przechodzi test, który katalog stawia każdemu kodowi.** Kryterium brzmi: czy kod prowadzi wołającego do innej decyzji niż sąsiad. `INDEX_NOT_MATERIALIZED` znaczy „projekcji nie ma\" i każe **odpuścić**; `INDEX_STALE` znaczy „projekcja jest, ale opisuje stan sprzed zmiany\" i każe **ponowić po odbudowie**. Przeciążenie jednego z nich obydwoma stanami zostawiłoby różnicę wyłącznie w `message`, czyli w miejscu, po którym klient się nie rozgałęzia — a tu rozgałęzienie jest całym pożytkiem z kodu. Cena — jeden wiersz churnu w M11 i M12 — jest zapłacona świadomie.\n\n**Katalog jest mały celowo.** Kod służy wołającemu do decyzji „retry czy odpuść\", więc własny kod dostaje wyłącznie stan, który prowadzi do innej decyzji niż sąsiad — różnica sama w nawigacji należy do `message`. Katalog jest mapowany 1:1 na `CliErrorCode` (M11) i M12, więc każdy nowy kod to churn w dwóch transportach. Decyzja jest zapisana, żeby nie wracała przy każdej implementacji.\n\n**Bariera wzorca mieści się w `INVALID_ARGUMENT`; wyczerpanie budżetu czasu — nie, i przechodzi ten sam test co `INDEX_STALE`.** Wzorzec ponad `MAX_PATTERN_CHARS` (<section_ref anchor=\"b7dg3xq2\"/>) jest wadą argumentu i prowadzi do decyzji sąsiadów: popraw wejście. Wyczerpanie `SEARCH_TIME_BUDGET_MS` — przeciwnie: argument był poprawny, a wołający ma zawęzić zakres i ponowić z **niezmienionym** wzorcem. Inne rozgałęzienie, nie inna treść `message`, więc kod własny.\n</after_change>"
        }
      ]
    }
  ]
}
```
## Context at 2.1.14 — m39-discovery-core.md sections 1–2
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 27
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m39-discovery-core/m39-discovery-core.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "xmxv4lpo",
          "headingPath": [
            "M39 — Discovery Core"
          ],
          "heading": "Cel",
          "content": "<after_change>\nAgent i wiersz poleceń potrzebują tych samych operacji odczytu specyfikacji: znaleźć punkt wejścia, zmierzyć rozmiar przed pobraniem, dostać treść sekcji, a nie same jej współrzędne. Ten moduł jest rdzeniem tych operacji — jednym miejscem, w którym mieszkają ich sygnatury, reżimy tożsamości, paginacja i taksonomia błędów, wspólnym dla każdego transportu, który je wystawia.\n\nRdzeń adresuje wyłącznie root i ścieżkę względną, więc nie ma jak sięgnąć poza obszar specyfikacji: guardrail przestaje być regułą promptu, a staje się brakiem adresu. Nie formatuje odpowiedzi pod żadnego odbiorcę, nie rozwiązuje projektu ani zestawu — dostaje je rozwiązane — i nie jest właścicielem cyklu życia indeksów, z których czyta. Nie jest też warstwą: nie każe nikomu wypełniać swojego schematu, ma zachowanie runtime, które transporty wołają.\n</after_change>"
        },
        {
          "kind": "section",
          "anchor": "yx7z9ivl",
          "headingPath": [
            "M39 — Discovery Core"
          ],
          "heading": "Zależności",
          "content": "<after_change>\nTen moduł jest rdzeniem operacji odczytu specyfikacji i sam niczego nie formatuje ani nie rozwiązuje — dane, krawędzie i kształt zwrotki bierze od modułów, które są ich właścicielami.\n\n<tagged_list type=\"module-dependency\" tags=\"m39\"/>\n</after_change>"
        }
      ]
    }
  ]
}
```
## Context at 2.1.14 — m39-discovery-core.md section 4
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 27
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m39-discovery-core/m39-discovery-core.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "p7wvdl8f",
          "headingPath": [
            "M39 — Discovery Core",
            "Domain"
          ],
          "heading": "Serializacja zwrotki — rdzeń jako jedyny wołający",
          "content": "<after_change>\nM39 nie jest typem encji i nie wnosi własnej serializacji — konsumuje generację rekordu odczytu, której właścicielem jest M13 (<section_ref anchor=\"l9fall001\"/>).\n\n**Operacje.** `get_entities`, `list_entities`, `search_entities` i `resolve_identity` delegują kształt zwrotki do `serialize(host, type, entity, reader)`; `describe_types` emituje schematy wyprowadzone ze schematu logicznego wraz z ograniczeniami pól, polami pod opieką i nazwami legalnymi dla `select` (<section_ref anchor=\"vaa90g0i\"/>); `overview` raportuje `count` + `payloadVersion` per aktywny typ, bez `schema`. **Rdzeń jest jedynym wołającym `serialize`** — transporty (M11, M12, serwery in-process) mapują operacje rdzenia na swój protokół i registry nie dotykają.\n\n**Rzut pól jest krokiem rdzenia.** `get_entities` bierze zserializowany rekord i **dopiero potem** stosuje `select` (<section_ref anchor=\"34gccznx\"/>): usuwa pola spoza rzutu, zostawia pola koperty i tożsamości i podmienia pola `contentBearing` na deskryptor z nazwą operacji wydającej treść. Kolejność jest wiążąca — najpierw serializacja, potem rzut, na końcu budżet. Odwrotna kolejność wymagałaby, żeby serializacja wiedziała o parametrze wołającego, czyli przeniosłaby wiedzę o transporcie do koperty typu. **Wąski wiersz operacji odkrywania to osobna rzecz od rzutu:** `list_entities` i `search_entities` emitują `{ slug, title }` ze stałego kontraktu i parametru `select` nie przyjmują wcale — `title` bierze się z zarezerwowanego pola schematu (M13 <section_ref anchor=\"eo2he5du\"/>), nie z per-typowego hardkodu etykiety.\n\n**Rdzeń nie formatuje encji sam** i nie iteruje po slotach manifestu ręcznie — kształt rekordu jest funkcją schematu logicznego typu (M13 <section_ref anchor=\"l9fall001\"/>). Sekcja (M06) jest w tym rejestrze zwykłym serializerem, mimo że **nie jest** typem encji — `get_sections` konsumuje go po rekord niosący ciało i krawędzie dokumentowe, raz per żądany anchor.\n\n**Pola pod opieką nie przechodzą przez żaden odczyt.** Pole z flagą `contentBearing` nie jest emitowane przez rekord (M13 <section_ref anchor=\"uuvadx9p\"/>) — treść wydaje wyłącznie generowana operacja po kluczu `(type, slug, field)` (<section_ref anchor=\"v0fldrd8\"/>). Rdzeń nie ma dla takiego pola ścieżki alternatywnej i żaden transport jej nie dostaje.\n\n**Mapowanie błędów.** Deaktywowany lub nieznany plugin → `host.getEntity(type)` zwraca `null` → `INVALID_TYPE`, spójnie z deactivation contract M13. `select` ze ścieżką kropkową, z `[]` albo z nazwą spoza schematu → `INVALID_ARGUMENT` z płaską listą legalnych nazw. To komplet: skoro typ nie wnosi kodu odczytu, nie ma trzeciego kodu, który mógłby z tej powierzchni wyjść.\n</after_change>"
        }
      ]
    }
  ]
}
```
## Entities — mcp-tool (change 2.1.13→2.1.14)
```json
{
  "from": {
    "id": 24010,
    "name": "2.1.13"
  },
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "entities": 2
  },
  "entities": [
    {
      "type": "mcp-tool",
      "slug": "c4s-reader-get-page",
      "name": "get_page",
      "op": "update",
      "before": {
        "slug": "c4s-reader-get-page",
        "title": "c4s-reader · get_page",
        "name": "get_page",
        "server": "c4s-reader",
        "description": "Get one whole page as a collection of sections. Requires the full page key: both `rootId` and `path`.\n\nA bare path is ambiguous across roots, so a call without `rootId` is refused with the list of roots rather than quietly falling back to a default root. Get the roots from `overview` and the paths from `list_pages`.\n\nThe answer carries the page `hash`, its `frontmatter` and `preamble`, and `results`: a flat list in document order with one item per section — its anchor, heading text, heading level and body. The anchor is a field of the item, so you never parse it out of text, and you can pass it straight to `get_sections`. A body holds neither the anchor line nor the heading line; a parent carries only its own body. An item under a heading that has no anchor yet comes without one.\n\n`frontmatter` gives the literal block (`raw`) and its parsed keys (`fields`); the keys are missing when the YAML does not parse, and `raw` is then the way to repair it.\n\nThe structure is read from the file, not from the index, so this call still answers when `get_page_outline` and `get_sections` refuse because the index is stale. `hash` is the sha256 of the whole file and works as `expectedHash` on a write even when the answer was cut.\n\nThe tool never expands embeds: an embedded entity's data is fetched separately with `get_entities`, using the slug carried in the embed tag. A tag is an edge, and expanding it in place would replace the edge with a copy.\n\nOn a large page, sections that do not fit keep their anchor and heading but come without a body, and the message names them so you can fetch them with `get_sections`.",
        "params": [
          {
            "name": "rootId",
            "type": "string",
            "required": true,
            "description": "Which page root the page lives in. Required — there is no default root."
          },
          {
            "name": "path",
            "type": "string",
            "required": true,
            "description": "Page path relative to the root."
          }
        ],
        "returns": "Jedna strona zaadresowana kluczem `(rootId, path)` jako koperta: `hash` — sha256 pełnego pliku, ważny `expectedHash` także przy ucięciu — `frontmatter` (`raw`, `fields` bez kluczy przy błędzie YAML), `preamble` i płaska lista itemów sekcji w kolejności dokumentu: kotwica, tekst i poziom nagłówka, ciało bez linii kotwicy i nagłówka. Sekcja poza budżetem wraca bez ciała ze znacznikiem ucięcia, a `message` wymienia jej kotwicę. Osadzenia nierozwinięte.",
        "sampleReturn": "{\"rootId\":\"pages\",\"path\":\"modules/m17-snapshots-releases/m17-snapshots-releases.md\",\"hash\":\"83e9f3ed8a614c69…\",\"results\":[{\"anchor\":\"m17top000\",\"heading_text\":\"M17 — Snapshots & Releases\",\"heading_level\":1,\"body\":\"\\n\"},{\"anchor\":\"m17top001\",\"heading_text\":\"Cel\",\"heading_level\":2,\"body\":\"\\nAutor zamraża stan specyfikacji…\\n\"},{\"anchor\":\"m17ops001\",\"heading_text\":\"Operacje (L3)\",\"heading_level\":2,\"truncated\":true}],\"truncated\":true,\"message\":\"1 section cut by the response budget: m17ops001. Fetch it with get_sections({ anchors: [\\\"m17ops001\\\"] }); write with update_sections using this hash as expectedHash.\"}",
        "readOnlyHint": null,
        "destructiveHint": null,
        "idempotentHint": null,
        "openWorldHint": null,
        "logic": "Cienkie lustro odczytu strony w rdzeniu odkrywania: adapter sprawdza kompletność klucza i mapuje kopertę rdzenia na kopertę kanału bez zmiany kształtu. Nie normalizuje treści, nie rozwija osadzeń i nie składa itemów z powrotem w tekst — strukturę, `hash` i treść `message` wydaje rdzeń. Odmawia, gdy brakuje `rootId` albo nie wskazuje on korzenia `kind: pages` (z listą korzeni `kind: pages`, bez cichego fallbacku) lub gdy strona nie istnieje.",
        "tags": [
          "m39"
        ],
        "createdAt": "2026-08-19T12:55:17.655Z",
        "updatedAt": "2026-10-05T16:35:24.258Z"
      },
      "after": {
        "slug": "c4s-reader-get-page",
        "title": "c4s-reader · get_page",
        "name": "get_page",
        "server": "c4s-reader",
        "description": "Get one whole page as a collection of sections. Requires the full page key: both `rootId` and `path`.\n\nA bare path is ambiguous across roots, so a call without `rootId` is refused with the list of roots rather than quietly falling back to a default root. Get the roots from `overview` and the paths from `list_pages`.\n\nThe answer carries the page `hash`, its `frontmatter` and `preamble`, and `results`: a flat list in document order with one item per section — its anchor, heading text, heading level and body. The anchor is a field of the item, so you never parse it out of text, and you can pass it straight to `get_sections`. A body holds neither the anchor line nor the heading line; a parent carries only its own body. An item under a heading that has no anchor yet comes without one.\n\n`frontmatter` gives the literal block (`raw`) and its parsed keys (`fields`); the keys are missing when the YAML does not parse, and `raw` is then the way to repair it.\n\nThe structure is read from the file, not from the index, so this call still answers when `get_page_outline` and `get_sections` refuse because the index is stale. `hash` is the sha256 of the whole file and works as `expectedHash` on a write even when the answer was cut.\n\nThe tool never expands embeds: an embedded entity's data is fetched separately with `get_entities`, using the slug carried in the embed tag. A tag is an edge, and expanding it in place would replace the edge with a copy.\n\nOn a large page, sections that do not fit keep their anchor and heading but come without a body, and the message names them so you can fetch them with `get_sections`.",
        "params": [
          {
            "description": "Which page root the page lives in. Required — there is no default root.",
            "name": "rootId",
            "required": true,
            "type": "string"
          },
          {
            "description": "Page path relative to the root.",
            "name": "path",
            "required": true,
            "type": "string"
          }
        ],
        "returns": "Jedna strona zaadresowana kluczem `(rootId, path)` jako koperta: `hash` — sha256 pełnego pliku, ważny `expectedHash` także przy ucięciu — `frontmatter` (`raw`, `fields` bez kluczy przy błędzie YAML), `preamble` i płaska lista itemów sekcji w kolejności dokumentu: kotwica, tekst i poziom nagłówka, ciało bez linii kotwicy i nagłówka. Sekcja poza budżetem wraca bez ciała ze znacznikiem ucięcia, a `message` wymienia jej kotwicę. Osadzenia nierozwinięte.",
        "sampleReturn": "{\"rootId\":\"pages\",\"path\":\"modules/m17-snapshots-releases/m17-snapshots-releases.md\",\"hash\":\"83e9f3ed8a614c69…\",\"results\":[{\"anchor\":\"m17top000\",\"heading_text\":\"M17 — Snapshots & Releases\",\"heading_level\":1,\"body\":\"\\n\"},{\"anchor\":\"m17top001\",\"heading_text\":\"Cel\",\"heading_level\":2,\"body\":\"\\nAutor zamraża stan specyfikacji…\\n\"},{\"anchor\":\"m17ops001\",\"heading_text\":\"Operacje (L3)\",\"heading_level\":2,\"truncated\":true}],\"truncated\":true,\"message\":\"1 section cut by the response budget: m17ops001. Fetch it with get_sections({ anchors: [\\\"m17ops001\\\"] }); write with update_sections using this hash as expectedHash.\"}",
        "readOnlyHint": null,
        "destructiveHint": null,
        "idempotentHint": null,
        "openWorldHint": null,
        "logic": "Cienkie lustro odczytu strony w rdzeniu odkrywania: adapter sprawdza kompletność klucza i mapuje kopertę rdzenia na kopertę kanału bez zmiany kształtu. Nie normalizuje treści, nie rozwija osadzeń i nie składa itemów z powrotem w tekst — strukturę, `hash` i treść `message` wydaje rdzeń. Wejście nie zrzuca kluczy spoza `rootId` i `path`, więc pozostawiony `range` dociera do rdzenia, który go odmawia. Odmawia, gdy brakuje `rootId` albo nie wskazuje on korzenia `kind: pages` (z listą korzeni `kind: pages`, bez cichego fallbacku), gdy strona nie istnieje lub gdy wejście niesie `range` (z kierunkiem na `get_page_outline`, potem `get_sections`).",
        "tags": [
          "m39"
        ],
        "createdAt": "2026-08-19T12:55:17.655Z",
        "updatedAt": "2026-10-08T21:55:14.286Z"
      }
    },
    {
      "type": "mcp-tool",
      "slug": "reference-tools-get-page",
      "name": "get_page",
      "op": "update",
      "before": {
        "slug": "reference-tools-get-page",
        "title": "reference-tools · get_page",
        "name": "get_page",
        "server": "reference-tools",
        "description": "Read one WHOLE page as a collection of sections, addressed by the FULL key of `rootId` plus `path`. A bare path is ambiguous across roots, so a call without `rootId` is refused with the list of roots rather than guessing the built-in one.\n\nThe answer is an envelope `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`. `results` is a FLAT list in document order, one item per section: `anchor`, `heading_text`, `heading_level`, `body`. The anchor is a field of the item, never a comment to parse out of text. `body` excludes the anchor line and the heading line and is otherwise a literal slice of the file, so `textEdits` match it as written; a parent carries only its own body, up to its first child heading. Under a heading the indexer has not tagged yet the item has no `anchor` — readable, not addressable by `get_sections`.\n\n`frontmatter` is `{ raw, fields? }`: `raw` is the literal block, `fields` the parsed keys, absent when the YAML does not parse. `preamble` is the text before the first heading. Embeds are never expanded — a tag is an edge; fetch the entity by its slug.\n\nThe structure is computed from the file, not from the index, so this call answers even while `get_page_outline` and `get_sections` refuse with `INDEX_STALE`. `hash` is the sha256 of the WHOLE file and arms `expectedHash` on a write even when the answer was cut.\n\nOver the budget, an item that does not fit keeps its anchor and heading, loses `body` and carries `truncated: true`; the first item is never dropped — its body is cut as text. `message` names the cut anchors: fetch them with `get_sections`.",
        "params": [
          {
            "name": "rootId",
            "type": "string",
            "required": true,
            "description": "Which page root. Required — omitting it is refused with the list of roots, never silently resolved to the built-in root."
          },
          {
            "name": "path",
            "type": "string",
            "required": true,
            "description": "Page path relative to the root."
          }
        ],
        "returns": "Koperta `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`. `results` — płaska lista itemów `{ anchor?, heading_text, heading_level, body, truncated? }` w kolejności dokumentu; `body` bez linii kotwicy i nagłówka. `frontmatter` = `{ raw, fields? }`, `preamble` jako tekst. `hash` — sha256 pełnego pliku, ważny `expectedHash` także przy ucięciu. Item poza budżetem bez `body`, z `truncated: true`; `message` wymienia jego kotwicę.",
        "sampleReturn": "{\"rootId\":\"pages\",\"path\":\"modules/m17-snapshots-releases/m17-snapshots-releases.md\",\"hash\":\"83e9f3ed8a614c69…\",\"results\":[{\"anchor\":\"m17top000\",\"heading_text\":\"M17 — Snapshots & Releases\",\"heading_level\":1,\"body\":\"\\n\"},{\"anchor\":\"m17top001\",\"heading_text\":\"Cel\",\"heading_level\":2,\"body\":\"\\nAutor zamraża stan specyfikacji…\\n\"},{\"anchor\":\"m17ops001\",\"heading_text\":\"Operacje (L3)\",\"heading_level\":2,\"truncated\":true}],\"truncated\":true,\"message\":\"1 section cut by the response budget: m17ops001. Fetch it with get_sections({ anchors: [\\\"m17ops001\\\"] }); write with update_sections using this hash as expectedHash.\"}",
        "readOnlyHint": null,
        "destructiveHint": null,
        "idempotentHint": null,
        "openWorldHint": null,
        "logic": "Strukturę liczy parser sekcji na bieżącej treści pliku, w tym samym odczycie co `hash` — nie z indeksu sekcji, więc odczyt nie jest bramkowany świeżością projekcji. Tagi XML w `body` zostają nierozwinięte. Item, który nie mieści się w budżecie, traci `body`, a zachowuje `anchor`, `heading_text` i `heading_level`; pierwszy item nie jest degradowany — jego ciało jest cięte tekstowo, tak samo jak preambuła ponad budżet. `message` wymienia kotwice itemów przyciętych i kieruje do `get_sections`. Odmawia, gdy brakuje `rootId` albo nie wskazuje on korzenia `kind: pages` (z listą korzeni `kind: pages`) lub gdy strona nie istnieje.",
        "tags": [
          "m39"
        ],
        "createdAt": "2026-08-19T12:56:19.409Z",
        "updatedAt": "2026-10-05T16:35:24.245Z"
      },
      "after": {
        "slug": "reference-tools-get-page",
        "title": "reference-tools · get_page",
        "name": "get_page",
        "server": "reference-tools",
        "description": "Read one WHOLE page as a collection of sections, addressed by the FULL key of `rootId` plus `path`. A bare path is ambiguous across roots, so a call without `rootId` is refused with the list of roots rather than guessing the built-in one.\n\nThe answer is an envelope `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`. `results` is a FLAT list in document order, one item per section: `anchor`, `heading_text`, `heading_level`, `body`. The anchor is a field of the item, never a comment to parse out of text. `body` excludes the anchor line and the heading line and is otherwise a literal slice of the file, so `textEdits` match it as written; a parent carries only its own body, up to its first child heading. Under a heading the indexer has not tagged yet the item has no `anchor` — readable, not addressable by `get_sections`.\n\n`frontmatter` is `{ raw, fields? }`: `raw` is the literal block, `fields` the parsed keys, absent when the YAML does not parse. `preamble` is the text before the first heading. Embeds are never expanded — a tag is an edge; fetch the entity by its slug.\n\nThe structure is computed from the file, not from the index, so this call answers even while `get_page_outline` and `get_sections` refuse with `INDEX_STALE`. `hash` is the sha256 of the WHOLE file and arms `expectedHash` on a write even when the answer was cut.\n\nOver the budget, an item that does not fit keeps its anchor and heading, loses `body` and carries `truncated: true`; the first item is never dropped — its body is cut as text. `message` names the cut anchors: fetch them with `get_sections`.",
        "params": [
          {
            "description": "Which page root. Required — omitting it is refused with the list of roots, never silently resolved to the built-in root.",
            "name": "rootId",
            "required": true,
            "type": "string"
          },
          {
            "description": "Page path relative to the root.",
            "name": "path",
            "required": true,
            "type": "string"
          }
        ],
        "returns": "Koperta `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`. `results` — płaska lista itemów `{ anchor?, heading_text, heading_level, body, truncated? }` w kolejności dokumentu; `body` bez linii kotwicy i nagłówka. `frontmatter` = `{ raw, fields? }`, `preamble` jako tekst. `hash` — sha256 pełnego pliku, ważny `expectedHash` także przy ucięciu. Item poza budżetem bez `body`, z `truncated: true`; `message` wymienia jego kotwicę.",
        "sampleReturn": "{\"rootId\":\"pages\",\"path\":\"modules/m17-snapshots-releases/m17-snapshots-releases.md\",\"hash\":\"83e9f3ed8a614c69…\",\"results\":[{\"anchor\":\"m17top000\",\"heading_text\":\"M17 — Snapshots & Releases\",\"heading_level\":1,\"body\":\"\\n\"},{\"anchor\":\"m17top001\",\"heading_text\":\"Cel\",\"heading_level\":2,\"body\":\"\\nAutor zamraża stan specyfikacji…\\n\"},{\"anchor\":\"m17ops001\",\"heading_text\":\"Operacje (L3)\",\"heading_level\":2,\"truncated\":true}],\"truncated\":true,\"message\":\"1 section cut by the response budget: m17ops001. Fetch it with get_sections({ anchors: [\\\"m17ops001\\\"] }); write with update_sections using this hash as expectedHash.\"}",
        "readOnlyHint": null,
        "destructiveHint": null,
        "idempotentHint": null,
        "openWorldHint": null,
        "logic": "Strukturę liczy parser sekcji na bieżącej treści pliku, w tym samym odczycie co `hash` — nie z indeksu sekcji, więc odczyt nie jest bramkowany świeżością projekcji. Tagi XML w `body` zostają nierozwinięte. Item, który nie mieści się w budżecie, traci `body`, a zachowuje `anchor`, `heading_text` i `heading_level`; pierwszy item nie jest degradowany — jego ciało jest cięte tekstowo, tak samo jak preambuła ponad budżet. `message` wymienia kotwice itemów przyciętych i kieruje do `get_sections`. Wejście nie zrzuca kluczy spoza `rootId` i `path`, więc pozostawiony `range` dociera do rdzenia, który go odmawia. Odmawia, gdy brakuje `rootId` albo nie wskazuje on korzenia `kind: pages` (z listą korzeni `kind: pages`), gdy strona nie istnieje lub gdy wejście niesie `range` (z kierunkiem na `get_page_outline`, potem `get_sections`).",
        "tags": [
          "m39"
        ],
        "createdAt": "2026-08-19T12:56:19.409Z",
        "updatedAt": "2026-10-08T21:55:14.288Z"
      }
    }
  ]
}
```
## Criteria — ac (change 2.1.13→2.1.14)
```json
{
  "from": {
    "id": 24010,
    "name": "2.1.13"
  },
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "entities": 3
  },
  "entities": [
    {
      "type": "ac",
      "slug": "ac-get-page-wywolane-z-parametrem-range",
      "name": "`get_page` wywołane z parametrem `range` kończy się `INVALID_ARGUMENT`, a nie odpowiedzią z całą stroną.",
      "op": "create",
      "after": {
        "slug": "ac-get-page-wywolane-z-parametrem-range",
        "title": "`get_page` wywołane z parametrem `range` kończy się `INVALID_ARGUMENT`, a nie odpowiedzią z całą stroną.",
        "kind": "edge-case",
        "status": "active",
        "verifies": [
          {
            "type": "mcp-tool",
            "slug": "c4s-reader-get-page"
          },
          {
            "type": "mcp-tool",
            "slug": "reference-tools-get-page"
          }
        ],
        "tags": [
          "m39-edge"
        ],
        "createdAt": "2026-10-08T21:55:16.484Z",
        "updatedAt": "2026-10-08T21:55:16.484Z"
      }
    },
    {
      "type": "ac",
      "slug": "ac-get-page-zwraca-hash-liczony-z-pelneg",
      "name": "`get_page` zwraca `hash` liczony z **pełnego pliku**, nigdy ze zwróconej części — odpowiedź z `truncated: true` nadal uzbraja `expectedHash` zapisu.",
      "op": "update",
      "before": {
        "slug": "ac-get-page-zwraca-hash-liczony-z-pelneg",
        "title": "`get_page` zwraca `hash` liczony z **pełnego pliku**, nigdy ze zwróconego prefiksu — odpowiedź z `truncated: true` nadal uzbraja `expectedHash` zapisu, a kontrakt odpowiedzi brzmi `{ rootId, path, content, hash, truncated?, truncationHint? }`.",
        "kind": "requirement",
        "status": "active",
        "verifies": [
          {
            "type": "mcp-tool",
            "slug": "c4s-reader-get-page"
          },
          {
            "type": "mcp-tool",
            "slug": "reference-tools-get-page"
          }
        ],
        "tags": [
          "m39"
        ],
        "createdAt": "2026-08-31T10:44:38.924Z",
        "updatedAt": "2026-08-31T10:44:38.924Z"
      },
      "after": {
        "slug": "ac-get-page-zwraca-hash-liczony-z-pelneg",
        "title": "`get_page` zwraca `hash` liczony z **pełnego pliku**, nigdy ze zwróconej części — odpowiedź z `truncated: true` nadal uzbraja `expectedHash` zapisu.",
        "kind": "requirement",
        "status": "active",
        "verifies": [
          {
            "slug": "c4s-reader-get-page",
            "type": "mcp-tool"
          },
          {
            "slug": "reference-tools-get-page",
            "type": "mcp-tool"
          }
        ],
        "tags": [
          "m39"
        ],
        "createdAt": "2026-08-31T10:44:38.924Z",
        "updatedAt": "2026-10-08T21:52:59.131Z"
      }
    },
    {
      "type": "ac",
      "slug": "ac-message-odmowy-get-page-z-parametrem",
      "name": "`message` odmowy `get_page` z parametrem `range` kieruje do `get_page_outline`, a potem do `get_sections`.",
      "op": "create",
      "after": {
        "slug": "ac-message-odmowy-get-page-z-parametrem",
        "title": "`message` odmowy `get_page` z parametrem `range` kieruje do `get_page_outline`, a potem do `get_sections`.",
        "kind": "edge-case",
        "status": "active",
        "verifies": [
          {
            "type": "mcp-tool",
            "slug": "c4s-reader-get-page"
          },
          {
            "type": "mcp-tool",
            "slug": "reference-tools-get-page"
          }
        ],
        "tags": [
          "m39-edge"
        ],
        "createdAt": "2026-10-08T21:55:16.490Z",
        "updatedAt": "2026-10-08T21:55:16.490Z"
      }
    }
  ]
}
```
## Conventions — L3 Spec Operations (sections 0–9) at 2.1.14
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "zr4rjlir",
          "headingPath": [],
          "heading": "L3 — Spec Operations",
          "content": "<after_change>\nJednostką tej warstwy jest **operacja** — nazwana rzecz, którą można zrobić z zawartością specyfikacji albo z turą agenta nad tą zawartością. Narzędzie MCP, komenda `c4s` i endpoint REST **nie są bytami tej warstwy**; są *renderowaniami* operacji w konkretnym kanale.\n\nRozróżnienie jest po to, żeby pytanie „czy X da się zrobić z zewnątrz\" miało jedną odpowiedź. Wcześniej ta sama rzecz była porządkowana raz po serwerze MCP, raz po komendzie, raz po `context_type`, raz po endpoincie — i nie było wiersza per operacja w żadnym z tych układów, więc odpowiedź trzeba było składać z pięciu stron i bywała sprzeczna.\n</after_change>"
        }
      ],
      "xmlRefs": {
        "after": [
          "<section_ref anchor=\"l3slice0\"/>",
          "<section_ref anchor=\"p3th8bt4\"/>",
          "<section_ref anchor=\"kehuh3fj\"/>",
          "<section_ref anchor=\"a5qandln\"/>",
          "<section_ref anchor=\"l3axes00\"/>",
          "<section_ref anchor=\"l3media0\"/>",
          "<section_ref anchor=\"l3route0\"/>",
          "<section_ref anchor=\"mzk6gtao\"/>",
          "<section_ref anchor=\"temm15qp\"/>",
          "<section_ref anchor=\"l3route0\"/>",
          "<section_ref anchor=\"l3locus0\"/>",
          "<section_ref anchor=\"p3th8bt4\"/>",
          "<section_ref anchor=\"l3locus0\"/>",
          "<section_ref anchor=\"kehuh3fj\"/>",
          "<section_ref anchor=\"l3locus0\"/>",
          "<section_ref anchor=\"l3locus0\"/>",
          "<section_ref anchor=\"l3route0\"/>"
        ]
      }
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "kehuh3fj",
          "headingPath": [
            "L3 — Spec Operations"
          ],
          "heading": "Rola warstwy",
          "content": "<after_change>**Implementor module: M43 — Spec Operations Core.**\n\nImplementator tej warstwy jest właścicielem **reguł, nie runtime'u**, i to odstępstwo trzeba przeczytać wprost, żeby nie szukać procesu, którego nie ma. Runtime powierzchni operacji nie istnieje jako jeden byt: **każdy kanał ma innego adaptera wejściowego**, a adaptery te nie mają wspólnego rejestru, wspólnego cyklu życia ani wspólnego punktu montowania. Rola „runtime powierzchni operacji\" pozostaje więc **rozdzielona**, a każdy jej fragment deklaruje moduł renderujący dany kanał — w swojej sekcji tej warstwy, nie tutaj.\n\nCo implementator skupia, to **brzmienie reguł wiążących więcej niż jedną operację**, każdej pod stabilnym identyfikatorem. Wiersz katalogu regułę **cytuje po identyfikatorze**; przepisanie jej brzmienia do modułu jest drugim źródłem prawdy dokładnie tej klasy, którą ta warstwa likwiduje. Bez tego domu reguła wspólna nie ma gdzie stanąć i osiada albo w tym pliku, który ma być cienki, albo — częściej — w każdej sekcji modułu z osobna, co jest obserwowaną przyczyną puchnięcia sekcji tej warstwy.\n\n**Umowa z warstwami renderowania — rówieśnicy, nie piętra.** Ta warstwa nie jest nadzbiorem konwencji REST (`@layers/L4-api.md`) ani konwencji powierzchni komendowej (`@layers/L14-cli-commands.md`). Zbiory się przecinają i żaden nie zawiera drugiego: są trasy REST poza katalogiem (SSE, upload, ustawienia, git) i są operacje, których żaden kanał sieciowy nie renderuje. Podział własności jest za to rozłączny: **tutaj mieszka osiągalność — czy, skąd i na jakich prawach operację da się wywołać; tam mieszka kształt renderowania — metoda, ścieżka, nazwa komendy, flagi, koperta odpowiedzi.** Stąd dwa zakazy, po jednym w każdą stronę: pole kanału nigdy nie niesie ścieżki ani nazwy komendy, a trasa albo komenda po tamtej stronie nigdy nie powtarza zasięgu, klasy mediacji ani idempotencji. Powtórzenie w którąkolwiek stronę jest drugim źródłem prawdy dokładnie tej klasy, którą ta warstwa likwiduje.\n\n**Katalog operacji nie jest listą w tym pliku.** Katalog to **suma sekcji L3 wszystkich modułów** — każdy moduł deklaruje operacje, których jest rdzeniem-właścicielem, w arkuszu o kształcie ustalonym w <section_ref anchor=\"l3slice0\"/>. Centralna tabela w warstwie byłaby drugim źródłem prawdy, starzejącym się przy każdej zmianie modułu — czyli dokładnie tym driftem, który ta warstwa likwiduje. Katalog jest przeszukiwalny dzięki **jednolitości kształtu wiersza**, nie dzięki fizycznej centralizacji.\n\nKontrakt wire zamontowanego serwera ma **jeden dom, wyznaczony deterministycznie** — stoi tam, gdzie wiersz katalogu odpowiadającej operacji, i jest regułą wypełniania sekcji modułu (<section_ref anchor=\"p3th8bt4\"/>).</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "l3slice0",
          "headingPath": [
            "L3 — Spec Operations"
          ],
          "heading": "Module slice schema",
          "content": "<after_change>\nSekcja modułu nosi nagłówek `## Spec Operations (L3)` i przyjmuje **jedną z trzech postaw**:\n\n1. **Wnoszę operacje.** Moduł jest rdzeniem-właścicielem semantyki co najmniej jednej operacji i wypisuje je w arkuszu katalogu (niżej). Moduł, który wnosi choćby jedną trasę REST nad zawartością specyfikacji, jest w tej postawie i sekcji nie pomija.\n2. **Konfiguruję kanał albo mechanizm, bez własnych operacji.** Moduł dostarcza adapter kanału, bramkę profilu albo mechanizm wspólny dla operacji cudzych, ale sam nie jest rdzeniem-właścicielem żadnego wiersza. Nagłówek **nie nosi sufiksu**, a sekcja jest **prozą**: co moduł wnosi do powierzchni i czego konsumenci mogą się po nim spodziewać. W tej samej postawie stoi **implementator warstwy**, czytając ten schemat w trybie how-mode: nie deklaruje własnych wierszy, tylko mówi, na co konsument może liczyć, wypełniając swój arkusz. Arkusza katalogu nie ma, bo nie ma czego w nim wypisać — a `— n/d` byłoby nieprawdą, skoro moduł warstwy dotyka.\n3. **Nie dotykam warstwy.** `## Spec Operations (L3) — n/d` z jednym zdaniem powodu.\n\nPostawa druga istnieje dlatego, że runtime powierzchni operacji jest **rozdzielony między kanały** (<section_ref anchor=\"kehuh3fj\"/>): moduł niosący adapter jednego z nich ma o tej warstwie dużo do powiedzenia i ani jednego własnego wiersza. Bez tej postawy musiałby kłamać jednym z dwóch pozostałych sposobów.\n</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "g8adono9",
          "headingPath": [
            "L3 — Spec Operations",
            "Module slice schema"
          ],
          "heading": "Arkusz katalogu — forma slice'a w postawie pierwszej",
          "content": "<after_change>Katalog modułu jest **encją `spreadsheet`** osadzoną w sekcji, nie tabelą markdown. Dane są strukturalne i siatkę przegląda się okiem, a nie czyta jako tekst; ta sama konwencja obsługuje moduł o czterech operacjach i moduł o czternastu, a wiersz o piętnastu polach przestaje się łamać, gdy dochodzi kolumna.\n\n| Element | Wartość |\n|---|---|\n| slug | `katalog-operacji-mNN` |\n| tytuł | `Katalog operacji (MNN)` |\n| tagi | `mNN` — ten sam tag, po którym tagowane są encje `ac` i `mcp-tool` modułu — oraz `l3-katalog` |\n| `headerRow` | `true`; wiersz 1 to nazwy pól |\n| `headerCol` | `false`; kolumna 1 niesie nazwę operacji, a nie etykietę wiersza |\n| `nCols` | `15`, bez wyjątku |\n| osadzenie | `<single_element type=\"spreadsheet\" slug=\"katalog-operacji-mNN\" caption=\"…\"/>` |\n\n**Kształt wiersza jest projektowany jak schemat encji.** Trzynaście z piętnastu pól to enum albo krótka wartość, bo wiersz ma zostać **skanowalny okiem**: akapit wciśnięty w komórkę niszczy dokładnie tę własność, dla której arkusz istnieje. Lista jest **zamknięta i uporządkowana**:\n\n| # | Pole | Wartość |\n|---|---|---|\n| 1 | `nazwa` | nazwa kanoniczna `snake_case`, wspólna dla wszystkich kanałów — kanał zmienia formę wywołania, nigdy nazwę operacji. Po myślniku **wolno** dopisać pół zdania, gdy sama nazwa nie odróżnia wiersza od sąsiedniego; pełny opis pod kątem agenta mieszka w encji renderowania (<section_ref anchor=\"a5qandln\"/>) |\n| 2 | `zasięg` | `project` \\| `workspace`; opisuje **podmiot** operacji, nie jej dostępność (<section_ref anchor=\"l3axes00\"/>) |\n| 3 | `mediacja` | `direct` \\| `agent-mediated` \\| `human-mediated` (<section_ref anchor=\"l3media0\"/>) |\n| 4 | `internal` | wartość wg reguły routingu (<section_ref anchor=\"l3route0\"/>) |\n| 5 | `cli` | jw. |\n| 6 | `mcp` | jw. |\n| 7 | `rest` | jw. |\n| 8 | `efekty` | wielokrotny, ze zbioru `brak` \\| `plik` \\| `db` \\| `ui-notify` (<section_ref anchor=\"mzk6gtao\"/>) |\n| 9 | `idempotencja` | `tak` \\| `nie` \\| `warunkowa — <powód>` (<section_ref anchor=\"temm15qp\"/>) |\n| 10 | `adresowanie` | co identyfikuje cel operacji — `(rootId, relPath)`, kotwica, slug, para ścieżek. Adres, nie opis parametru: miejsce parametru w żądaniu jest kształtem renderowania i należy do kanału |\n| 11 | `opis treści` | czym wołający opisuje nową treść: `dosłowny` \\| `różnicowy` \\| `obydwa` \\| `n/d` |\n| 12 | `guard` | guard współbieżności: `wymagany` \\| `opcjonalny` \\| `n/d — <powód>` |\n| 13 | `krotność` | `batch` \\| `jedno-celowa — <powód>` |\n| 14 | `reguły` | lista identyfikatorów reguł wiążących; wykluczenie zapisuje się jako `bez <id> — <powód>`. Wiersz regułę **cytuje, nigdy nie streszcza** — słownik identyfikatorów jest zamknięty i należy do implementatora warstwy. Cytowaniu podlega reguła, której nie domyka żadna kolumna (niżej) |\n| 15 | `kody błędów` | lista kodów, deklarowana raz i mapowana per kanał |\n\n**Granica pola `reguły` jest mechaniczna: cytuje się regułę, której nie domyka żadna kolumna.** Trzy reguły słownika są spełnione przez samo istnienie pola, w które każą wpisać wartość — `guard-declared` domyka pole 12, `batch-required` pole 13, `diff-mode-declared` pole 11. Wypisanie ich w polu 14 powtarza informację, którą wiersz niesie kolumnę obok, więc jest szumem, a nie rygorem. Każda pozostała reguła kolumny nie ma, więc wiersz, który jej nie cytuje, **przemilcza zobowiązanie** — dotyczy to także `destructive-declared` i `match-count-declared`, których nazwa sugeruje deklarację, choć w kształcie wiersza nie ma pola, które by ją niosło. Wiersz, którego nie wiąże żadna reguła z tej reszty, nosi `n/d`; pustej komórki nadal nie ma. Test stosuje się do nazwy reguły, nie do jej brzmienia, więc nowa reguła w słowniku implementatora nie wymaga tu poprawki: albo dostaje kolumnę, albo jest cytowana.\n\n**Cena formy arkuszowej jest zapisana, nie przemilczana.** Typ `spreadsheet` ma `searchableFields` równe `slug`, `title` i `tags[]` — **treść komórek nie jest indeksowana przez nic**. Wynikają stąd dwie konsekwencje i obie przyjmuje się świadomie:\n\n1. **Tag `l3-katalog` nie jest ozdobą, tylko protezą.** Wyliczenie wszystkich katalogów naraz jest **wyłącznie** zapytaniem po tym tagu; bez niego katalog przestaje być osiągalny jako całość, a to jest dokładnie ta własność, dla której ta warstwa powstała.\n2. **Pytanie odwrotne pozostaje bez odpowiedzi maszynowej.** „Które operacje wiąże reguła `echo-free`?\" ani „gdzie zadeklarowano guard jako wymagany?\" nie da się zadać żadnym zapytaniem — trzeba otworzyć arkusze i przeczytać je okiem. Przy zmianie brzmienia reguły jest to realny koszt utrzymania i ponosi go implementator warstwy, a nie autor wiersza. Formą, która zdejmuje ten koszt w całości, jest **typ encji per operacja**: piętnaście pól staje się wtedy **filtrowalne**, a nie tylko czytelne. Ta droga jest przyjętym kierunkiem — nic w tej konwencji jej nie zamyka i nic jej nie wymusza.\n\n**Komórka niezapisana jest komórką pustą, a pusta jest błędem specyfikacji** — i w arkuszu trzeba to wymusić po stronie wymiarów, nie po stronie oka. Pusta wartość nie jest w arkuszu w ogóle przechowywana, więc luka nie wygląda jak puste pole — nie wygląda na nic. Stąd wymóg: **`nCols` arkusza równa się piętnaście, a każdy wiersz ma zapisaną wartość w każdej z piętnastu kolumn**, przy czym `n/a — <powód>`, `n/d` i `poza katalogiem — <powód>` **są** wartościami (<section_ref anchor=\"l3route0\"/>). Reguła nie ma wyjątku dla pola, którego wartość w danym module wychodzi jednolita: milczenie o czymś oczywistym i milczenie o czymś niesprawdzonym wyglądają identycznie.\n\n**Kryterium rozdziału między wierszem a encją kanału — jedno pytanie.** *Czy ten fakt zmienia się, gdy zmienisz kanał?* Zmienia się → należy do encji kanału. Nie zmienia się → należy do wiersza albo do reguły wspólnej. Pytanie wynika wprost z twardego inwariantu warstwy (<section_ref anchor=\"l3locus0\"/>), więc nie wymaga osobnego uzasadnienia, i tłumaczy podziały, które inaczej wyglądają na arbitralne: **kod** błędu jest polem wiersza, a **koperta** błędu należy do kanału; wymagalność guardu jest polem wiersza, a miejsce parametru w żądaniu — kształtem renderowania.\n\n**Czego wiersz nie niesie.** Kształt zwrotki, nazwy i typy parametrów oraz opis pod kątem agenta idą do encji renderowania (<section_ref anchor=\"p3th8bt4\"/>). Kroki łańcucha odpalanego po zapisie — indeksacja, capture wersji, token watchera — nie są ani polem wiersza, ani regułą wspólną: są substancją modułu, który ten łańcuch posiada, i stoją w jego sekcji domenowej. Pola `rdzeń-właściciel` i `locus wykonania` kolumn nie mają: pierwsze jest tożsame z modułem, w którego sekcji arkusz stoi, drugie jest stałą całej warstwy (<section_ref anchor=\"l3locus0\"/>).</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "m2e2kanp",
          "headingPath": [
            "L3 — Spec Operations",
            "Module slice schema"
          ],
          "heading": "Naming per kanał",
          "content": "<after_change>\nNazwa kanoniczna operacji jest jedna; każdy kanał ma deterministyczną regułę jej renderowania.\n\n| Element | Konwencja | Przykład |\n|---------|-----------|----------|\n| Nazwa operacji | `verb_noun`, snake_case; operacje batchowe w **liczbie mnogiej** | `create_entities`, `list_entities`, `tag_entity`, `link_dto` |\n| Nazwa serwera MCP | kebab-case | `entity-tools`, `endpoint-tools`, `reference-tools`, `plan-tools` |\n| Renderowanie `internal` / `mcp` | `mcp__{server}__{tool}` | `mcp__entity-tools__create_entities` |\n| Renderowanie `rest` | metoda + ścieżka wg konwencji L4 | `POST /api/entities/:type` |\n| Parametr wejściowy | camelCase | `pagePath`, `entityType`, `tagSlugs` |\n| Pole wyjściowe | camelCase | `pageTree`, `entityList`, `brokenReferences` |\n\nRenderowania w kanale `cli` ta tabela nie opisuje: nazwa komendy, jej flagi i argumenty są **kształtem renderowania**, więc należą do konwencji powierzchni komendowej, a nie tutaj (<section_ref anchor=\"kehuh3fj\"/>). Wiąże stąd tylko tyle, że nazwa operacji pozostaje jedna, a komenda jest jej renderowaniem, nie drugą nazwą.\n\n**Czasowniki:** `get` — pobierz jeden lub wskazane; `list` — pobierz kolekcję (z filtrami); `search` — full-text; `create` / `update` (partial) / `delete`; `add` — dodaj relację; `find` — wyszukaj relację.\n\n**Zmiana nazwy serwera to zmiana nazwy narzędzia.** Nazwa serwera jest częścią identyfikatora widzianego przez model (`mcp__{server}__{tool}`), więc rozdzielenie albo scalenie serwerów przepisuje każde odwołanie do jego narzędzi — w promptach, w rendererze narzędzi klienta i w prozie spec. To realny koszt operacyjny takiej zmiany, nie kosmetyka; nazwa serwera raz wypuszczona do configów zewnętrznych klientów jest **kosztowna do poprawienia nawet wtedy, gdy zaczyna kłamać** o zakresie powierzchni.\n\n**Ten koszt jest jedynym hamulcem dla wymogu batcha** (reguła `batch-required`): przejście operacji jedno-celowej na batchową zmienia jej nazwę na mnogą, więc jest zmianą identyfikatora, nie tylko schematu wejścia. Nie jest to powód, by wymogu nie stawiać — jest to powód, by koszt przemianowania był policzony w tym samym miejscu, w którym zapada decyzja.\n\n**Jedna operacja bywa renderowana w REST więcej niż jedną trasą — pod jednym warunkiem.** Wiersz „Renderowanie `rest`\" czyta się domyślnie jako 1:1, ale odwzorowanie jeden-do-wielu jest legalne wtedy i tylko wtedy, gdy tryby wejścia operacji mają **rozłączną semantykę HTTP** — `PUT` opisuje stan docelowy, `PATCH` modyfikację, `POST` akt. Wciskanie obu trybów w jedną trasę dałoby jeden URL o dwóch nieporównywalnych znaczeniach i rozjechałoby się z DTO tej trasy, w którym opis treści jest jeden. Rozdzielenie **nie jest** drugą semantyką operacji ani wyjątkiem od korolarza „jedna funkcja na operację\" (<section_ref anchor=\"l3locus0\"/>): obie trasy wołają tę samą funkcję rdzenia, a nazwa kanoniczna pozostaje jedna. Poza tym warunkiem obowiązuje 1:1 — dwie trasy o tej samej semantyce są duplikacją, nie renderowaniem.</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "3jnl3338",
          "headingPath": [
            "L3 — Spec Operations",
            "Module slice schema"
          ],
          "heading": "I/O i koperta błędu",
          "content": "<after_change>\n- **Wejście:** obiekt JSON, walidacja przez schemat deklarowany przy operacji.\n- **Wyjście `internal` / `mcp`:** format content MCP — `{ content: [{ type: \"text\", text: string }] }`, dane serializowane jako JSON string.\n- **Błąd `internal` / `mcp`:** `{ content: [{ type: \"text\", text: JSON.stringify({ error, code }) }], isError: true }`.\n- **Wyjście / błąd `rest` i `cli`:** koperty własne kanału (L4 / L14), ale **kod błędu** jest ten sam — kanał mapuje taksonomię operacji, nie definiuje własnej.\n- **Nawigacja w błędzie** jest częścią kontraktu operacji, nie uprzejmością kanału: `NOT_FOUND` niesie alternatywy, `INVALID_ARGUMENT` — ścieżkę naprawy.\n</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "a5qandln",
          "headingPath": [
            "L3 — Spec Operations",
            "Module slice schema"
          ],
          "heading": "Opis operacji (LLM-friendly)",
          "content": "<after_change>\nKażda operacja ma opis pisany pod kątem agenta: **co robi** (1 zdanie), **kiedy używać** (kontekst), **co zwraca** (krótko). Opis jest własnością operacji i jest ten sam we wszystkich kanałach agentowych.\n\nPrzykład: *„Read a specification page by path. Returns markdown content with XML entity references. Use when you need to understand what a page contains.\"*\n</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "mzk6gtao",
          "headingPath": [
            "L3 — Spec Operations",
            "Module slice schema"
          ],
          "heading": "Efekty uboczne",
          "content": "<after_change>Pole `efekty` przyjmuje wartości ze **zbioru zamkniętego**, wielokrotnie: **`brak`** (read-only) · **`plik`** (zapis do filesystemu) · **`db`** (indeks pochodny) · **`ui-notify`** (zdarzenie do UI). `brak` nie łączy się z żadną inną wartością.\n\nCo dokładnie zmienia się w pliku, którą projekcję dotyka indeks i jakie zdarzenie leci do UI — to należy do modułu będącego rdzeniem-właścicielem operacji, nie do pola. Pole odpowiada na pytanie **czy**, moduł na pytanie **co**; wpisanie drugiego w pierwsze odbiera wierszowi skanowalność, dla której kształt pola jest enumem.\n\nDeklaracja jest jedna dla operacji i nie zmienia się między kanałami, bo wykonanie jest to samo (<section_ref anchor=\"l3locus0\"/>).</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "temm15qp",
          "headingPath": [
            "L3 — Spec Operations",
            "Module slice schema"
          ],
          "heading": "Idempotencja",
          "content": "<after_change>Pole `idempotencja` przyjmuje `tak`, `nie` albo `warunkowa — <powód>`; trzecia wartość obsługuje operację, której idempotencja zależy od trybu wejścia, i powód jest jej częścią, nie komentarzem. Operacja batchowa deklaruje przy okazji semantykę częściowego powodzenia — koperta per item, brak transakcyjności.\n\nMilczenie w tym polu jest luką także tam, gdzie wartość wychodzi jednolita dla całego modułu: z pustego pola czytelnik nie odróżni „oczywiście tak\" od „nie sprawdzono\".</after_change>"
        }
      ]
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 10
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L3-spec-operations.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "vdf5esgb",
          "headingPath": [
            "L3 — Spec Operations",
            "Module slice schema"
          ],
          "heading": "Rodzina odczytu artefaktu — deklaracja wymagana",
          "content": "<after_change>\nModuł będący właścicielem operacji nad **kindem artefaktu** (brief, patch, plan) wypełnia w swojej sekcji cztery pozycje ponad wiersz katalogu: **`list_<kind>s`**, **`get_<kind>` z oknem**, **`search_<kind>s`** i **budżet odpowiedzi**. Mechanizm każdej z nich — kształt okna, marker degradacji, wspólna taksonomia błędów, dialekt wzorca — jest wspólny dla wszystkich kindów i należy do modułu prowadzącego ich rejestr; do modułu-właściciela kindu należy **wartość**.\n\n`n/a — <powód>` jest tu wartością legalną i wystarczającą, dokładnie na prawach reguły routingu (<section_ref anchor=\"l3route0\"/>): bywa kind, dla którego przedmiotem operacji jest wyłącznie pojedynczy artefakt, a nie jego zbiór — wtedy pozycja `list_<kind>s` nosi zapisany powód zamiast wartości. Wymóg nie brzmi więc „miej wszystko\", tylko **„zadeklaruj wartość dla każdej pozycji\"**.\n\nPowód jest ten sam, który stoi za zakazem pustego pola kanału i za wymogiem deklaracji guardu współbieżności (reguła `guard-declared`): **asymetria między kindami jest błędem specyfikacji wtedy i tylko wtedy, gdy jest niezapisana.** Z milczenia w tym miejscu wołający ma prawo wyczytać dwie rozbieżne rzeczy — że operacji świadomie nie ma, albo że po prostu jeszcze jej nie opisano — a tylko jedna z nich jest warta czekania.</after_change>"
        }
      ]
    }
  ]
}
```
## Conventions — L14 CLI Commands (sections 0–1) at 2.1.14
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 2
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L14-cli-commands.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "1hlvn21h",
          "headingPath": [],
          "heading": "L14 — CLI Commands",
          "content": "<after_change>\n> Konwencja, w której moduł wnosi swoje komendy do bin `c4s`. Warstwa fiksuje kształt opisu komendy i kontrakt kontrybucji; runtime CLI (dispatcher, resolver projektu/workspace, envelope błędów, formaty wyjścia, packaging) dostarcza implementor.\n\n**Relacja do L3.** Komenda jest **renderowaniem** operacji z katalogu (`@layers/L3-spec-operations.md`), a nie osobnym bytem — semantyka, kody błędów i zasięg deklarowane są raz, w wierszu katalogu. L14 przeżywa jako osobna warstwa, bo niesie substancję **niewyprowadzalną** z operacji (tryb wykonania, flagi własne, exit codes, resolver projektu) i ma konsumenta spoza agenta: operatora maszyny. Dlatego bin `c4s` zawiera również komendy **poza** katalogiem — środowiskowe, których podmiotem nie jest zawartość specyfikacji.\n</after_change>"
        }
      ],
      "xmlRefs": {
        "after": []
      }
    }
  ]
}
```
```json
{
  "from": null,
  "to": {
    "id": 24269,
    "name": "2.1.14"
  },
  "total": {
    "pages": 1,
    "sections": 2
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L14-cli-commands.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "flt0hm9r",
          "headingPath": [
            "L14 — CLI Commands"
          ],
          "heading": "Module slice schema",
          "content": "<after_change>\nImplementor module: **M11 — c4s (CLI + MCP)** (`modules/m11-c4s/L14-cli-commands.md`, sekcja „CLI Commands (L14)\" — dispatcher, rejestr `CliCommandContribution`, własność envelope/`codeToExit`/wspólnych flag, katalog komend generycznych).\n\nKażdy moduł-konsument opisuje swoje komendy w sekcji `## CLI (L14)` swojego pliku, wypełniając pola:\n\n- **Komenda** — nazwa `c4s <cmd>` w kebab-case (wyjątek: generyczne readery XML-tagowe implementora używają underscore 1:1 z nazwą tagu) + tabela wywołań (wywołanie → znaczenie) lub zwięzła sygnatura z flagami. Samą nazwę wypełnia się wobec katalogu operacji warstwy operacji specyfikacji, w dwóch wariantach:\n\n  1. komenda renderująca jeden wiersz katalogu 1:1 — pole niesie nazwę tej operacji przepisaną na kebab-case;\n  2. komenda, której nazwa od nazwy operacji odchodzi — bo renderuje agregat kilku operacji, ustawia pojedyncze pole albo nie renderuje operacji katalogu wcale — uzasadnia to odejście w slice jednym zdaniem.\n\n  Zakres jest wąski celowo: to wymaganie rozstrzyga wypełnienie tego pola, a nie to, z jakiego słownika wolno brać czasownik samej nazwy operacji — tamto należy do warstwy operacji specyfikacji i drugiego domu tutaj nie dostaje.\n- **Tryb wykonania** — dokładnie jeden z: `server-delegating` (owija REST pod prefiksem `/api/projects/:id/…`, wymaga działającego serwera + health-check), `fs-scoped` (operuje na plikach spoza specyfikacji — repo kodu, katalog docelowy — bez serwera i bez db-slotu; jedyny wyjątek: komenda wywołana z jawnym `--server <url>` wykonuje przed zapisem **jeden odczyt** z tego serwera — sprawdzenie, że wskazane `id` projektu jest na liście projektów serwera — a sam zapis plików pozostaje lokalny i żadna operacja na specyfikacji nie idzie przez serwer), `registry-write` (server-free **zapis** do globalnego rejestru workspace'ów `~/.claude4spec/workspaces.json` — bez serwera, bez db-slotu, bez plików `cwd` projektu), `registry-read` (server-free **odczyt** globalnego rejestru workspace'ów `~/.claude4spec/workspaces.json` — bez serwera, bez db-slotu, bez plików `cwd` projektu i bez resolvera projektu), `scaffold` (server-free bootstrap **nowego** katalogu w CWD — bez serwera, bez db-slotu, bez rejestru workspace'ów i **bez rozwiązywania istniejącego projektu**: dispatcher nie stosuje resolvera `--project`/walk-up do `.claude4spec/`, więc komenda działa również poza jakimkolwiek projektem. Pobiera `FileSet` ze **zdalnego repozytorium git** i rozwija go do nowo utworzonego katalogu docelowego; wymagania środowiskowe: dostęp sieciowy + `git` na `$PATH`, opcjonalnie `npm` gdy komenda instaluje zależności po ekspansji). Deklaracja obowiązkowa — determinuje wymagania środowiskowe i zestaw błędów resolvera/health-check dziedziczonych z runtime implementora.\n\n  **Tryb odpowiada na pytanie o przynależność, nie o mechanikę.** Odkąd wykonanie każdej operacji katalogu należy do procesu serwera — inwariant warstwy operacji specyfikacji — komenda czytająca specyfikację nie ma innej drogi niż `server-delegating` — a tryb przestaje mówić *„jak ta komenda działa\"* i zaczyna mówić *„czy ta komenda jest w ogóle operacją na specyfikacji\"*. Daje to darmowy test spójności: komenda w katalogu z trybem innym niż `server-delegating` jest błędem specyfikacji — i odwrotnie.\n\n  Konsekwencja praktyczna: `fs-scoped` zostaje **wyłącznie** dla komend operujących na plikach spoza specyfikacji (instalacja skilli do repo kodu), a nie dla komend czytających czy piszących treść spec z pominięciem serwera. Tryb „czytam db-slot SQLite bez serwera\" nie ma już ani jednego nosiciela: bezpośredni odczyt slotu przez obcy proces zniknął razem z inwariantem locus wykonania.\n- **Flagi własne** — wyłącznie flagi specyficzne dla komendy; wspólnych selektorów (`--project <id>` / `--workspace` / `--server`) ani flag formatu (`--format` / `--compact`) nie deklaruje się ponownie — dziedziczone z runtime implementora. Projekt wskazuje wyłącznie jego `id`; przy braku `--project` domyślnie rozwiązuje go walk-up od katalogu roboczego — selektora ścieżkowego nie ma. Wyjątek: w trybie `scaffold` selektory projektu/workspace/serwera **nie obowiązują** (nie ma istniejącego projektu do wskazania) — komenda deklaruje własny cel operacji jako argument pozycyjny, a z runtime implementora dziedziczy wyłącznie envelope błędów, `codeToExit` i formaty wyjścia. Analogicznie w trybie `registry-read` selektory projektu/workspace'u **nie obowiązują** — komenda z definicji nie zawęża się do jednego workspace'u — a z runtime implementora dziedziczy wyłącznie envelope błędów, `codeToExit` i formaty wyjścia.\n- **Kody błędów** — kody wnoszone przez komendę do unii `CliErrorCode` (nazwa + warunek + exit-code, jeśli niestandardowy); kody resolvera/health-check reuse'owane bez redeklaracji. Envelope (stderr JSON `{ error: { code, message, hint? } }` + exit >0) jest własnością implementora — slice go nie powtarza. Kod błędu, którego naprawa jest znana i daje się opisać krokami, niesie te kroki jako ustrukturyzowane deskryptory w payloadzie błędu, a nie wyłącznie jako prozę w `hint`.\n- **Delegacja** — jedno zdanie „komenda deleguje do <core modułu-właściciela>\" + grep-proof, gdy dotyczy; logika domenowa komendy żyje w core modułu, w bin trafia wyłącznie kontrybucja `CliCommandContribution` (kontrakt u implementora).\n- **Output** *(opcjonalne)* — kształt payloadu wyjścia komendy (pola rekordu, porządek, jednostka wiersza). Bez envelope'u runtime implementora — formaty `--format json|text` i `--compact` są wspólne i nie deklaruje się ich per komenda. Pole opcjonalne: komenda, której wyjściem jest wyłącznie efekt uboczny na plikach, może je pominąć.\n- **Kryteria akceptacji** — AC komendy jako encje `ac` tagowane tagiem AC modułu + `cli` (edge-case'y z `kind: edge-case`); renderują się we wspólnych embedach AC modułu — bez drugiego embeda w slice, chyba że moduł nie ma embeda AC (wtedy `<tagged_list type=\"ac\" tags=\"mNN,cli\" filter=\"and\"/>` w slice).\n</after_change>"
        }
      ]
    }
  ]
}
```
