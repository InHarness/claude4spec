# Packet — m11-paczka-trzy-biny

- Window: 2.1.13 → 2.1.14 (delta)
- Unit: m11-paczka-trzy-biny
- Goal: Paczka `@inharness-ai/claude4spec` niesie trzy biny: serwer, CLI i most MCP stdio↔HTTP. Każda forma bez instalacji wywołuje bin przez `npx -y -p <paczka> <bin>`, także wariant stdio we wpisie konfiguracji połączenia MCP, który wydaje serwer. Usunięta jest forma `npx -y <paczka> c4s`.
- Layers touched: Domain (M11 packaging, M12 rejestracja), L4 (DTO mcp-config-response)
- Entities: code-snippet 1 (create), dto 1 (update), ac 1 (update)
- Changed sections: m11pkg00, wtv48f3x
- Criteria: 1
- Jobs: none
- Packet size: ~32230 bytes

## The change (2.1.13 → 2.1.14)

### [modules/m11-c4s/L2-domain.md] Domain > Packaging i distribution (anchor `m11pkg00`)


<before_change>CLI dostarczany jako **osobny bin** w tej samej paczce npm (`claude4spec`). `package.json`:</before_change>
<after_change>Paczka npm `@inharness-ai/claude4spec` niesie trzy biny:</after_change>

<before_change>```json
{
  "bin": {
    "claude4spec": "./dist/server.js",
    "c4s": "./dist/cli.js"
  }
}
```</before_change>
<after_change>- `claude4spec` — wejście serwera, bez subkomend; to jego uruchamia goła komenda `npx @inharness-ai/claude4spec`;
- `c4s` — CLI;
- `c4s-mcp` — most stdio↔HTTP dla klientów MCP bez transportu HTTP (M12 <section_ref anchor="mqupx1tx"/>).</after_change>

<before_change>User ktory juz zainstalowal `npx @inharness-ai/claude4spec` ma `c4s` automatycznie dostepny jako `npx c4s`. Dla convenience: `npm i -g @inharness-ai/claude4spec` daje globalne `c4s` na $PATH. Zewnetrzni agenci moga rowniez wolac `npx -y @inharness-ai/claude4spec c4s ...` gdy preferuja zero-install flow.</before_change>
<after_change>Nazwa każdego bina poza domyślnym różni się od nazwy paczki, więc bez instalacji woła się go formą `npx -y -p @inharness-ai/claude4spec <bin>` — tak zewnętrzni agenci wołają CLI (`npx -y -p @inharness-ai/claude4spec c4s ...`), gdy preferują przepływ bez instalacji. Po instalacji paczki `c4s` jest dostępne jako `npx c4s`, a `npm i -g @inharness-ai/claude4spec` daje globalne `c4s` na `$PATH`.</after_change>

**Artefakty dla external agentów powstają on-demand — wszystkie.** **Skille external NIE są generowane przy bootstrapie** — powstają **on-demand**, dwiema równorzędnymi drogami: (1) ręczny ZIP z elementu Agent skills na stronie ustawień (M22) — endpoint <inline_mention type="endpoint" slug="get-api-external-skills-bundle"/> zwraca bundle in-memory; (2) `c4s install-skills` (M11) — pisze foldery `SKILL.md` wprost do `<cwd>/.claude/skills` w repo kodu; tryb `fs-scoped`, bo podmiotem jest repo kodu, nie specyfikacja. **M11 owns komendę** `install-skills`, **M22 owns renderery / `FileSet`** (rdzeń `buildExternalSkillsBundle(ctx, selection?)`). Tą samą logiką jedzie konfiguracja połączenia MCP: wydaje ją na żądanie **M12 External MCP**, więc przy bootstrapie nie ląduje na dysku żaden artefakt integracyjny — ani skill, ani wpis konfiguracyjny. M11 nie owns żadnego pliku bootstrap'owego — `c4s` CLI jest **uzywany przez** skill `c4s-spec-reader` (M22). Treść skilla jest **CLI-only** (M22 <section_ref anchor="m22dread"/>): pełna tabela mapping tag↔CLI, `c4s resolve`, nawigacja po stronach i sekcjach oraz discovery — **bez** sekcji setupu MCP (rejestrację opisuje i wydaje na żądanie M12).

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > Rejestracja w konfigu agenta > Warianty wpisu (anchor `wtv48f3x`)

