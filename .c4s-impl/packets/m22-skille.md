# Packet — m22-skille (single portion p1-l2-l2)

- Window: 2.1.13 → 2.1.14 (delta); identity --project 'app-spec' --workspace 'default'
- Unit: m22-skille
- Goal: see scope (three shared renderer blocks: Server required / Stale address / quoted identity string; workspace absent from skill text; publicUrl trailing slashes trimmed at context build; c4s-spec-reader body rewritten; thread continuation + ask alias removed from body)
- Layers touched: L2 (Domain — M22 externalSkillsService renderers)
- Entities: 0; criteria (ac): 0 — criteria are the changed sections, named by anchor: 12
- Criteria (section anchors): m22dserv, m22dread, sws0pnrn, h4vfz91m, zvd7wn4t, c4s-spec-reader/~preamble, coz7bila, t8xj5140, foj9tbk4, dw3xlkgn, wy9a0mdr, a28ukbcn
- Jobs: none
- Conventions: none of the listed convention layers (L3/L4/L5/L7/L13/L14/L17) is touched by this unit's change
- Stubs: none to close, none expected
- Not yet: none. Completes: none.
- Remove (text removed from rendered skill, inside updated sections): thread-continuation line `c4s ask ... --thread <threadId>` and the "alias for c4s agent --ct ask" note in body section a28ukbcn; the `(project <id> in workspace <workspace>)` mention and the "Addressing is portable; execution is not" paragraph in coz7bila; old discovery bullet list in wy9a0mdr; "These commands are read-only..." paragraph in wy9a0mdr.
- Anchors checked: context read of m22-external-skills.md matches recipe anchors (m22cel00, m22dep00, m22dom00, m22dserv, m22dread, m22dimpl, 2a8tgd5w).


# CHANGE m22-external-skills.md (2.1.13→2.1.14, change: all)

## [m22dserv] M22 — External Skills > Domain (L2) > `externalSkillsService` — minimalna powierzchnia


Cztery metody: trzy renderery **sparametryzowane tożsamością projektu** + jeden **wspólny builder** `buildExternalSkillsBundle`. Skille są **portable, CLI-only clientami** — agent kopiuje je do **obcego repo kodu** bez lokalnego markera projektu-specki, gdzie walk-up od cwd zawodzi, często na maszynę bez lokalnego rejestru workspace'ów tego serwera. Dlatego renderer **wstrzykuje** do każdej komendy `c4s` jawny adres serwera i identyfikator projektu: `--server <publicUrl> --project <id>` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>). Brak fallbacku FS: gdy `c4s` niedostępne, skill zatrzymuje się i prosi usera o instalację (nigdy nie dotyka plików repo-specki wprost). Renderery **nie zmieniają samych komend** — wstrzykują adres i tożsamość do ich wywołań w treści skilla. Renderery przestają być `() → string` — biorą kontekst `ExternalSkillContext` o trzech polach:

- **`id`** — `project-id` z rejestru workspace'u (M31 <section_ref anchor="2eyrx9es"/>); trafia do każdej komendy jako `--project <id>`.
<before_change>- **`workspace`** — nazwa workspace'u, do którego należy projekt. `id` jest unikalny tylko w workspace'ie, więc para `(workspace, id)` jest pełną tożsamością wyrenderowanego zestawu. Do wywołań `c4s` nie trafia: przy `--server` workspace wyznacza sam serwer.
- **`publicUrl`** — efektywny adres publiczny workspace'u (M31 <section_ref anchor="3l4ge8xa"/>); trafia do każdej komendy jako `--server <publicUrl>`.</before_change>
<after_change>- **`workspace`** — nazwa workspace'u, do którego należy projekt. `id` jest unikalny tylko w workspace'ie, więc para `(workspace, id)` jest pełną tożsamością wyrenderowanego zestawu. Nie trafia ani do wywołań `c4s`, ani nigdzie indziej w treści skilla: przy `--server` workspace wyznacza sam serwer.
- **`publicUrl`** — efektywny adres publiczny workspace'u (M31 <section_ref anchor="3l4ge8xa"/>); trafia do każdej komendy jako `--server '<publicUrl>'`. Kontekst niesie go bez końcowych ukośników — obcinanych przy budowie kontekstu, więc adres z `/` i bez niego daje ten sam skill.</after_change>

Kontekst nie niesie sluga ani katalogu projektu (M31 <section_ref anchor="u4g9p66c"/>).

| Metoda | Sygnatura | Implementacja |
|--------|-----------|---------------|
| `buildExternalSkillsBundle` | `(ctx: ExternalSkillContext, selection?: SkillSlug[]) → FileSet` | **Wspólny rdzeń obu dróg** (CLI `c4s install-skills` + endpoint ZIP). Woła `renderSpecReaderSkill(ctx)` + `renderBriefImplementerSkill(ctx)` + `renderRefactorSkill(ctx)` (zawężone do `selection`, default wszystkie trzy) i zwraca **`FileSet`** — mapę `relPath → content` (`c4s-spec-reader/SKILL.md` → …, itd.). Czysta funkcja: **żadnego** zapisu na dysk ani side-effectu. Konsument decyduje o transporcie: CLI zapisuje FileSet do `<cwd>/.claude/skills` (bezwarunkowy overwrite), endpoint pakuje FileSet do ZIP in-memory. `ExternalSkillContext` (`id` / `workspace` / `publicUrl`) rozwiązywany przez konsumenta **przed** wywołaniem (CLI: rejestr albo argumenty `--server`/`--project`, <section_ref anchor="2x68r5a5"/>; endpoint: żywy `ProjectContext` i efektywny `publicUrl` workspace'u) |
| `renderSpecReaderSkill` | `(ctx: ExternalSkillContext) → string` | Renderer wstrzykujący `--server <publicUrl> --project <id>` do komend `c4s`. CLI-only (bez sekcji MCP setup). Wyjście deterministyczne z `ctx` — stabilne dla danego projektu. Dokładna treść: <section_ref anchor="m22dread"/> |
| `renderBriefImplementerSkill` | `(ctx: ExternalSkillContext) → string` | Renderer wstrzykujący `--server <publicUrl> --project <id>` do `c4s list-briefs`/`get-brief`/`create-patch` + `c4s mark-brief-implemented` (M11). CLI-only, bez fallbacku FS. Dokładna treść: <section_ref anchor="m22dimpl"/> |
| `renderRefactorSkill` | `(ctx: ExternalSkillContext) → string` | Renderer wstrzykujący `--server <publicUrl> --project <id>` do `c4s` reader/`ask`/`agent`. CLI-only, bez fallbacku FS. Dokładna treść: <section_ref anchor="2a8tgd5w"/> |

<after_change>**Bloki wspólne trzech rendererów.** Wszystkie trzy renderery składają treść z tych samych trzech elementów: sekcji „Server required — for every step” (stały tekst: każda komenda wymaga działającego serwera, `SERVER_NOT_RUNNING` → stop, odróżnienie `SERVER_NOT_RECOGNIZED` i `PROJECT_NOT_IN_WORKSPACE`), sekcji „Stale address — `PROJECT_NOT_IN_WORKSPACE`” (sparametryzowanej `publicUrl` i `id`: adres wypalony w skillu jest nieaktualny → stop i prośba o regenerację) oraz ciągu tożsamości `--server '<publicUrl>' --project '<id>'` doklejanego do każdej komendy. Zmiana któregokolwiek z nich zmienia wszystkie trzy skille naraz, więc dotyczy wszystkich trzech stron z dokładną treścią (<section_ref anchor="m22dread"/>, <section_ref anchor="m22dimpl"/>, <section_ref anchor="2a8tgd5w"/>).</after_change>
**FileSet jako deterministyczny rdzeń:** wyjście `buildExternalSkillsBundle` jest **czystą funkcją `ExternalSkillContext` + `selection`** — ten sam `ctx` daje ten sam FileSet, niezależnie od drogi (ZIP czy CLI). Bez hash-diff, bez managed-zone markerów, bez porównania z plikiem na dysku — idempotencja przeniesiona do konsumenta: CLI **nadpisuje bezwarunkowo** `.claude/skills` (user, który chce custom, trzyma własny skill pod inną nazwą; nadpisany jest tylko zestaw managed), endpoint zawsze zwraca świeży ZIP. Zmiana adresu publicznego workspace'u (np. przeniesienie serwera za proxy) → inny `ctx` → inny FileSet przy najbliższym pobraniu/instalacji — poprawne odświeżenie na żądanie, bez side-effectu bootstrapu. `id` jest niezmienny (M31 <section_ref anchor="fzno8pd4"/>), więc przeniesienie katalogu projektu ani zmiana jego nazwy kontekstu nie zmieniają.

**Portable ≠ commitowalny-verbatim.** Wyrenderowany `SKILL.md` niesie adres i tożsamość **konkretnego** projektu-specki (`publicUrl`, `id`), więc jest przeznaczony do **skopiowania do repo kodu tego projektu** (ręcznie z ZIP albo przez `c4s install-skills` do `.claude/skills`), a nie do bycia repo-agnostycznym plikiem. Kopia w `.claude/skills/` repo-kodu żyje własnym życiem; kolejny „Download ZIP" / `c4s install-skills` odświeża ją na aktualny `ctx`. To świadome odwrócenie wcześniejszego kontraktu „commitowalny bez abs-path / walk-up od cwd" — walk-up zawodzi u korzenia obcego repo, więc adres i tożsamość muszą być jawne.


**Granica wobec M37 — zapis na dysk zostaje, i to nie jest niespójność.** Rejestr skilli wewnętrznych (M37) rozstrzygnął dokładnie odwrotnie: **zero materializacji**, treść skilla wydawana z pamięci operacją <inline_mention type="mcp-tool" slug="skill-tools-load-skill-file"/> (<section_ref anchor="b58luon6"/>). Tamtej decyzji **nie stosuje się tu przez analogię**, bo różni je konsument, nie gust — ale kryterium jest jedno i nie jest nim zewnętrzność agenta: rozstrzyga **żywy kanał do procesu**. Kto kanał ma, czyta z tamtego rejestru i **nic nie jest materializowane** — dotyczy to zarówno modelu pracującego w naszej turze, jak i obcego orkiestratora, który połączył się z tym procesem z zewnątrz. Kto kanału nie ma — agent u korzenia obcego repo kodu, gdzie walk-up zawodzi, a `c4s` może nie być zainstalowane — dostaje plik, bo plik jest tam jedynym nośnikiem; dlatego `FileSet` i jego zapis do `.claude/skills` repo kodu pozostaje esencją M22. Granica jest przez to ostrzejsza, nie luźniejsza: przebiega po obecności kanału, którą da się sprawdzić, a nie po tym, czyj agent pyta. Wspólna zostaje jedynie konwencja formatu — zero współdzielonego kodu.

## [m22dread] M22 — External Skills > Domain (L2) > Skill 1: `c4s-spec-reader/SKILL.md`


<before_change>Skill czytelnika specki: mapping XML tag ↔ subkomenda `c4s` (5 wierszy), `c4s resolve <file.md>`, **nawigacja po stronach i sekcjach** (ścieżka `search-pages` → trafienie niesie już `anchor` → `get-sections --anchors a,b,c` batchem, plus `get-page-outline` jako spis treści strony, `list-pages` i `get-page`), discovery (`c4s catalog` / `describe` / `list-tags` / `list-entities` / `get-entities` / `get-field-content` / `search-entities` / `resolve-identity` / `check-consistency`), krótka wzmianka o `c4s ask "<pytanie>"` (peer-consult bez flag `--ct`/`--brief`, wymaga działającego serwera). **CLI-only** — brak sekcji MCP setup. **Portable** — wszystkie komendy `c4s` niosą wstrzyknięte `--server <publicUrl> --project <id>` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>) — adres serwera i identyfikator projektu wprost, bez odczytu lokalnego rejestru; sekcja symlink przeredagowana pod jawną tożsamość (walk-up nie jest już główną ścieżką).</before_change>
<after_change>Skill czytelnika specki: wstęp wiążący skill z jednym projektem-specką (tożsamość wstrzyknięta, nie wyprowadzana z cwd; bez fallbacku FS), wspólne sekcje **Server required** i **Stale address** (<section_ref anchor="m22dserv"/>), mapping XML tag ↔ subkomenda `c4s` (5 wierszy), `c4s resolve <file.md>` jako wygoda renderowania pliku, który agent już ma — nie sposób czytania stron specki, **nawigacja po stronach i sekcjach** (ścieżka `search-pages` → trafienie niesie już `anchor` → `get-sections --anchors a,b,c` batchem, plus `get-page-outline` jako spis treści strony, `list-pages` i `get-page`), discovery (`c4s catalog` jako punkt wejścia / `describe` / `list-tags` / `list-entities` / `get-entities` / `get-field-content` / `search-entities` / `resolve-identity` / `check-consistency`) z tabelą komenda CLI → operacja odczytu (piętnaście operacji discovery), krótka sekcja o `c4s ask "<pytanie>"` (pełna tura agenta, wymaga działającego serwera) i sekcja błędów (nieaktualny adres, problem po stronie serwera specki). **CLI-only** — brak sekcji MCP setup. **Portable** — wszystkie komendy `c4s` niosą wstrzyknięte `--server '<publicUrl>' --project '<id>'` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>) — adres serwera i identyfikator projektu wprost, bez odczytu lokalnego rejestru.</after_change>