<after_change>
<single_element type="code-snippet" slug="wpis-serwera-c4s-reader"/>

Wariant stdio uruchamia bin `c4s-mcp` formą `npx -y -p @inharness-ai/claude4spec c4s-mcp` — reguła wywołania binów paczki stoi w <section_ref anchor="m11pkg00"/>; przy paczce zainstalowanej globalnie `command` to wprost `c4s-mcp`.
</after_change>

## Entities (change)

### code-snippet `wpis-serwera-c4s-reader` — op: create

after:
```json
{
 "slug": "wpis-serwera-c4s-reader",
 "title": "Wpis serwera c4s-reader w konfigu klienta MCP",
 "language": "jsonc",
 "filename": null,
 "code": "// Wpis serwera c4s-reader w konfigu klienta MCP (.mcp.json, ~/.cursor/mcp.json, …).\n// {publicUrl} — publicUrl workspace'u; {projectId} — id projektu z rejestru workspace'u.\n\n// Wariant 1 — HTTP, punkt montowania projektu (project-bound)\n{\n  \"mcpServers\": {\n    \"c4s-reader\": {\n      \"type\": \"http\",\n      \"url\": \"{publicUrl}/api/projects/{projectId}/mcp\"\n    }\n  }\n}\n\n// Wariant 2 — HTTP, punkt montowania workspace'u (workspace-bound)\n{\n  \"mcpServers\": {\n    \"c4s-reader\": {\n      \"type\": \"http\",\n      \"url\": \"{publicUrl}/api/workspace/mcp\"\n    }\n  }\n}\n\n// Wariant 3 — most stdio dla klientów bez transportu HTTP\n{\n  \"mcpServers\": {\n    \"c4s-reader\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"-p\", \"@inharness-ai/claude4spec\", \"c4s-mcp\", \"--url\", \"{publicUrl}/api/projects/{projectId}/mcp\"]\n    }\n  }\n}",
 "tags": [
  "m12"
 ],
 "createdAt": "2026-10-08T15:42:07.717Z",
 "updatedAt": "2026-10-08T15:42:07.717Z"
}
```

### dto `mcp-config-response` — op: update