Dokładna, wdrożeniowa treść pliku (frontmatter + pełny body, emitowana przez `renderSpecReaderSkill()` 1:1): [`@modules/m22-external-skills/c4s-spec-reader.md`](modules/m22-external-skills/c4s-spec-reader.md).


# CONTEXT m22-external-skills.md @2.1.14 offset 1 limit 7

## [m22cel00] M22 — External Skills > Cel

<after_change>
Użytkownik chce, żeby agent pracujący w jego repozytorium kodu umiał współpracować ze specyfikacją leżącą w zupełnie innym repozytorium — czytać ją, wdrażać opisane w niej zmiany i zgłaszać rozjazd między nią a kodem. Ten moduł renderuje na żądanie trzy niezależne, składalne instrukcje dla takiego agenta, które użytkownik zabiera do repozytorium kodu: pobierając archiwum z ustawień albo instalując je z terminala. Żadna z tych dróg nie jest główna — to alternatywa dla dwóch person, nie ścieżka i jej obejście.

Instrukcje są przenośne i wskazują macierzystą specyfikację **jawnie**, bo w obcym repozytorium nie ma po czym jej rozpoznać. Cały dostęp do treści idzie przez wiersz poleceń; gdy go brak, agent zatrzymuje się i prosi o instalację, zamiast sięgać do dysku na oślep. Moduł nie generuje niczego samoczynnie przy zakładaniu projektu — wyłącznie wtedy, gdy ktoś o to poprosi. Instrukcje dla agenta wbudowanego, utrzymywane w samej specyfikacji, nie są jego zadaniem — tu podmiotem jest wyłącznie repozytorium kodu.
</after_change>

## [m22dep00] M22 — External Skills > Zależności

<after_change>
Ten moduł generuje na żądanie assety dla agentów pracujących w cudzych repozytoriach kodu — nie zapisuje niczego w obrębie specyfikacji, a tożsamość projektu, publiczny adres serwera i formaty, które w nie wstrzykuje, pochodzą z zewnątrz.

<tagged_list type="module-dependency" tags="m22"/>
</after_change>

## [m22dom00] M22 — External Skills > Domain (L2)

<after_change></after_change>

## [m22dserv] M22 — External Skills > Domain (L2) > `externalSkillsService` — minimalna powierzchnia

<after_change>
Cztery metody: trzy renderery **sparametryzowane tożsamością projektu** + jeden **wspólny builder** `buildExternalSkillsBundle`. Skille są **portable, CLI-only clientami** — agent kopiuje je do **obcego repo kodu** bez lokalnego markera projektu-specki, gdzie walk-up od cwd zawodzi, często na maszynę bez lokalnego rejestru workspace'ów tego serwera. Dlatego renderer **wstrzykuje** do każdej komendy `c4s` jawny adres serwera i identyfikator projektu: `--server <publicUrl> --project <id>` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>). Brak fallbacku FS: gdy `c4s` niedostępne, skill zatrzymuje się i prosi usera o instalację (nigdy nie dotyka plików repo-specki wprost). Renderery **nie zmieniają samych komend** — wstrzykują adres i tożsamość do ich wywołań w treści skilla. Renderery przestają być `() → string` — biorą kontekst `ExternalSkillContext` o trzech polach:

- **`id`** — `project-id` z rejestru workspace'u (M31 <section_ref anchor="2eyrx9es"/>); trafia do każdej komendy jako `--project <id>`.
- **`workspace`** — nazwa workspace'u, do którego należy projekt. `id` jest unikalny tylko w workspace'ie, więc para `(workspace, id)` jest pełną tożsamością wyrenderowanego zestawu. Nie trafia ani do wywołań `c4s`, ani nigdzie indziej w treści skilla: przy `--server` workspace wyznacza sam serwer.
- **`publicUrl`** — efektywny adres publiczny workspace'u (M31 <section_ref anchor="3l4ge8xa"/>); trafia do każdej komendy jako `--server '<publicUrl>'`. Kontekst niesie go bez końcowych ukośników — obcinanych przy budowie kontekstu, więc adres z `/` i bez niego daje ten sam skill.

Kontekst nie niesie sluga ani katalogu projektu (M31 <section_ref anchor="u4g9p66c"/>).