before:
```json
{
 "slug": "mcp-config-response",
 "title": "McpConfigResponse",
 "description": "Komplet wariantów połączenia MCP wyrenderowany po stronie serwera. Klient niczego nie skleja: każda pozycja niesie gotową etykietę pilla i gotowy do skopiowania snippet konfiguracyjny.",
 "fields": [
  {
   "name": "variants",
   "type": "McpConfigVariant[]",
   "required": true,
   "description": "Trzy pozycje w kolejności prezentacji: HTTP project-bound, HTTP workspace-bound, most stdio."
  },
  {
   "name": "variants[].id",
   "type": "string",
   "required": true,
   "description": "Stabilny identyfikator wariantu — klucz pilla i wyboru aktywnej pozycji."
  },
  {
   "name": "variants[].label",
   "type": "string",
   "required": true,
   "description": "Etykieta pilla, gotowa do wyświetlenia."
  },
  {
   "name": "variants[].snippet",
   "type": "string",
   "required": true,
   "description": "Gotowy do skopiowania wpis konfiguracyjny — adres zaczyna się od `publicUrl` workspace'u, a projekt wskazuje jego `id`, np. `https://c4s.firma.dev/api/projects/app-spec/mcp`; obie wartości wstrzyknięte z rejestru workspace'u."
  }
 ],
 "examples": [],
 "tags": [
  "api",
  "m12"
 ],
 "createdAt": "2026-09-17T12:08:37.198Z",
 "updatedAt": "2026-09-28T18:25:15.690Z"
}
```

after:
```json
{
 "slug": "mcp-config-response",
 "title": "McpConfigResponse",
 "description": "Komplet wariantów połączenia MCP wyrenderowany po stronie serwera. Klient niczego nie skleja: każda pozycja niesie gotową etykietę pilla i gotowy do skopiowania snippet konfiguracyjny.",
 "fields": [
  {
   "name": "variants",
   "type": "McpConfigVariant[]",
   "required": true,
   "description": "Trzy pozycje w kolejności prezentacji: HTTP project-bound, HTTP workspace-bound, most stdio."
  },
  {
   "name": "variants[].id",
   "type": "string",
   "required": true,
   "description": "Stabilny identyfikator wariantu — klucz pilla i wyboru aktywnej pozycji."
  },
  {
   "name": "variants[].label",
   "type": "string",
   "required": true,
   "description": "Etykieta pilla, gotowa do wyświetlenia."
  },
  {
   "name": "variants[].snippet",
   "type": "string",
   "required": true,
   "description": "Gotowy do skopiowania wpis konfiguracyjny, instancja <inline_mention type=\"code-snippet\" slug=\"wpis-serwera-c4s-reader\"/> — adres zaczyna się od `publicUrl` workspace'u, a projekt wskazuje jego `id`; obie wartości wstrzyknięte z rejestru workspace'u."
  }
 ],
 "examples": [],
 "tags": [
  "api",
  "m12"
 ],
 "createdAt": "2026-09-17T12:08:37.198Z",
 "updatedAt": "2026-10-08T15:42:11.732Z"
}
```

## Criteria (1)

`ac-bin-c4s-jest-dostepny-po-instalacji-pa` — verifies empty: checks its own title against the pages of this recipe (build override).

### ac `ac-bin-c4s-jest-dostepny-po-instalacji-pa` — op: update

before:
```json
{
 "slug": "ac-bin-c4s-jest-dostepny-po-instalacji-pa",
 "text": "Bin `c4s` jest dostępny po instalacji paczki `claude4spec` (`package.json` `bin.c4s` obok `bin.claude4spec`); `npx c4s --version` zwraca wersję paczki.",
 "kind": "requirement",
 "status": "active",
 "verifies": [],
 "description": null,
 "tags": [
  "cli",
  "m11"
 ]
}
```

after:
```json
{
 "slug": "ac-bin-c4s-jest-dostepny-po-instalacji-pa",
 "title": "Bin `c4s` jest dostępny po instalacji paczki `@inharness-ai/claude4spec` (`package.json` `bin.c4s` obok `bin.claude4spec`); `npx c4s --version` zwraca wersję paczki.",
 "kind": "requirement",
 "status": "active",
 "verifies": [],
 "tags": [
  "cli",
  "m11"
 ],
 "createdAt": "2026-07-07T09:29:14.000Z",
 "updatedAt": "2026-10-08T15:42:12.874Z"
}
```

## Context at 2.1.14

### [modules/m11-c4s/L2-domain.md] Domain > Packaging i distribution (anchor `m11pkg00`)

<after_change>
Paczka npm `@inharness-ai/claude4spec` niesie trzy biny:

- `claude4spec` — wejście serwera, bez subkomend; to jego uruchamia goła komenda `npx @inharness-ai/claude4spec`;
- `c4s` — CLI;
- `c4s-mcp` — most stdio↔HTTP dla klientów MCP bez transportu HTTP (M12 <section_ref anchor="mqupx1tx"/>).

Nazwa każdego bina poza domyślnym różni się od nazwy paczki, więc bez instalacji woła się go formą `npx -y -p @inharness-ai/claude4spec <bin>` — tak zewnętrzni agenci wołają CLI (`npx -y -p @inharness-ai/claude4spec c4s ...`), gdy preferują przepływ bez instalacji. Po instalacji paczki `c4s` jest dostępne jako `npx c4s`, a `npm i -g @inharness-ai/claude4spec` daje globalne `c4s` na `$PATH`.

**Artefakty dla external agentów powstają on-demand — wszystkie.** **Skille external NIE są generowane przy bootstrapie** — powstają **on-demand**, dwiema równorzędnymi drogami: (1) ręczny ZIP z elementu Agent skills na stronie ustawień (M22) — endpoint <inline_mention type="endpoint" slug="get-api-external-skills-bundle"/> zwraca bundle in-memory; (2) `c4s install-skills` (M11) — pisze foldery `SKILL.md` wprost do `<cwd>/.claude/skills` w repo kodu; tryb `fs-scoped`, bo podmiotem jest repo kodu, nie specyfikacja. **M11 owns komendę** `install-skills`, **M22 owns renderery / `FileSet`** (rdzeń `buildExternalSkillsBundle(ctx, selection?)`). Tą samą logiką jedzie konfiguracja połączenia MCP: wydaje ją na żądanie **M12 External MCP**, więc przy bootstrapie nie ląduje na dysku żaden artefakt integracyjny — ani skill, ani wpis konfiguracyjny. M11 nie owns żadnego pliku bootstrap'owego — `c4s` CLI jest **uzywany przez** skill `c4s-spec-reader` (M22). Treść skilla jest **CLI-only** (M22 <section_ref anchor="m22dread"/>): pełna tabela mapping tag↔CLI, `c4s resolve`, nawigacja po stronach i sekcjach oraz discovery — **bez** sekcji setupu MCP (rejestrację opisuje i wydaje na żądanie M12).
</after_change>

### [modules/m11-c4s/m11-c4s.md] M11 — c4s (CLI + MCP) > Cel (anchor `m11cel00`)

<after_change>
Agent pracujący w cudzym repozytorium kodu — bez własnego protokołu do naszego serwera, za to z shellem — potrzebuje przeczytać specyfikację, rozwinąć osadzony w niej znacznik do czytelnej treści i dopytać jej autora, gdy coś jest niejasne. Ten moduł daje mu jedno narzędzie wiersza poleceń, w którym każda z tych rzeczy jest wywołaniem **tej samej operacji tego samego serwera**, co widok w przeglądarce — innym kanałem, nie inną semantyką.

Obok czytania i rozwijania stron moduł udostępnia synchroniczną turę agenta: pytanie zadane z terminala wraca jako odpowiedź, zamiast zmuszać do zgadywania albo czekania. Nie uruchamia agenta samodzielnie i nie trzyma własnej kopii logiki — bez działającego serwera nie robi niczego, co dotyka treści specyfikacji.
</after_change>

### [modules/m11-c4s/m11-c4s.md] M11 — c4s (CLI + MCP) > Zależności (anchor `m11dep00`)

<after_change>
Wiersz poleceń jest transportem cudzych operacji i nie trzyma własnego magazynu ani własnego rejestru typów — wszystko, co wypisuje, powstaje po stronie serwera.

<tagged_list type="module-dependency" tags="m11"/>
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Cel (anchor `m12cel00`)

<after_change>
Agent MCP-aware — zewnętrzny edytor albo asystent kodu — dostaje ten sam katalog operacji na specyfikacji co agent wbudowany, natywnymi narzędziami zamiast wywołań powłoki: z typowanymi schematami, discovery i wyraźnym dispatchem. Powierzchnia jest montowana w procesie serwera aplikacji jako transport HTTP adresowany projektem w URL, więc wykonanie operacji zostaje przy serwerze, a kanał różni się wyłącznie adapterem wejściowym.

Ten sam proces zna typy wniesione przez pluginy, więc narzędzia typo-specyficzne są dla wołającego z zewnątrz dostępne na tych samych zasadach co dla agenta wbudowanego — z dokładnością do bramki profilu. Powierzchnia zewnętrzna nie jest podzbiorem odczytu: zawężenie do odczytu jest właściwością konkretnego profilu, nie kanału.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Zależności (anchor `m12dep00`)

<after_change>
Powierzchnia zewnętrzna jest wyłącznie rendererem cudzego katalogu operacji, więc każda jej krawędź wychodząca prowadzi do właściciela semantyki, którą ona renderuje.

<tagged_list type="module-dependency" tags="m12"/>
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > Wydawanie konfiguracji połączenia — decyzja (anchor `3j9mx7a9`)

<after_change>
**Konfigurację połączenia wydaje serwer, a nie skleja jej przeglądarka.** Regułę adresowania punktu montażu zna wyłącznie ten moduł — to on rozstrzyga, ile jest punktów montowania i którą posturą się je adresuje (<section_ref anchor="np1dkobs"/>). Sklejanie URL-a po stronie przeglądarki rozdwoiłoby tę regułę przy pierwszej zmianie kształtu adresu, a most stdio dokłada do niej formę wywołania paczki, która z UI nie wynika w ogóle. Wariant per-projekt idzie za precedensem diagnostyki stanu projekcji (M26 <section_ref anchor="m26api01"/>), bo konfiguracja połączenia jest własnością kontekstu projektu, nie procesu. Rodzina `_meta` trzyma trasę z dala od samego punktu montowania, który siedzi pod tym samym prefiksem projektu — sąsiedztwo `/mcp` i `/mcp-config` na jednym poziomie byłoby czytelne dla routera i mylące dla człowieka.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > Rejestracja w konfigu agenta (anchor `m12regst`)

<after_change>
User dodaje do konfigu klienta MCP (`.mcp.json` Claude Code, `~/.cursor/mcp.json` lub odpowiednika) wpis wskazujący **punkt montowania** w działającym serwerze.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > Rejestracja w konfigu agenta > Warianty wpisu (anchor `wtv48f3x`)

<after_change>
<single_element type="code-snippet" slug="wpis-serwera-c4s-reader"/>

Wariant stdio uruchamia bin `c4s-mcp` formą `npx -y -p @inharness-ai/claude4spec c4s-mcp` — reguła wywołania binów paczki stoi w <section_ref anchor="m11pkg00"/>; przy paczce zainstalowanej globalnie `command` to wprost `c4s-mcp`.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > Rejestracja w konfigu agenta > Serwer musi działać (anchor `ynffjhnh`)

<after_change>
**Serwer musi działać.** Oba warianty adresują proces serwera; przy jego braku połączenie nie wstaje, a most kończy czytelnym `SERVER_NOT_RUNNING` zamiast stdio EOF — parytet z regułą kanału `cli` (M11 <section_ref anchor="m11clirnd"/>). Auto-startu procesu w tle nie ma.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > Rejestracja w konfigu agenta > Źródło adresu i identyfikatora projektu (anchor `vd3eq6t0`)

<after_change>
**Adres serwera i `project-id` pochodzą z rejestru workspace'u** (M31 <section_ref anchor="fjsgq19h"/>). Każdy wariant — oba HTTP i argument `--url` mostu stdio — skleja się z `publicUrl` workspace'u i `id` projektu. `publicUrl` jest jedynym źródłem adresów wydawanych na zewnątrz (M31 <section_ref anchor="3l4ge8xa"/>); bez jawnie ustawionej wartości efektywną jest `http://localhost:<defaultPort>`. `project-id` to czytelny, niezmienny identyfikator projektu (M31 <section_ref anchor="2eyrx9es"/>), a nie skrót ścieżki. Selektor `--workspace` w tej powierzchni nie występuje — proces nasłuchujący pod tym adresem **należy do jednego workspace'u**, więc adres go rozstrzyga.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > Rejestracja w konfigu agenta > Gotowa instancja wpisu (anchor `8ylp9q31`)

<after_change>
Ta sekcja opisuje **kształt** wpisu. Gotową do skopiowania instancję — z `publicUrl` workspace'u i identyfikatorem projektu już wstrzykniętymi — user zabiera z elementu <section_ref anchor="5r1il5go"/>; treść powstaje na żądanie, więc nie ma pliku do edytowania ani do synchronizowania.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > Domain > `c4s-mcp` — most stdio↔HTTP (anchor `mqupx1tx`)

<after_change>
Bin `c4s-mcp` jest **głupim mostem, bez semantyki**: czyta ramki protokołu MCP ze stdin, przekazuje je na punkt montowania i odsyła odpowiedzi na stdout. Istnieje wyłącznie dla klientów, którzy nie obsługują transportu HTTP.

- **Most przekazuje ramki protokołu MCP, nie woła tras REST.** Adresuje punkt montowania z sekcji wyżej; nie tłumaczy narzędzi na endpointy, nie zna nazw operacji i nie interpretuje ładunku.
- **Zero własnego stanu.** Nie rozwiązuje projektu, nie otwiera db, nie zna profilu ani postury — rozstrzyga je serwer na podstawie URL-a i handshake'u. Jedynym argumentem mostu jest adres punktu montowania.
- **Zero własnych kodów błędów.** Jedyne, co most wnosi od siebie, to sygnał nieosiągalnego serwera; wszystko inne przechodzi przez niego niezmienione, łącznie z `tools/list_changed`.