| Metoda | Sygnatura | Implementacja |
|--------|-----------|---------------|
| `buildExternalSkillsBundle` | `(ctx: ExternalSkillContext, selection?: SkillSlug[]) → FileSet` | **Wspólny rdzeń obu dróg** (CLI `c4s install-skills` + endpoint ZIP). Woła `renderSpecReaderSkill(ctx)` + `renderBriefImplementerSkill(ctx)` + `renderRefactorSkill(ctx)` (zawężone do `selection`, default wszystkie trzy) i zwraca **`FileSet`** — mapę `relPath → content` (`c4s-spec-reader/SKILL.md` → …, itd.). Czysta funkcja: **żadnego** zapisu na dysk ani side-effectu. Konsument decyduje o transporcie: CLI zapisuje FileSet do `<cwd>/.claude/skills` (bezwarunkowy overwrite), endpoint pakuje FileSet do ZIP in-memory. `ExternalSkillContext` (`id` / `workspace` / `publicUrl`) rozwiązywany przez konsumenta **przed** wywołaniem (CLI: rejestr albo argumenty `--server`/`--project`, <section_ref anchor="2x68r5a5"/>; endpoint: żywy `ProjectContext` i efektywny `publicUrl` workspace'u) |
| `renderSpecReaderSkill` | `(ctx: ExternalSkillContext) → string` | Renderer wstrzykujący `--server <publicUrl> --project <id>` do komend `c4s`. CLI-only (bez sekcji MCP setup). Wyjście deterministyczne z `ctx` — stabilne dla danego projektu. Dokładna treść: <section_ref anchor="m22dread"/> |
| `renderBriefImplementerSkill` | `(ctx: ExternalSkillContext) → string` | Renderer wstrzykujący `--server <publicUrl> --project <id>` do `c4s list-briefs`/`get-brief`/`create-patch` + `c4s mark-brief-implemented` (M11). CLI-only, bez fallbacku FS. Dokładna treść: <section_ref anchor="m22dimpl"/> |
| `renderRefactorSkill` | `(ctx: ExternalSkillContext) → string` | Renderer wstrzykujący `--server <publicUrl> --project <id>` do `c4s` reader/`ask`/`agent`. CLI-only, bez fallbacku FS. Dokładna treść: <section_ref anchor="2a8tgd5w"/> |

**Bloki wspólne trzech rendererów.** Wszystkie trzy renderery składają treść z tych samych trzech elementów: sekcji „Server required — for every step” (stały tekst: każda komenda wymaga działającego serwera, `SERVER_NOT_RUNNING` → stop, odróżnienie `SERVER_NOT_RECOGNIZED` i `PROJECT_NOT_IN_WORKSPACE`), sekcji „Stale address — `PROJECT_NOT_IN_WORKSPACE`” (sparametryzowanej `publicUrl` i `id`: adres wypalony w skillu jest nieaktualny → stop i prośba o regenerację) oraz ciągu tożsamości `--server '<publicUrl>' --project '<id>'` doklejanego do każdej komendy. Zmiana któregokolwiek z nich zmienia wszystkie trzy skille naraz, więc dotyczy wszystkich trzech stron z dokładną treścią (<section_ref anchor="m22dread"/>, <section_ref anchor="m22dimpl"/>, <section_ref anchor="2a8tgd5w"/>).

**FileSet jako deterministyczny rdzeń:** wyjście `buildExternalSkillsBundle` jest **czystą funkcją `ExternalSkillContext` + `selection`** — ten sam `ctx` daje ten sam FileSet, niezależnie od drogi (ZIP czy CLI). Bez hash-diff, bez managed-zone markerów, bez porównania z plikiem na dysku — idempotencja przeniesiona do konsumenta: CLI **nadpisuje bezwarunkowo** `.claude/skills` (user, który chce custom, trzyma własny skill pod inną nazwą; nadpisany jest tylko zestaw managed), endpoint zawsze zwraca świeży ZIP. Zmiana adresu publicznego workspace'u (np. przeniesienie serwera za proxy) → inny `ctx` → inny FileSet przy najbliższym pobraniu/instalacji — poprawne odświeżenie na żądanie, bez side-effectu bootstrapu. `id` jest niezmienny (M31 <section_ref anchor="fzno8pd4"/>), więc przeniesienie katalogu projektu ani zmiana jego nazwy kontekstu nie zmieniają.

**Portable ≠ commitowalny-verbatim.** Wyrenderowany `SKILL.md` niesie adres i tożsamość **konkretnego** projektu-specki (`publicUrl`, `id`), więc jest przeznaczony do **skopiowania do repo kodu tego projektu** (ręcznie z ZIP albo przez `c4s install-skills` do `.claude/skills`), a nie do bycia repo-agnostycznym plikiem. Kopia w `.claude/skills/` repo-kodu żyje własnym życiem; kolejny „Download ZIP" / `c4s install-skills` odświeża ją na aktualny `ctx`. To świadome odwrócenie wcześniejszego kontraktu „commitowalny bez abs-path / walk-up od cwd" — walk-up zawodzi u korzenia obcego repo, więc adres i tożsamość muszą być jawne.


**Granica wobec M37 — zapis na dysk zostaje, i to nie jest niespójność.** Rejestr skilli wewnętrznych (M37) rozstrzygnął dokładnie odwrotnie: **zero materializacji**, treść skilla wydawana z pamięci operacją <inline_mention type="mcp-tool" slug="skill-tools-load-skill-file"/> (<section_ref anchor="b58luon6"/>). Tamtej decyzji **nie stosuje się tu przez analogię**, bo różni je konsument, nie gust — ale kryterium jest jedno i nie jest nim zewnętrzność agenta: rozstrzyga **żywy kanał do procesu**. Kto kanał ma, czyta z tamtego rejestru i **nic nie jest materializowane** — dotyczy to zarówno modelu pracującego w naszej turze, jak i obcego orkiestratora, który połączył się z tym procesem z zewnątrz. Kto kanału nie ma — agent u korzenia obcego repo kodu, gdzie walk-up zawodzi, a `c4s` może nie być zainstalowane — dostaje plik, bo plik jest tam jedynym nośnikiem; dlatego `FileSet` i jego zapis do `.claude/skills` repo kodu pozostaje esencją M22. Granica jest przez to ostrzejsza, nie luźniejsza: przebiega po obecności kanału, którą da się sprawdzić, a nie po tym, czyj agent pyta. Wspólna zostaje jedynie konwencja formatu — zero współdzielonego kodu.</after_change>

## [m22dread] M22 — External Skills > Domain (L2) > Skill 1: `c4s-spec-reader/SKILL.md`

<after_change>
Skill czytelnika specki: wstęp wiążący skill z jednym projektem-specką (tożsamość wstrzyknięta, nie wyprowadzana z cwd; bez fallbacku FS), wspólne sekcje **Server required** i **Stale address** (<section_ref anchor="m22dserv"/>), mapping XML tag ↔ subkomenda `c4s` (5 wierszy), `c4s resolve <file.md>` jako wygoda renderowania pliku, który agent już ma — nie sposób czytania stron specki, **nawigacja po stronach i sekcjach** (ścieżka `search-pages` → trafienie niesie już `anchor` → `get-sections --anchors a,b,c` batchem, plus `get-page-outline` jako spis treści strony, `list-pages` i `get-page`), discovery (`c4s catalog` jako punkt wejścia / `describe` / `list-tags` / `list-entities` / `get-entities` / `get-field-content` / `search-entities` / `resolve-identity` / `check-consistency`) z tabelą komenda CLI → operacja odczytu (piętnaście operacji discovery), krótka sekcja o `c4s ask "<pytanie>"` (pełna tura agenta, wymaga działającego serwera) i sekcja błędów (nieaktualny adres, problem po stronie serwera specki). **CLI-only** — brak sekcji MCP setup. **Portable** — wszystkie komendy `c4s` niosą wstrzyknięte `--server '<publicUrl>' --project '<id>'` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>) — adres serwera i identyfikator projektu wprost, bez odczytu lokalnego rejestru.

Dokładna, wdrożeniowa treść pliku (frontmatter + pełny body, emitowana przez `renderSpecReaderSkill()` 1:1): [`@modules/m22-external-skills/c4s-spec-reader.md`](modules/m22-external-skills/c4s-spec-reader.md).
</after_change>

## [m22dimpl] M22 — External Skills > Domain (L2) > Skill 2: `c4s-brief-implementer/SKILL.md`

<after_change>
Skill implementera briefów: workflow **discover → read → implement → feedback**. Kluczowe kroki (pełny opis w treści skilla poniżej):