- **Bin tej samej paczki, poza ścieżką operacji.** Most jest binem `c4s-mcp` paczki serwera (<section_ref anchor="m11pkg00"/>); powierzchnia MCP żyje w procesie serwera, więc cold start mostu i rozmiar jego zależności są nieistotne dla wydajności operacji.
</after_change>

### [modules/m12-external-mcp.md] M12 — External MCP > API (L4) (anchor `658f4tqj`)

<after_change>
**Powierzchnia**

<tagged_list type="endpoint" tags="m12" filter="and"/>

**DTO**

<tagged_list type="dto" tags="m12" filter="and"/>

**Montowanie:** `własny router: /api/projects/:id/_meta/mcp-config` — moduł nie wnosi typu encji rejestrowanego w hoście pluginów, więc host nie generuje mu CRUD-u pod `pathPrefix`; jedyna trasa jest montowana ręcznie i celowo nie sąsiaduje z samym punktem montowania powierzchni (<section_ref anchor="np1dkobs"/>).

**Odstępstwa:**

| Trasa | Od czego odstępstwo | Dlaczego |
|---|---|---|
| `GET /api/projects/:id/_meta/mcp-config` | `Prefiks projektu` | identyfikator projektu stoi w ścieżce — rodzina `_meta` adresuje projekt jawnie i jest udokumentowanym wyjątkiem od tej reguły |
| `GET /api/projects/:id/_meta/mcp-config` | `Ścieżki` | `_meta` jest zarezerwowaną przestrzenią diagnostyczno-konfiguracyjną, nie zasobem — segment nie jest rzeczownikiem w liczbie mnogiej |
</after_change>