1. **Discover** — `c4s list-briefs --server <publicUrl> --project <id> [--status pending]` (stronicowana lista, M11 <section_ref anchor="m11dcmds"/>). **Gdy niejasne który brief implementować** (N kandydatów / brak jawnego wskazania) → skill **PYTA usera**, nie zgaduje (analog quality-rule „Ask, don't assume").
2. **Read jako self-contained input** — `c4s get-brief <brief-path> --server <publicUrl> --project <id>`; body z entity snapshots, section diffs, narracją i AC — wszystko, czego trzeba do wdrożenia. Skill nie wykłada struktury frontmattera briefu (to domena producenta). **NIE czyta głównej specki** (M21 <section_ref anchor="m21bauth"/>).
3. **Implement** — standardowy code flow w docelowym repo. **Gdy brief niejasny** → preferowana synchroniczna eskalacja `c4s agent "…" --ct brief --brief <slug>.md` (kontekst briefu + release diff) albo `c4s ask "…"` (read-only peer-consult aktualnej specki); wymaga `c4s` + serwera. Literalne stringi UI wdraża po angielsku (pole stałe `Język stringów`, <section_ref anchor="tehej2wz"/>) także wtedy, gdy brief podaje je po polsku, i zgłasza to patchem (krok 4). <todo comment="Treść skilla c4s-brief-implementer.md (emitowana 1:1) nie niesie tej reguły — zdecydować, czy ją tam dopisać."/>
4. **Feedback loop (patches)** — przy wykrytym drifcie zgłasza patch przez `c4s create-patch --brief <brief-path> --desc <s>` (`type: patch` / `applied: false`; plik powstaje po stronie serwera, katalog korzenia `patches` leniwie — M11 <section_ref anchor="m11dcmds"/>). Format i lifecycle konsumowane przez M23.
5. **Mark implemented** — po realnie skończonej implementacji ustawia `implemented: true` przez `c4s mark-brief-implemented` (owija <inline_mention type="endpoint" slug="patch-api-artifacts-kind-path-frontmatter"/>, server-required, M21 <section_ref anchor="xqksf67f"/>), tylko gdy naprawdę gotowe. **Flagi patcha skill nie dotyka** — `applied` patcha przestawia człowiek w UI, bo M23 nie ma dla niej kanału agentowego ani komendy CLI (<section_ref anchor="m23fmt01"/>).

Explicit akapit: skill jest **CLI-only** — dostęp do briefów i patchy wyłącznie przez `c4s`, a wszystkie cztery komendy (`list-briefs`, `get-brief`, `create-patch`, `mark-brief-implemented`) są `server-delegating`. Portable jest **adresowanie** (`--server <publicUrl> --project <id>` niesie adres serwera i identyfikator projektu wprost, bez lokalnego odczytu rejestru, więc działa z każdej maszyny, która dosięga `publicUrl`), nie wykonanie. Brak `c4s` **albo** `SERVER_NOT_RUNNING` (pod `publicUrl` nic nie odpowiada) → **STOP** + prośba do usera o instalację `c4s` / uruchomienie serwera; skill nigdy nie dotyka plików repo-specki wprost i nie startuje serwera sam.

Dokładna, wdrożeniowa treść pliku (frontmatter + pełny body, emitowana przez `renderBriefImplementerSkill()` 1:1): [`@modules/m22-external-skills/c4s-brief-implementer.md`](modules/m22-external-skills/c4s-brief-implementer.md).
</after_change>

## [2a8tgd5w] M22 — External Skills > Domain (L2) > Skill 3: `c4s-refactor/SKILL.md`

<after_change>
Skill **drift-routera spec↔kod**. Input = **topic**; brak topicu → skill prosi o zawężenie (nie skanuje całej specki). Workflow: czyta speckę (`c4s` reader — **CLI-only**, brak `c4s` → STOP, bez fallbacku FS), analizuje kod w repo agenta, klasyfikuje drift w cztery kubełki (**spec-fix / code-fix / both / none**; `none` → „in sync" + STOP), po czym routuje:

1. **Path 1 (spec-fix)** — `c4s ask "<…>"` → read-only plan (peer-consult, zapisuje `threadId`); egzekucję planu robi ktoś inny, skill go NIE aplikuje.
2. **Path 2 (code-fix)** — skill **sam pisze ciało briefu** i zapisuje je jednym `c4s create-brief --body-file <plik.md>` (M21 <section_ref anchor="xqksf67f"/>), bez tury pośredniej. Powstaje **brief wobec stanu bieżącego** (okno otwarte do teraz: `from` = latest, `to_release: null` — M21 <section_ref anchor="m21fmtct"/>), który podnosi `c4s-brief-implementer`. Kształt jest wymuszony podziałem kontekstu: to skill przeczytał kod i speckę i zna pliki, linie oraz slugi AC, a tura w wątku `brief` operuje na `release_diff` i bieżącego stanu nie widzi (M21 <section_ref anchor="m21bauth"/>) — oddanie jej tego kontekstu w jednym promptcie nie dodałoby jakości, tylko punkt awarii. `c4s agent --ct brief` skill **nie woła w żadnej ze ścieżek**; precedens kształtu to `c4s create-patch`, który też przyjmuje intencję wołającego, a nie wynik tury.

Skill kończy **Report + STOP** — czysta analiza + routing, bez egzekucji; hand-off do człowieka i/lub `c4s-brief-implementer`. **Twarda** zależność od `c4s` CLI + działającego serwera dla **obu** ścieżek (kontrast z opcjonalnym `c4s` w implementerze). Body **portable, CLI-only**: komendy `c4s` (reader/`ask`/`agent`) niosą wstrzyknięte `--server <publicUrl> --project <id>` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>); czytanie specki wyłącznie przez `c4s` (brak → STOP, bez fallbacku FS); bez odwołań do konkretnego layoutu kodu (mowa o „code in your repository", nie `src/`).

Dokładna, wdrożeniowa treść pliku (frontmatter + pełny body, emitowana przez `renderRefactorSkill()` 1:1): [`@modules/m22-external-skills/c4s-refactor.md`](modules/m22-external-skills/c4s-refactor.md).
</after_change>


# CHANGE c4s-spec-reader.md (2.1.13→2.1.14, change: all)

## [sws0pnrn] c4s-spec-reader > Server required — for every step

<after_change>
Every `c4s` command in this skill talks to a running `npx @inharness-ai/claude4spec` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.

`SERVER_NOT_RUNNING` **(exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.

Two neighbouring codes mean something else, and starting a server will not fix either: `SERVER_NOT_RECOGNIZED` (something is listening, but it is not claude4spec) and `PROJECT_NOT_IN_WORKSPACE` (the server is fine, but it does not serve this skill's project — see "Stale address" below). Report those as they are.
</after_change>

## [h4vfz91m] c4s-spec-reader > Stale address — `PROJECT_NOT_IN_WORKSPACE`

<after_change>
`PROJECT_NOT_IN_WORKSPACE` means the server at `<publicUrl>` does not serve the project `<id>` — the address baked into this skill is stale. **Stop and ask the user to regenerate this skill** (Settings → External Integrations, or `c4s install-skills`). Do not guess another `--project` or `--server` value.

</after_change>

## [zvd7wn4t] c4s-spec-reader > Errors

<after_change>
If `c4s` reports `PROJECT_NOT_IN_WORKSPACE` or `PROJECT_ID_NOT_FOUND`, this skill's baked-in address (`--server '<publicUrl>' --project '<id>'`) is stale — stop and ask the user to regenerate the skill (see "Stale address" above). If `c4s ask` reports the server isn't recognized as a claude4spec server, or that the project failed to build (`PROJECT_BUILD_FAILED`), that's a problem on the spec repo/server side — report it to the user; don't try to fix the spec repo from here.
</after_change>

## [~preamble]  > (preamble)

<before_change>Renderer `renderSpecReaderSkill(ctx)` (<section_ref anchor="m22dserv"/>) emituje frontmatter + body poniżej jako wpis `c4s-spec-reader/SKILL.md` w FileSet (rdzeń `buildExternalSkillsBundle`), **podstawiając** wartości `ExternalSkillContext` w miejsce placeholderów: `<publicUrl>` → `ctx.publicUrl`, `<id>` → `ctx.id`, `<workspace>` → `ctx.workspace`. Ta strona jest źródłem prawdy dla renderera — zmiana treści skilla zaczyna się tutaj. **Portable adresowanie, nie wykonanie:** każda komenda `c4s` niesie wstrzyknięte `--server <publicUrl> --project <id>` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>), bo skill jest kopiowany do repo kodu bez `.claude4spec/`, gdzie walk-up od cwd zawodzi — adres serwera i identyfikator projektu idą wprost, bez odczytu lokalnego rejestru, więc komendy działają z każdej maszyny, która dosięga `publicUrl`. Samo czytanie specyfikacji jest renderowaniem operacji katalogu, więc wykonanie należy do procesu serwera (<section_ref anchor="l3locus0"/>): cały body zakłada działający serwer, także dla komend `catalog` / `describe` / `get-page` / `search-pages` / `get-sections` / `get-entities` / `check-consistency`. Body opisuje `c4s ask "<pytanie>"` **bez** flag `--ct`/`--brief`: `c4s ask` jest aliasem `c4s agent --ct ask`, hardcoduje kontekst `ask` i odrzuca jawne selektory kontekstu (M11 <section_ref anchor="3ka5h2zq"/>). To peer-consult read-only, wymaga działającego serwera.</before_change>
<after_change>Renderer `renderSpecReaderSkill(ctx)` (<section_ref anchor="m22dserv"/>) emituje frontmatter + body poniżej jako wpis `c4s-spec-reader/SKILL.md` w FileSet (rdzeń `buildExternalSkillsBundle`), **podstawiając** wartości `ExternalSkillContext` w miejsce placeholderów: `<publicUrl>` → `ctx.publicUrl`, `<id>` → `ctx.id`. Pole `ctx.workspace` do treści skilla nie trafia. Sekcje `Server required — for every step` (<section_ref anchor="sws0pnrn"/>) i `Stale address` (<section_ref anchor="h4vfz91m"/>) oraz ciąg tożsamości w komendach to bloki wspólne trzech skilli M22 (<section_ref anchor="m22dserv"/>). Ta strona jest źródłem prawdy dla renderera — zmiana treści skilla zaczyna się tutaj. **Portable adresowanie, nie wykonanie:** każda komenda `c4s` niesie wstrzyknięte `--server '<publicUrl>' --project '<id>'` (wartości w apostrofach; M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>), bo skill jest kopiowany do repo kodu bez `.claude4spec/`, gdzie walk-up od cwd zawodzi — adres serwera i identyfikator projektu idą wprost, bez odczytu lokalnego rejestru, więc komendy działają z każdej maszyny, która dosięga `publicUrl`. Samo czytanie specyfikacji jest renderowaniem operacji katalogu, więc wykonanie należy do procesu serwera (<section_ref anchor="l3locus0"/>): cały body zakłada działający serwer, także dla komend `catalog` / `describe` / `get-page` / `search-pages` / `get-sections` / `get-entities` / `check-consistency`. Body opisuje `c4s ask "<pytanie>"` **bez** flag `--ct`/`--brief`: `c4s ask` jest aliasem `c4s agent --ct ask`, hardcoduje kontekst `ask` i odrzuca jawne selektory kontekstu (M11 <section_ref anchor="3ka5h2zq"/>). To peer-consult read-only, wymaga działającego serwera.</after_change>

Frontmatter:

```yaml
---
name: c4s-spec-reader
<before_change>description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Resolves entity slugs to full data via the c4s CLI. Use when working in a repository whose pages reference these tags.</before_change>
<after_change>description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Use when working in a repository whose pages/ contain these tags or whose .claude4spec/ directory exists. Resolves entity slugs to full data via the c4s CLI.</after_change>
---
```

Body:

## [coz7bila]  > c4s-spec-reader


<before_change>This skill resolves entities from a claude4spec specification that lives in **another repository** (the spec repo), while you work in your **code repository**. Pages (`*.md`) reference entities stored in the spec's database through XML tags; this skill teaches you how to resolve them from here.</before_change>
<after_change>This skill is bound to one claude4spec specification project — every `c4s` command below carries its identity (`--server '<publicUrl>' --project '<id>'`), so it works from any cwd, including a foreign code repo whose pages reference this spec's entities. Do NOT `cd` into the spec repo; the identity is baked in, not derived from cwd.</after_change>

<before_change>Every `c4s` command below carries `--server <publicUrl> --project <id>` — the address of the spec project's server and the project's id (project `<id>` in workspace `<workspace>`), injected when this skill was generated. This is required because a bare `c4s` searches upward from your cwd for the spec project's local marker (absent in your code repo); with `--server` and `--project` a command needs neither that marker nor a local registry, so it works from any directory, on any machine that can reach `<publicUrl>`.
**Addressing is portable; execution is not.** `c4s` is an HTTP client of the spec project's server: it sends every read to the running `npx @inharness-ai/claude4spec` server at `<publicUrl>`, which owns the specification. Every command in this skill needs that server up — there is no offline mode and no local database access. If `c4s` is not installed, or a command returns `SERVER_NOT_RUNNING`, **stop** and ask the user to install `c4s` / start the server. Do not answer from guesswork, do not fall back to `Read`/`Grep` over the spec repo's files, and do not start the server yourself. `PROJECT_NOT_IN_WORKSPACE` means the server at `<publicUrl>` does not serve project `<id>` — this skill's address is stale; stop and ask the user to regenerate the skill.</before_change>
<after_change>**CLI-only — no filesystem fallback.** Every command below goes through `c4s`. If `c4s` isn't installed, STOP and ask the user to install it — never read the spec repo's pages or entity files directly.</after_change>

## [t8xj5140] c4s-spec-reader > Resolving a tag


<before_change>Install `claude4spec` (Node 20+) and use the `c4s` CLI. Subcommand names match XML tag names 1:1. Every command takes `--server <publicUrl> --project <id>` (shown in full below — the values are baked into this skill).</before_change>
<after_change>Install `claude4spec` (Node 20+) and use the `c4s` CLI. Subcommand names match XML tag names 1:1 — append `--server '<publicUrl>' --project '<id>'` to every command below.</after_change>

| XML tag | CLI equivalent |
|---------|----------------|
<before_change>| `<inline_mention type="endpoint" slug="X"/>` | `c4s inline_mention --type endpoint --slug X --server <publicUrl> --project <id>` |
| `<single_element type="dto" slug="X"/>` | `c4s single_element --type dto --slug X --server <publicUrl> --project <id>` |
| `<element_list type="endpoint" slugs="a,b,c"/>` | `c4s element_list --type endpoint --slugs a,b,c --server <publicUrl> --project <id>` |
| `<tagged_list type="dto" tags="auth" filter="and"/>` | `c4s tagged_list --type dto --tags auth --filter and --server <publicUrl> --project <id>` |
| `<tagged_list_mixed tags="public"/>` | `c4s tagged_list_mixed --tags public --server <publicUrl> --project <id>` |</before_change>
<after_change>| `<inline_mention type="endpoint" slug="X"/>` | `c4s inline_mention --type endpoint --slug X --server '<publicUrl>' --project '<id>'` |
| `<single_element type="dto" slug="X"/>` | `c4s single_element --type dto --slug X --server '<publicUrl>' --project '<id>'` |
| `<element_list type="endpoint" slugs="a,b,c"/>` | `c4s element_list --type endpoint --slugs a,b,c --server '<publicUrl>' --project '<id>'` |
| `<tagged_list type="dto" tags="auth" filter="and"/>` | `c4s tagged_list --type dto --tags auth --filter and --server '<publicUrl>' --project '<id>'` |
| `<tagged_list_mixed tags="public"/>` | `c4s tagged_list_mixed --tags public --server '<publicUrl>' --project '<id>'` |</after_change>

## [foj9tbk4] c4s-spec-reader > Expanding a whole page


```sh
<before_change>c4s resolve some-page.md --server <publicUrl> --project <id>              # markdown with tags expanded inline
c4s resolve some-page.md --format json --server <publicUrl> --project <id>   # { content, resolved: [...] }</before_change>
<after_change>c4s resolve some-page.md --server '<publicUrl>' --project '<id>'                # writes markdown with tags expanded inline
c4s resolve some-page.md --format json --server '<publicUrl>' --project '<id>'   # writes { content, resolved: [...] }</after_change>
```
<after_change>This is a RENDER convenience, and the only surface that still offers it. It takes a path to a markdown file **you already have** — a page in the repo you are working in, for instance. It is not how you read the specification's own pages, and there is no MCP equivalent: expanding a tag pastes the entity's payload over the reference, and the reference is the more useful half. To read a spec page, ask for it with `get-page` (tags stay unexpanded) and follow the embeds you care about by slug (`c4s single_element --type <t> --slug <s>`).</after_change>

## [dw3xlkgn] c4s-spec-reader > Navigating pages and sections


A whole page is often more than you need. Pages are addressed by the full key `(rootId, path)` — the same relative path can exist in several roots, so `--root-id` is required and there is no silent fallback. Sections are addressed by `anchor` alone (globally unique), so section commands take no root.

<before_change>The normal path from "I have a phrase" to "I have the text" is two commands, not three — a search hit already carries the anchor, so there is nothing to look up in between:</before_change>
<after_change>The normal path from "I have a phrase" to "I have the text" is TWO commands, not three — a search hit already carries the anchor, so there is nothing to look up in between:</after_change>

```sh
<before_change>c4s search-pages --query "<phrase>" --server <publicUrl> --project <id>   # hits carry an anchor
c4s get-sections --anchors a,b,c --server <publicUrl> --project <id>     # bodies of several sections in ONE call</before_change>
<after_change>c4s search-pages --query "<phrase>" --server '<publicUrl>' --project '<id>'   # hits carry an anchor
c4s get-sections --anchors a,b,c --server '<publicUrl>' --project '<id>'      # bodies of several sections in ONE call</after_change>
```

Fetch sections in **batches** — `get-sections` takes a comma-separated list and returns `{ results: [...] }` in input order. An unknown anchor comes back as an error **inside its own item**, so one bad anchor does not lose the other sections. Asking anchor-by-anchor costs one command per section for no benefit.

To see what a page contains before pulling any of it, ask for its outline. It comes back as a tree in document order — a table of contents — and every node carries the section's anchor, its heading, its level and the size of its own body, so you can pick exactly the anchors worth fetching:

```sh
<before_change>c4s get-page-outline --root-id pages --path some/page.md --server <publicUrl> --project <id>
c4s list-pages --root-id pages [--prefix modules/] --server <publicUrl> --project <id></before_change>
<after_change>c4s get-page-outline --root-id pages --path some/page.md --server '<publicUrl>' --project '<id>'
c4s list-pages --root-id pages [--prefix modules/] --server '<publicUrl>' --project '<id>'</after_change>
```

Whole page, when you really want all of it:

```sh
<before_change>c4s get-page --root-id pages --path some/page.md --server <publicUrl> --project <id></before_change>
<after_change>c4s get-page --root-id pages --path some/page.md --server '<publicUrl>' --project '<id>'</after_change>
```

The page comes back as **structure**, not as one text: `{ rootId, path, hash, frontmatter?, preamble?, results[] }`. Each item of `results` is one section — `anchor`, `heading_text`, `heading_level`, `body` — in document order. The anchor is a field, so you pass it straight to `get-sections`; `body` holds neither the anchor line nor the heading line. `frontmatter.raw` is the frontmatter verbatim and `frontmatter.fields` its parsed keys (absent when the YAML does not parse); `preamble` is the text above the first heading. `hash` is what a write expects. Add `--format text` to get the page assembled back into markdown for reading.

XML tags in `body` are left untouched — the tag is the edge to another entity, so expanding it would replace a link with a payload. Resolve the tags you care about with the commands above. On a page over the response budget, some items come back with `truncated: true` and no `body`, and `message` names their anchors — fetch those with `get-sections`. There is no line window on `get-page`: to continue a cut read, go through `get-page-outline` and `get-sections`.

## [wy9a0mdr] c4s-spec-reader > Discovery


<before_change>Every discovery command also takes `--server <publicUrl> --project <id>`:</before_change>
<after_change>- `c4s catalog --server '<publicUrl>' --project '<id>'` — the ENTRY POINT: page roots (`id`, `name`, `dir`, `builtin`, `pageCount`), active entity types with counts + version + description + roleNoun + mcpToolsLine per type, tag count. Start here; it is cheap and it tells you what else is worth asking.
- `c4s describe --type <t> --server '<publicUrl>' --project '<id>'` — what a type IS: JSON Schemas, the value `constraints` a write must satisfy, `selectableFields` (the names `--select` accepts), `contentFields` (fields no generic read carries, each with the operation that issues them) and `searchableFields`. Worth calling before a READ, not just before a write.
- `c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>] --server '<publicUrl>' --project '<id>'` — the project tags. Counts are OFF by default (they are a product of tags by types); `--co-occurring-with` returns the tags sharing entities with one you name, which is how you discover a taxonomy without already knowing it.
- `c4s list-entities --type endpoint [--tags auth] [--tag-filter and|or] [--sort createdAt|title|slug] [--dir asc|desc] [--mode items|count] --server '<publicUrl>' --project '<id>'` — full paginated traversal of one type. Rows are `{ slug, title }`: discovery answers with keys, and you follow up with `get-entities` for content. `--mode count` answers "how many" without listing. Only the default `createdAt` order has a write-stable offset window.
- `c4s get-entities --type dto --slugs a,b,c [--select <f1,f2>] --server '<publicUrl>' --project '<id>'` — several entities in one call. `--select` names top-level fields (`slug`, `title` and `tags` always come back); omit it for every field except content-bearing ones, or pass `--select=` for the identity skeleton alone.
- `c4s get-field-content --type diagram --slug <s> --field source --server '<publicUrl>' --project '<id>'` — the content of ONE content-bearing field. Such a field is carried by no generic read (you get `has<Field>` / `<field>Bytes` instead), so this is the only way to read one.
- `c4s search-entities --type ac --query "<phrase>" [--fields <f1,f2>] --server '<publicUrl>' --project '<id>'` — text search inside one type (the type is required); the output always declares `searchedFields`, so an empty result is distinguishable from an unsearched field.
- `c4s resolve-identity --query "<fragment>" [--types endpoint,dto] --server '<publicUrl>' --project '<id>'` — the only cross-type command: "what is this called?" from a fragment of a name.
- `c4s check-consistency [--severity <s>] [--rule <r>] --server '<publicUrl>' --project '<id>'` — the spec's own diagnostics (broken references, drift between disk and index).</after_change>

<before_change>- `c4s catalog --server <publicUrl> --project <id>` — active entity types with counts + version + description + roleNoun + mcpToolsLine per type (smoke test).
- `c4s describe --type <t> --server <publicUrl> --project <id>` — JSON Schema for one type (on-demand), plus `constraints`, `contentFields`, `selectableFields` and `searchableFields` — the per-field value limits, the fields whose body needs a dedicated read, the names `--select` accepts, and the paths a search would actually cover for that type.
- `c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <tag>] --server <publicUrl> --project <id>` — all tags; per-type counts are opt-in (`--with-counts`, off by default — computing them is a tags × types product), and `--co-occurring-with` is how you discover the taxonomy without knowing it first.
- `c4s list-entities --type endpoint [--tags auth] [--sort createdAt|title|slug] [--dir asc|desc] [--mode items|count] --server <publicUrl> --project <id>` — full paginated traversal of one type; each row is `{ slug, title }`, and `--mode count` answers "how many" without listing.
- `c4s get-entities --type dto --slugs a,b,c [--select <f1,f2>] --server <publicUrl> --project <id>` — several entities in one call; omit `--select` and you get the full record minus content-bearing fields.
- `c4s get-field-content --type <t> --slug <s> --field <f> --server <publicUrl> --project <id>` — the body of a content-bearing field, which no generic read returns (`describe` lists those fields as `contentFields`).
- `c4s search-entities --type ac --query "<phrase>" [--fields <f1,f2>] --server <publicUrl> --project <id>` — text search inside one type (the type is required); the output always declares `searchedFields`, so an empty result is distinguishable from an unsearched field.
- `c4s resolve-identity --query "<fragment>" [--types endpoint,dto] --server <publicUrl> --project <id>` — the only cross-type command: "what is this called?" from a fragment of a name.
- `c4s check-consistency [--severity <s>] [--rule <r>] --server <publicUrl> --project <id>` — the spec's own diagnostics (broken references, drift between disk and index).</before_change>
Every list command accepts `--limit` / `--offset` and reports `total` + `hasMore` — measure before you fetch.

<before_change>All output is JSON (pretty) by default. Use `--compact` for pipelines and `--format text` for terminal-friendly output. Errors go to stderr as JSON with an exit code > 0.</before_change>
<after_change>Every command above is one of the fifteen read-only **discovery operations** under a CLI name. The operation owns the behaviour — pagination, response budget, sort order, and what an error suggests you do next; the command is a transport over it. The mapping, when you need to read the operation's contract:</after_change>

<before_change>These commands are **read-only** — `c4s` never mutates the project — but read-only is not the same as local: each one is a call to the running server, exactly like the rest of this skill. `SERVER_NOT_RUNNING` means the server is down, not that the entity or page is missing; stop and ask the user to start it.</before_change>
<after_change>| CLI command | Operation |
|-------------|-----------|
| `c4s catalog` | `overview` |
| `c4s describe` | `describe_types` |
| `c4s list-tags` | `list_tags` |
| `c4s inline_mention` / `single_element` / `element_list` / `detail` | `get_entities` (one projection each) |
| `c4s get-field-content` | `get_field_content` |
| `c4s tagged_list` / `tagged_list_mixed` | `list_entities` (tag-filtered) |
| `c4s get-entities` / `c4s list-entities` | `get_entities` / `list_entities` (the canonical surface the aliases above sit on) |
| `c4s list-pages` / `c4s get-page` | `list_pages` / `get_page` |
| `c4s get-page-outline` / `c4s get-sections` | `get_page_outline` / `get_sections` |
| `c4s search-pages` / `c4s search-entities` | `search_pages` / `search_entities` |
| `c4s check-consistency` / `c4s resolve-identity` | `check_consistency` / `resolve_identity` |
| `c4s find-references` | `find_references` |
All output is JSON (pretty) by default. Use `--compact` for pipelines and `--format text` for terminal-friendly output. Errors go to stderr as JSON with an exit code > 0, and an error is navigable rather than merely a refusal: a `*_NOT_FOUND` names the alternatives it knows about, and an `INVALID_ARGUMENT` names the call that would have worked. Read the `hint` before guessing again.
None of these commands mutates the project: they render read operations of the specification, and `c4s` opens no database of its own.</after_change>

## [a28ukbcn] c4s-spec-reader > Asking the spec agent


<before_change>When a question goes beyond resolving entities or pages, `c4s ask` runs a synchronous agent turn against the specification (peer-consult, read-only posture):</before_change>
<after_change>When a question goes beyond resolving entities or pages, `c4s ask` runs a synchronous agent turn against the specification:</after_change>

```sh
<before_change>c4s ask "<question>" --server <publicUrl> --project <id></before_change>
<after_change>c4s ask "<question>" --server '<publicUrl>' --project '<id>'</after_change>
```

<before_change>`c4s ask` is an alias for `c4s agent --ct ask` and hardcodes the `ask` context — do NOT pass `--ct` or `--brief` (the alias rejects explicit context selectors). Continue the same thread with `c4s ask "<follow-up>" --thread <threadId> --server <publicUrl> --project <id>` (the `threadId` is printed with the answer).</before_change>
<after_change>It needs the same running server every other command here needs — see "Server required" above. What is different about it is the cost, not the requirement: it runs a full agent turn rather than answering from the index, so it can also come back `AGENT_UNAVAILABLE` or `TIMEOUT`.</after_change>

<before_change>`c4s ask` delegates the turn to the server's agent, so it needs the same running server as every other command in this skill — it is not an extra dependency and it is not available offline. If `c4s ask` reports the server isn't a claude4spec server, or that the spec project failed to build, that is a spec-repo / server-side problem — surface it to the user; do not try to fix the spec repo from here.</before_change>


# CONTEXT c4s-brief-implementer.md @2.1.14 offset 0 limit 10

## [~preamble]  > (preamble)

<after_change>Renderer `renderBriefImplementerSkill(ctx)` (<section_ref anchor="m22dimpl"/>) emituje frontmatter + body poniżej jako wpis `c4s-brief-implementer/SKILL.md` w FileSet (rdzeń `buildExternalSkillsBundle`), **podstawiając** wartości `ExternalSkillContext` w miejsce placeholderów: `<publicUrl>` → `ctx.publicUrl`, `<id>` → `ctx.id`, `<workspace>` → `ctx.workspace`. Ta strona jest źródłem prawdy dla renderera.

**Portable, CLI-only:** skill jest kopiowany do **obcego repo kodu** bez lokalnego markera projektu-specki, gdzie walk-up od cwd zawodzi. Dostęp do briefów/patchy idzie **wyłącznie** przez rodzinę komend M11 z wstrzykniętą tożsamością — `c4s list-briefs` / `c4s get-brief` / `c4s create-patch` z `--server <publicUrl> --project <id>` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>; <section_ref anchor="m11dcmds"/>). Portable jest **adresowanie**: adres serwera i identyfikator projektu idą wprost, bez odczytu lokalnego rejestru, więc komendy działają z każdej maszyny, która dosięga `publicUrl`. Wykonanie należy do procesu serwera (<section_ref anchor="l3locus0"/>), więc wszystkie te komendy — łącznie z `list-briefs`, `get-brief` i `create-patch` — wymagają działającego serwera. Gdy `c4s` niedostępne **albo** komenda zwraca `SERVER_NOT_RUNNING` → skill **zatrzymuje się** i prosi usera o instalację `c4s` / uruchomienie serwera; nigdy nie czyta ani nie zapisuje plików repo-specki bezpośrednio i nie startuje serwera sam.

Korekta składni CLI względem M11 (<section_ref anchor="3ka5h2zq"/>): synchroniczna eskalacja rozróżnia dwie ścieżki — `c4s agent "…" --ct brief --brief <brief-path>` (**preferowana**: kontekst *konkretnego briefu + release diff*, agent widzi tylko okno zmian tego briefu) oraz `c4s ask "…"` (read-only peer-consult *aktualnego stanu specki*, może być dalej niż wdrażany brief). `c4s ask` **nie** przyjmuje `--ct`/`--brief`. Obie zlecają turę i niosą `--server <publicUrl> --project <id>` — jak reszta komend skilla wymagają działającego serwera. Kontynuacja wątku briefu: `c4s agent "…" --thread <threadId>`.

Frontmatter:

```yaml
---
name: c4s-brief-implementer
description: Implement features described in claude4spec briefs. Briefs are self-contained markdown files (entity snapshots, section diffs, narrative) that live in the companion specification repository, reached from your code repo via the c4s CLI (c4s list-briefs / get-brief, with --server and --project baked in). After implementation, if you discover drift between the brief and reality (missing details, incorrect assumptions, edge cases not covered), file a patch via c4s create-patch as feedback for the specification author. Use when implementing a claude4spec brief in a code repository.
---
```

Body:
</after_change>

## [qv83eat4]  > c4s-brief-implementer

<after_change>
This skill describes how to implement a release brief in **your code repository** (not the spec repo). A brief is a self-contained markdown file that captures everything you need to ship the change: entity snapshots, section diffs, narrative, acceptance criteria. Briefs live in the **spec** repository, a different repo from the one you are working in — you never touch it directly; the `c4s` CLI reaches everything for you.

**Reaching the briefs.** This skill is **CLI-only**: it reaches the briefs and writes patches solely through the `c4s` CLI, with the spec project's server address and id baked into this skill (`--server <publicUrl> --project <id>` — project `<id>` in workspace `<workspace>`) — `c4s list-briefs` / `c4s get-brief` / `c4s create-patch` work from any directory, on any machine that can reach `<publicUrl>`. Addressing is portable, execution is not: `c4s` sends every one of these calls to the running `npx @inharness-ai/claude4spec` server at `<publicUrl>`, which owns the specification. If `c4s` is not installed, or a command returns `SERVER_NOT_RUNNING`, **stop** and ask the user to install `c4s` / start the server — do not read or write the spec repo's files by hand, do not guess what the brief says, and do not start the server yourself. `PROJECT_NOT_IN_WORKSPACE` means the server at `<publicUrl>` does not serve project `<id>` — this skill's address is stale; stop and ask the user to regenerate the skill.

**The brief is self-contained.** You do not need to read the main specification or query the entity database — everything is in the brief body. If the brief references something you cannot find in its body, treat that as drift and file a patch (step 4 below).
</after_change>

## [3nhtuaeg] c4s-brief-implementer > Workflow

<after_change></after_change>

## [xxll6nqu] c4s-brief-implementer > Workflow > 1. Discover

<after_change>
List the briefs through `c4s` (paginated — briefs accumulate over time, so filter and page rather than dumping everything):

```sh
c4s list-briefs --status pending --limit 10 --server <publicUrl> --project <id>
```

`--status pending` hides briefs already marked `implemented: true`; drop it to see all. Use `--offset` to page. Output lists each brief's `path` (which you pass to `get-brief`) and whether it is already implemented.

**Which brief do I implement?** If the user named a brief, use it. If not — and `list-briefs` returns more than one pending brief — **ask the user which one**; do NOT guess. Picking the wrong brief wastes an implementation pass. Only proceed automatically when there is exactly one obvious candidate (a single pending brief, or the user pointed at one).
</after_change>

## [kfzc9s5p] c4s-brief-implementer > Workflow > 2. Read the brief as self-contained input

<after_change>
Read the full brief by the `path` printed by `list-briefs`:

```sh
c4s get-brief <brief-path> --server <publicUrl> --project <id>
```

The body contains everything you need — entity snapshots, section diffs, the narrative of what changes, and acceptance criteria. Read it and implement it; you do not need to understand how the brief was produced. **Do not read the main specification.**

If the brief is unclear — a missing detail, an ambiguous wording, a decision you'd otherwise have to guess — you have two paths.

**Synchronous (preferred when available).** Ask the specification agent in the same terminal and continue once you have an answer. Two distinct commands, by what context you need.

Preferred — context of THIS brief plus its release diff (the agent sees only the change window of the brief you are implementing):

```bash
c4s agent "Brief nie precyzuje X — czy chodzi o A czy B?" --ct brief --brief <brief-path> --server <publicUrl> --project <id>
```

Alternative — read-only peer-consult of the CURRENT spec state (may be ahead of the brief you are implementing); no brief context, no `--ct`/`--brief`:

```bash
c4s ask "Jak dziala Y w aktualnej specce?" --server <publicUrl> --project <id>
```

Continue the brief thread with `c4s agent "..." --thread <threadId> --server <publicUrl> --project <id>` (the `threadId` is printed with the answer). This path runs against the same server as every other command here, so it adds no dependency beyond `c4s` itself.

**Asynchronous.** If you choose not to ask synchronously — or the question is for the spec-author rather than the agent — proceed with your best judgement and file a patch afterwards (step 4) so the spec-author can fold the clarification into the next brief.
</after_change>

## [gjb7pga7] c4s-brief-implementer > Workflow > 3. Implement

<after_change>
Standard code flow in your target repository: read existing code, plan, edit, test. Stay focused on what the brief specifies.
</after_change>

## [hl6f508m] c4s-brief-implementer > Workflow > 4. Feedback loop (patches)

<after_change>
When you discover that the brief diverges from reality — a missing detail, an incorrect assumption, an edge case not covered, or anything else the spec-author should know — file a patch. Use `c4s create-patch`, which records the patch on the spec side for you:

```sh
printf '%s\n' "$PATCH_BODY" | c4s create-patch \
  --brief <brief-path> --desc "<short-desc>" --kind drift \
  --server <publicUrl> --project <id>
```

The body (from stdin, or `--body-file <f>`) goes below an auto-generated `# Patch — <short-desc>` heading. Structure the body as two sections: a `## What I found` section (the drift / missing detail / incorrect assumption) and a `## Suggestion` section (what the spec-author should consider in a follow-up brief or entity edits). `c4s create-patch` records all the metadata for you (which brief it relates to, the kind from `--kind`, defaulting to `drift`) — you only write the markdown body.

`--kind` values:

- `drift` — the brief described behavior X, but the codebase already does Y.
- `missing` — the brief is silent on a detail you had to decide yourself.
- `incorrect` — the brief is factually wrong about existing code.
- `clarification` — the brief is ambiguous; you guessed but it should be made explicit for next time.
</after_change>

## [ir34awsi] c4s-brief-implementer > Workflow > 5. Mark brief as implemented

<after_change>
When the implementation is genuinely finished — code committed, tests green, merged to main / accepted by the user — mark the brief as implemented (`implemented: true`):

```sh
c4s mark-brief-implemented <brief-path> --server <publicUrl> --project <id>
```

Like every other command in this skill, this one runs on the server; if it isn't up you get `SERVER_NOT_RUNNING` — stop and ask the user to start it. There is no by-hand file edit: this skill is CLI-only.

`implemented: true` is a **declaration**, not a computed fact derived from git. A revert on main does NOT roll the flag back. Set it ONLY when implementation is realistically done — never proactively or "just in case".
</after_change>

## [h68z15an] c4s-brief-implementer > Workflow > 6. Hand-off

<after_change>
The spec-author picks up your patches on the spec side and folds each deviation back into the specification. That lifecycle lives entirely in the spec repo; you only write the raw markdown patch body via `c4s create-patch`.
</after_change>

## [dhzapif8] c4s-brief-implementer > Notes

<after_change>
This is a **base skill** generated by claude4spec **on demand** — you got it either by downloading the ZIP from the Settings page or by running `c4s install-skills`, which writes it into your code repo's `.claude/skills/`. Installing from the local registry works offline — its subject is your code repo; installing with `--server <url>` makes one read from that server to confirm the project `id`. Running the workflow above never works offline: every step goes through the spec project's server. It already covers what you need to read briefs and ask the c4s agent questions. Feel free to **adapt it to your own workflow** (e.g. add a git/PR flow) or use it as-is. To refresh it against the current spec, re-download the ZIP or re-run `c4s install-skills` (overwrites the managed copy).
</after_change>


# CONTEXT c4s-refactor.md @2.1.14 offset 0 limit 9

## [~preamble]  > (preamble)

<after_change>Renderer `renderRefactorSkill(ctx)` (<section_ref anchor="m22dserv"/>) emituje frontmatter + body poniżej jako wpis `c4s-refactor/SKILL.md` w FileSet (rdzeń `buildExternalSkillsBundle`), **podstawiając** wartości `ExternalSkillContext` w miejsce placeholderów: `<publicUrl>` → `ctx.publicUrl`, `<id>` → `ctx.id`, `<workspace>` → `ctx.workspace`. Ta strona jest źródłem prawdy dla renderera — zmiana treści skilla zaczyna się tutaj.

`c4s-refactor` to **router driftu spec↔kod**: dla zadanego *topicu* czyta speckę, analizuje kod w repo agenta, wykrywa i klasyfikuje drift, po czym **routuje** naprawę do jednej z dwóch ścieżek. Zakres skilla to **analiza + routing + STOP** — skill sam nie edytuje ani specki, ani kodu; robi hand-off do człowieka albo do `c4s-brief-implementer`.

Dwie ścieżki mapują na dwa prymitywy: Path 1 (spec-fix) → `c4s ask` (read-only plan, peer-consult; M11 <section_ref anchor="3ka5h2zq"/>). Path 2 (code-fix) → **`c4s create-brief --body-file`** (M21 <section_ref anchor="xqksf67f"/>) — treść briefu pisze **sam agent-refaktor**, a komenda zapisuje ją jednym wywołaniem jako **brief wobec stanu bieżącego** (okno otwarte do teraz, `to_release: null` — M21 <section_ref anchor="m21fmtct"/>); brief podnosi potem `c4s-brief-implementer`.

**Dlaczego bez tury pośredniej.** Cały kontekst potrzebny do napisania tego briefu ma **wołający**: przeczytał kod (pliki, linie), przeczytał speckę przez reader i sklasyfikował drift. Tura w wątku `context_type='brief'` operuje wyłącznie na `release_diff` i bieżącego stanu specyfikacji nie widzi z założenia (M21 <section_ref anchor="m21bauth"/>), a kodu nie widzi w ogóle — drift kodu względem już opisanego kontraktu w delcie wydań zwykle nie występuje. Skompresowanie kontekstu do jednego prompta i oddanie go takiemu agentowi nie podnosi jakości zapisu, o którą idzie mediacja (<section_ref anchor="l3media0"/>); dodaje **punkt awarii**, w którym agent odmawia napisania treści, a wołający dostaje exit 0 i ścieżkę briefu z samym nagłówkiem. Precedens właściwego kształtu istnieje w rodzinie — `c4s create-patch` też przyjmuje intencję wołającego, a zapis wykonuje serwer bez tury. `c4s agent --ct brief` nie jest więc trasą żadnej ze ścieżek tego skilla, ani w create-mode, ani w attach-mode.

Wszystkie trzy skille wymagają `c4s` CLI + działającego serwera (<section_ref anchor="l3locus0"/>); `c4s-refactor` różni się **zakresem** zależności, nie jej siłą — bez serwera nie zrobi nic użytecznego, bo obie ścieżki routingu kończą się wywołaniem do serwera (tura `ask` w Path 1, zapis briefu w Path 2), podczas gdy reader i implementer zatrzymują się dopiero przy pierwszym odczycie specyfikacji. Body jest **portable w adresowaniu**, **CLI-only** i zgeneryzowane: komendy `c4s` (reader/`ask`/`create-brief`) niosą wstrzyknięte `--server <publicUrl> --project <id>` (M31 <section_ref anchor="2eyrx9es"/>, <section_ref anchor="3l4ge8xa"/>) zamiast walk-upu od cwd (który zawodzi w obcym repo) i bez odczytu lokalnego rejestru; czytanie specki idzie **wyłącznie** przez `c4s`, brak `c4s` albo `SERVER_NOT_RUNNING` → STOP (bez fallbacku FS, bez auto-startu serwera); bez odwołań do konkretnego layoutu kodu (mowa o „code in your repository", nie `src/`). Po command-reference body odsyła do `c4s-spec-reader`.

Frontmatter:

```yaml
---
name: c4s-refactor
description: Detect drift between a claude4spec specification and the code in your repository for a given topic, classify it, and route the fix — a spec update to a read-only plan, or a code change to a brief against the current state. Use when you suspect the spec and the implementation have diverged and you need to decide which side to fix. Analysis and routing only — it never edits the spec or the code.
---
```

Body:
</after_change>

## [sa9x6lzh]  > C4S Refactor

<after_change>
This skill finds and routes **drift between a claude4spec specification and the code in your repository**, one topic at a time. It reads the spec, analyzes the code, decides whether the spec is wrong, the code is wrong, both, or neither, and then hands the fix to the right channel.

**Scope: analysis + routing + STOP.** This skill never edits the spec and never edits the code. It produces a drift report and starts at most one follow-up per side (a read-only plan, or a brief it writes itself against the current state) — then stops and hands off to a human or to the `c4s-brief-implementer` skill.

This skill requires the `c4s` CLI **and** a running `npx @inharness-ai/claude4spec` server. Reading the spec and both routing paths are server calls: `c4s` sends them to the server at `<publicUrl>` (project `<id>` in workspace `<workspace>`), and the server executes them. If `c4s` is missing, or any command returns `SERVER_NOT_RUNNING`, **stop** and ask the user to install `c4s` / start the server — do not guess the drift, do not fall back to reading the spec repo's files, and do not start the server yourself. `PROJECT_NOT_IN_WORKSPACE` means the server at `<publicUrl>` does not serve project `<id>` — this skill's address is stale; stop and ask the user to regenerate the skill.
</after_change>

## [nss9s9vv] C4S Refactor > Input / Argument

<after_change>
The skill takes a **topic** — one feature, module, endpoint, table, or behavior to check for drift (e.g. "brief implementer flow", "the patches lifecycle", "auth token refresh").

If you are invoked without a topic, **do not scan the whole spec**. Ask the user to narrow it to one area first — drift analysis is only meaningful against a bounded slice.
</after_change>

## [lhvgiktd] C4S Refactor > Reading the spec

<after_change>
Read the spec through the `c4s` CLI. Every command carries `--server <publicUrl> --project <id>` — the spec project's server address and id, baked into this skill (a bare `c4s` searches upward from cwd for the spec project's local marker, which your code repo does not have):

```sh
c4s catalog --server <publicUrl> --project <id>                            # active entity types + counts (orient)
c4s list-tags --server <publicUrl> --project <id>                          # tags — find the slice for your topic
c4s list-entities --type endpoint --server <publicUrl> --project <id>      # slugs + titles for a given type
c4s single_element --type dto --slug X --server <publicUrl> --project <id>  # full entity detail
c4s tagged_list --type ac --tags <topic-tag> --server <publicUrl> --project <id>   # AC covering the topic
c4s resolve some-page.md --server <publicUrl> --project <id>               # a whole page with tags expanded inline
```

For the full tag↔command reference, see the sibling `c4s-spec-reader` skill. Reading the spec requires `c4s` **and** the running server — these commands are read-only, but they are not local. If `c4s` is unavailable, or a command returns `SERVER_NOT_RUNNING`, **stop** and ask the user to install `c4s` / start the server — do not read the spec repo's files directly.
</after_change>

## [z2pc6w74] C4S Refactor > Process

<after_change>
1. **Establish the topic.** Confirm the one area you are checking (see Input / Argument).
2. **Read the spec.** Pull the relevant entities, AC, and module/page prose for the topic (see Reading the spec). This is the *intended* behavior.
3. **Analyze the code.** Read the corresponding code in your repository — the actual behavior. Use your normal code navigation.
4. **Detect & classify.** Compare intended vs actual and put each divergence in one of four buckets:
   - **spec-fix** — the code is correct; the spec is stale or wrong → Path 1.
   - **code-fix** — the spec is correct; the code diverges → Path 2.
   - **both** — spec and code are each partly wrong → run Path 1 for the spec side and Path 2 for the code side.
   - **none** — spec and code agree → report "in sync" and **STOP**. Do not invent work.
</after_change>

## [mf7c1lb6] C4S Refactor > Path 1 — spec → plan (`c4s ask`)

<after_change>
When the fix belongs to the **spec**, route it to a read-only planning turn against the specification:

```sh
c4s ask "Spec drift on <topic>: the code does X but the spec says Y. Propose a plan to update the spec." --server <publicUrl> --project <id>
```

`c4s ask` is a read-only peer-consult (an alias for `c4s agent --ct ask`) — it produces a plan / analysis and never mutates the spec. Record the printed `threadId`; continue with `c4s ask "<follow-up>" --thread <threadId> --server <publicUrl> --project <id>`. The spec author (or you, in a separate spec-editing pass) executes the plan later. This skill does **not** apply it.
</after_change>

## [r428qll1] C4S Refactor > Path 2 — code → brief (`c4s create-brief`)

<after_change>
When the fix belongs to the **code**, **you write the brief** and save it with one command. You are the one holding the context — you have just read both the spec and the code — so do not hand that context to another agent to reconstruct.

**1. Write the brief body to a local file** (e.g. `/tmp/drift-<topic>.md`). It must be **self-contained**: the implementer runs in a fresh terminal with none of your findings. Cover four things:

- **What the spec says** — quote it, and name the AC slugs and entity slugs that state the intended behavior.
- **What the code does** — files with line numbers, and the divergent behavior.
- **What the implementer must change** — the concrete edit, per file.
- **How to verify** — the tests or commands that must pass afterwards.

**2. Save it — one command, no agent turn:**

```sh
c4s create-brief --body-file /tmp/drift-<topic>.md --server <publicUrl> --project <id>
```

This writes a brief **against the current state**: the window's `from` end is the latest release and its `to` end stays open, so no release diff is involved. `--from <release>` picks a different start, `--suffix <slug>` disambiguates the filename; there is no `--to` and no `--roots`. Pass the body **as a file**, never inline in the argument — multi-line markdown with backticks in it does not survive the shell.

The command prints `briefPath`. Record it and hand it to `c4s-brief-implementer`.
</after_change>

## [77tceq73] C4S Refactor > Report + STOP

<after_change>
After routing, emit a short drift report and **stop**:

- the topic, and per-divergence bucket (spec-fix / code-fix / both / none);
- for each spec-fix: the `c4s ask` `threadId` of the plan;
- for each code-fix: the `briefPath` printed by `c4s create-brief`, plus a note to hand it to `c4s-brief-implementer`;
- "in sync" when nothing diverged.

This skill performs **no execution** — it hands off to a human and/or `c4s-brief-implementer`. It never edits the spec or the code itself.
</after_change>

## [4xsbpoma] C4S Refactor > Gotchas

<after_change>
- **Server required — for every step.** Reading the spec, `c4s ask` (Path 1) and `c4s create-brief` (Path 2) all go through a running `npx @inharness-ai/claude4spec` server at `<publicUrl>`; the address is baked into this skill, `c4s` looks nothing up locally. `SERVER_NOT_RUNNING` from any command means stop and ask the user to start it — never start it yourself, never work around it.
- **Address and identity are baked in — do not `cd`.** Every command carries `--server <publicUrl> --project <id>` (the spec project's server and its id — not a filesystem path). Run from anywhere; do not `cd` into the spec dir and do not rely on cwd walk-up (your code repo has none of the spec project's local files).
- **`c4s ask` is read-only.** Path 1 never mutates the spec; it only plans.
- **CLI only, never `curl`.** Use `c4s` commands; do not hand-craft HTTP calls to the server.
- **Path 2 writes the brief — it does not delegate writing it.** Save your own body with `c4s create-brief --body-file <path>`. Do **not** route a code-fix through `c4s agent --ct brief`: that spends a turn on an agent which sees neither your repository nor the current spec, only a release diff — it can legitimately refuse to write anything, and you get exit 0 plus an empty brief. See Path 2.
- **`--body-file`, never an inline body.** A `VALIDATION` error from `c4s create-brief` means the file you passed was empty — the server refuses to create a brief with no content, so no half-written artifact is left behind.
- **Language.** Write prompts and output in English.
- **Related skills.** `c4s-spec-reader` (reading the spec) and `c4s-brief-implementer` (implementing the minted brief and filing patches).
</after_change>