## Conventions (layers touched: Domain/packaging, L4 API, L14 CLI)

### [layers/L4-api.md]  > L4 — API (anchor `lepbk8sv`)

<after_change>
> Grubość wire'u nad katalogiem operacji: metoda i ścieżka, kody statusu, koperta odpowiedzi, transporty specjalne i wyjątki od konwencji routingu — to, czego z samej operacji wyprowadzić się nie da.
</after_change>

### [layers/L4-api.md] L4 — API > Rola w systemie (anchor `4ekrg55r`)

<after_change>
Warstwa jest framework-shaped: jeden implementor podnosi powierzchnię żądań i powierzchnię połączeń trwałych, trzyma rejestr zdarzeń i egzekwuje wspólną kopertę odpowiedzi, a konsumenci wnoszą do niej trasy i deklarują wyłącznie to, czym od konwencji odchodzą. REST jest tu **jedną powierzchnią o dwóch konsumentach** — interfejsem i wołającym programowym — a nie powierzchnią zarezerwowaną dla UI: szerokość rekordu dla obu ustala ten sam parametr `select` operacji rdzenia, nie osobna rodzina tras i nie osobna polityka per powierzchnia.

Warstwa **nie** mówi, co można zrobić — to katalog operacji — ani jak długo żyje obiekt obsługujący żądanie, ani która przestrzeń stron odpowiada pod danym adresem. Fiksuje grubość wire'u i nic ponad to.
</after_change>

### [layers/L4-api.md] L4 — API > Module slice schema (anchor `pondhd6o`)

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

### [layers/L14-cli-commands.md]  > L14 — CLI Commands (anchor `1hlvn21h`)

<after_change>
> Konwencja, w której moduł wnosi swoje komendy do bin `c4s`. Warstwa fiksuje kształt opisu komendy i kontrakt kontrybucji; runtime CLI (dispatcher, resolver projektu/workspace, envelope błędów, formaty wyjścia, packaging) dostarcza implementor.

**Relacja do L3.** Komenda jest **renderowaniem** operacji z katalogu (`@layers/L3-spec-operations.md`), a nie osobnym bytem — semantyka, kody błędów i zasięg deklarowane są raz, w wierszu katalogu. L14 przeżywa jako osobna warstwa, bo niesie substancję **niewyprowadzalną** z operacji (tryb wykonania, flagi własne, exit codes, resolver projektu) i ma konsumenta spoza agenta: operatora maszyny. Dlatego bin `c4s` zawiera również komendy **poza** katalogiem — środowiskowe, których podmiotem nie jest zawartość specyfikacji.
</after_change>

### [layers/L14-cli-commands.md] L14 — CLI Commands > Module slice schema (anchor `flt0hm9r`)

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

None to close, none expected to open (stubs.json empty).

## Jobs

None.

## Not yet / Completes

None.

## Remove

- Form `npx -y @inharness-ai/claude4spec c4s ...` (m11pkg00 before) — replaced by `npx -y -p @inharness-ai/claude4spec <bin>`; any generated text/docs/snippets emitting the old form go.
- mcp-config stdio variant must use `npx -y -p @inharness-ai/claude4spec c4s-mcp --url …` (code-snippet wpis-serwera-c4s-reader, Wariant 3).
