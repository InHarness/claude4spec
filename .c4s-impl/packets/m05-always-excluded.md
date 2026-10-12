# Packet — m05-always-excluded

- window: 2.1.13 → 2.1.14 (delta)
- unit: m05-always-excluded
- goal: Na karcie Agent w ustawieniach lista zawsze wykluczonych katalogów jest widoczna przy każdej wartości flagi blokady bezpośredniego dostępu do plików, bo zbiór wykluczeń obowiązuje zawsze. Przy włączonej fladze znikają tylko edytowalne pola dozwolonych i niedozwolonych ścieżek. Kryteria karty katalogów zostają jako regresja ekranu ustawień.
- layers touched: L5 (UI), L17 (Project Settings)
- entities: 3 ac (criteria), 1 linked ui-view (settings-page, context)
- criteria: 3 (ac-element-always-excluded-na-karcie-age, ac-ekran-m26-directories-blokuje-przycisk, ac-lista-elementu-roots-na-karcie-direct)
- jobs: none
- packet size: 63266 bytes

## Change 2.1.13→2.1.14 — m05-chat-agent.md (changed sections)
### pages/modules/m05-chat-agent/m05-chat-agent.md (op: update)
#### [m26agsec] Strona ustawień (section)


**Karty**

| Karta | Kotwica URL | Grupa | Waga | Warunek widoczności |
|---|---|---|---|---|
| Agent | `#agent` | Agent | 10 | |

**Elementy**

| Element | Karta | Waga | Rodzaj | Wartość | Warunek widoczności | Komunikat efektu |
|---|---|---|---|---|---|---|
| Use Claude Code preset | `#agent` | 10 | `toggle` | `agent.claudeUsePreset` | | `Applies from the next agent turn, also in ongoing conversations.` |
| Conversational language | `#agent` | 20 | `select` — lista języków (<section_ref anchor="m01supplng"/>) i opcja `None` zapisywana jako `null` | `agent.conversationalLanguage` | | `Applies from the next new conversation.` |
| Block direct file access | `#agent` | 30 | `toggle` | `agent.disableDirectFilesystemAccess` | | `This change applies to the whole project and ends the ability to resume existing conversations — they will need a new one.` |
| File access enforcement | `#agent` | 40 | `własny` | — | | |
| Allowed paths | `#agent` | 50 | `lines` | `agent.allowedPaths` | `agent.disableDirectFilesystemAccess` wyłączone | `Changing the file scope applies to the whole project and ends the ability to resume existing conversations — they will need a new one. New conversations use the new scope right away.` |
<before_change>| Always excluded | `#agent` | 60 | `własny` | — | `agent.disableDirectFilesystemAccess` wyłączone | |</before_change>
<after_change>| Always excluded | `#agent` | 60 | `własny` | — | zawsze, niezależnie od `agent.disableDirectFilesystemAccess` | |</after_change>
| Disallowed paths | `#agent` | 70 | `lines` | `agent.disallowedPaths` | `agent.disableDirectFilesystemAccess` wyłączone | `Changing the file scope applies to the whole project and ends the ability to resume existing conversations — they will need a new one. New conversations use the new scope right away.` |
| Anthropic API key | `#agent` | 80 | `własny` | poza plikiem | | `Applies from the next agent turn, also in resumed conversations.` |

**Teksty pomocnicze**

| Element | Rodzaj | Tekst |
|---|---|---|
| Use Claude Code preset | tooltip | `Append the Claude Code preset to the agent's system prompt. Off by default — the agent receives only the project's prompt.` |
| Conversational language | tooltip | `The language the agent always replies to you in, in chat, regardless of the language of your question. It does not affect the language of the specification content — set that in the Project section.` |
| Block direct file access | helper | `Checked (default): the agent reads and changes the specification only through core operations — it has no file or shell tools. Uncheck only if the agent must work on files outside the specification (code, implementation artifacts).` |
| Allowed paths | helper | `By default the agent sees only the project directory (cwd) and the pages directory. ALLOWED PATHS adds directories, DISALLOWED PATHS excludes them (exclusion wins). Enter absolute paths, one per line.` |

<todo comment="Dwie obowiązkowe noty regresji karty #agent dla projektów bez klucza w pliku (kanał: nota karty i release notes) nie mają literalnych stringów, więc nie weszły do tabeli Teksty pomocnicze: preset Claude Code jest teraz domyślnie wyłączony, także w trwających wątkach od następnej tury; blokada bezpośredniego dostępu jest domyślnie włączona, a odznaczenia wymagają git recovery Fix it with Agent i CLI c4s. Ustalić literalne teksty obu not (wiersze nota karty)."/>

**Elementy własne**

#### [8lk6hpxp] Always excluded — `#agent` (section)


<before_change>Element tylko do odczytu, widoczny razem z polami ścieżek i stojący nad `Disallowed paths`. Wyszarzona, nieedytowalna lista katalogów korzeni z `agentDirectFs = nie` (L13) — `dir` każdego takiego korzenia rejestru, ścieżką względną wobec katalogu projektu — z notą `Always excluded — artifacts are edited only through the agent's tools (not by hand). This cannot be turned off.`</before_change>
<after_change>Element tylko do odczytu, widoczny **zawsze**, niezależnie od `agent.disableDirectFilesystemAccess`; przy odznaczonej fladze stoi nad `Disallowed paths`. Wyszarzona, nieedytowalna lista katalogów korzeni z `agentDirectFs = nie` (L13) — `dir` każdego takiego korzenia rejestru, ścieżką względną wobec katalogu projektu — z notą `Always excluded — artifacts are edited only through the agent's tools (not by hand). This cannot be turned off.`</after_change>

- Lista to predefiniowany deny-set zakresu plików (<section_ref anchor="nn4361ab"/>): ma pierwszeństwo nawet nad `Allowed paths` i nie jest zapisywana do `agent.disallowedPaths`, więc element nie uczestniczy we wspólnym zapisie karty.
<after_change>- **Dlaczego nie znika razem z polami ścieżek.** Deny-set obowiązuje przy każdej wartości flagi — jest zawsze przekazywany do adaptera i zawsze trafia do linii `ALWAYS DISALLOWED` bloku `<agent_path_scope>` (<section_ref anchor="2q0prdli"/>). Ukrycie reguły, która nadal działa, wprowadzałoby użytkownika w błąd; nota „This cannot be turned off” mówi to samo.</after_change>


## Change 2.1.13→2.1.14 — agent-posture.md (changed sections)
### pages/modules/m05-chat-agent/agent-posture.md (op: update)
#### [25mntsy2] Gating grupowy built-inów (`agent.disableDirectFilesystemAccess`) (section)


Path scoping wyżej odbiera agentowi **katalogi**; ta sekcja odbiera mu **narzędzia**. Czyta się je razem, bo obie są posturą tury składaną przez ten sam builder — ale są to dwie różne osie i różne obserwowalności, a zlanie ich daje zdanie fałszywe w jedną albo w drugą stronę.

**Granica funkcji.** Tryb wyłączonych built-inów jest trybem pracy **nad specyfikacją**, nie nad repozytorium. Praca poza spec — kod, git, `c4s` CLI, cudze repo — zostaje przy built-inach z zamysłu i wymaga odznaczenia flagi na karcie ustawień (<section_ref anchor="m26agsec"/>).

**Mapowanie, jawnie i w jednym miejscu.** `config.agent.disableDirectFilesystemAccess === true` (default — <section_ref anchor="6xegs5ac"/>) ⇒ `disallowedToolGroups ⊇ ['file-read', 'file-write', 'shell']`. **Nie enumerujemy nazw narzędzi** — kontrakt ich nie przyjmuje i nie przyjmie (`external/inharness-packages.md` <section_ref anchor="xkyowcpq"/>: wiedza „które identyfikatory znaczą shell" należy do adaptera, nie do konsumenta). Egzekucja to **residual allow-lista**, nie deny-lista: adapter liczy zbiór dozwolonych built-inów jako resztę po odjęciu grup, więc **built-in nieznany bibliotece jest blokowany, nie dozwolony**, a bump SDK degraduje w stronę bezpieczną.

**Suma z presetem `planMode`, i dlaczego to nie jest ta sama oś.** Efektywne `disallowedToolGroups` tury = grupy stałe projektu **∪** grupy presetu `planMode` (`['file-write', 'shell']`). Preset **nigdy** nie może zostać osłabiony przez to pole ani przez żadną wartość configu. Dwie osie różnią się **czasem życia**: preset jest per-tura i przełączalny w środku wątku (<section_ref anchor="yazwev1g"/>), nasze grupy są **stałe na cały wątek**.

**Guard resume porównuje NASZE pole, nie policzoną unię (mandatory).** Skoro `planMode` desugaruje się do tego samego `disallowedToolGroups`, guard porównujący **policzone** grupy odrzucałby **każdy** flip Plan Mode kodem `409`. Dlatego snapshot tury-1 niesie `agent.disableDirectFilesystemAccess` — pojedynczy boolean z configu — a **nie** wynik desugarowania. To domyka kontrakt opisany w <section_ref anchor="z9g82hug"/> i <section_ref anchor="7m7kxrbn"/>: pole wchodzi do snapshotu i do zbioru resume-locked, więc wznowienie wątku założonego przy innej wartości kończy się `409 RESUME_CONFIG_LOCKED`, a flip Plan Mode w tym samym wątku przechodzi bez przeszkód.

**`shell` zabiera więcej niż powłokę — i akurat to jest zysk.** Grupa `shell` **suppressuje `Skill`**, więc przy aktywnej fladze natywny `Skill()` znika z katalogu narzędzi **także poza plan mode**. To domyka warstwę 2 blokady D6 (M37 <section_ref anchor="1qv5jepp"/>) tam, gdzie zapisano, że warstwy 2 „nie ma i nie będzie": przy włączonej fladze jest, jako skutek uboczny grupy, a nie osobny mechanizm. Kanałem otwierania skilli pozostaje <inline_mention type="mcp-tool" slug="skill-tools-load-skill-file"/>, który gatingu nie dotyka.

**`shell` wyłącza też start zadań w tle.** Zadania **trwające** dobiegają naturalnie i ich wyniki są dostarczane; **nowe nie startują** (*skip*, nie degradacja do zgłoszenia). Ta sama semantyka co przy presecie — <section_ref anchor="057mv7pz"/>.

<before_change>**Relacja do path-scope: sumowanie, nie ortogonalność.** Trzy zdania wiążące z <section_ref anchor="nn4361ab"/> zyskują tu ostrzejszą wersję. Przy odciętych grupach plikowych **żadna reguła allow z path-scope nie powstaje w ogóle**, więc `agent.allowedPaths` / `agent.disallowedPaths` **nie mają skutku dla kanału built-in** — nie ma czego bramkować. **Ale nie stają się martwe:** twardy sandbox systemowy pozostaje **jedynym confinementem obejmującym natywnego subagenta**, który deny-grup nie dziedziczy. Wartości zostają w configu i nadal jadą do adaptera; znikają wyłącznie kontrolki ścieżek na karcie ustawień (<section_ref anchor="m26agsec"/>).</before_change>
<after_change>**Relacja do path-scope: sumowanie, nie ortogonalność.** Trzy zdania wiążące z <section_ref anchor="nn4361ab"/> zyskują tu ostrzejszą wersję. Przy odciętych grupach plikowych **żadna reguła allow z path-scope nie powstaje w ogóle**, więc `agent.allowedPaths` / `agent.disallowedPaths` **nie mają skutku dla kanału built-in** — nie ma czego bramkować. **Ale nie stają się martwe:** twardy sandbox systemowy pozostaje **jedynym confinementem obejmującym natywnego subagenta**, który deny-grup nie dziedziczy. Wartości zostają w configu i nadal jadą do adaptera; znikają wyłącznie edytowalne pola `Allowed paths` i `Disallowed paths` na karcie ustawień (<section_ref anchor="m26agsec"/>) — zakres przestaje być edytowalny, nie przestaje być egzekwowany, co mówi nota elementu `File access enforcement`. Lista `Always excluded` zostaje widoczna przy każdej wartości flagi, bo implicit deny-set nie zależy od niej w ogóle.</after_change>

**MCP jest poza gatingiem — bez wyjątków.** Grupy dotyczą wyłącznie built-inów. Cała powierzchnia rdzenia (`reference-tools`, `entity-tools`, `plan-tools`, `release-tools`, `skill-tools`, `c4s-tools`, `transagent-tools`) przeżywa wyłączenie built-inów nietknięta — to dokładnie to, co czyni tę flagę możliwą bez regresu funkcjonalnego w pracy nad spec. Jedyną dźwignią konsumenta wobec MCP jest **nie zamontować serwera** (rejestr kontekstów, <section_ref anchor="m05ctxreg"/>).

**Sonda przed dispatchem.** `routes/agent-turn.ts` woła `probeToolGating(arch, groups)` **przed** `adapter.execute` — ta sama odpowiedzialność, którą <section_ref anchor="yazwev1g"/> opisuje już dla presetu; flaga nie dokłada nowego mechanizmu, tylko poszerza listę badanych grup o `file-read`. Sonda zwraca per grupę `{ enforceable, strength, escapeSurfaces }`; grupa nieegzekwowalna → `AdapterToolPolicyError` **przed** startem tury — to **odmowa**, nie awaria, mapowana w kopercie błędu L4 i w SSE.

**Siła i droga obejścia, nazwane wprost.** Na `claude-code` wszystkie trzy grupy są egzekwowalne, ale o sile **`soft`** — to model-behaviour gate, nie sandbox. Deny **usuwa narzędzie z katalogu modelu** (inna obserwowalność niż path-scope, który narzędzie zostawia i odmawia dopiero przy próbie użycia), ale natywny `Agent`/`Task` startuje z pełnym toolsetem i **nie dziedziczy deny-grup** (`modules/m45-subagents.md` <section_ref anchor="otdgxqdo"/>), więc sonda raportuje go jako `escapeSurface`. Spec **nie twierdzi**, że gating jest szczelny — nazywa go tym, czym jest: usunięciem narzędzi z katalogu przy sile `soft`, z jedną udokumentowaną powierzchnią ucieczki.

**Propagacja na subagentów programowych jest kontraktem.** Deny-grupy biegu `execute()` aplikują się do **każdej** `SubagentDefinition` tego biegu — przez **przecięcie, nigdy poszerzenie** (`external/inharness-packages.md` <section_ref anchor="inhagents1"/>). Enumerowanie w `tools` narzędzia należącego do grupy zdenied **nie jest błędem**; przecięcie po prostu wygrywa. Konsekwencje dla `spec-explore` i `diff-explore` — `modules/m45-subagents.md` <section_ref anchor="iqiwak31"/>.

**Jeden builder na każdy call-site `adapter.execute`.** Flaga wchodzi do tego samego buildera co `resolveAgentPathScope`, więc **każdy** call-site dziedziczy gating bez własnej gałęzi: route czatu (<section_ref anchor="tj0960gk"/>), `POST /api/threads/:id/ask` (<section_ref anchor="qs2bk6jt"/>), dispatcher transagenta (<section_ref anchor="tr4ndisp"/>), seed-thread (<section_ref anchor="m05seedthr"/>) oraz wewnętrzne `adapter.execute` audytu AC opisane w <section_ref anchor="nn4361ab"/>. **Narzędzie MCP nie jest furtką omijającą zawężenia tury, z której je zawołano** — dziedziczy jej posturę, tak samo jak dziedziczy jej zakres FS.


## Context @2.1.14 — m05-chat-agent.md offset 1..2 (purpose, dependencies)
### pages/modules/m05-chat-agent/m05-chat-agent.md (op: create)
#### [iv1lmc33] Cel (section)

<after_change>
Użytkownik rozmawia w overlayu czatu z agentem, który zna całą specyfikację i sam ją czyta oraz zmienia — strony, encje, referencje — zamiast dyktować zmiany człowiekowi. Agent działa na adapterze uruchamiającym lokalne CLI z sesją subskrypcyjną użytkownika, więc nie wymaga klucza API; UI czatu to własna powłoka overlaya — zintegrowana z edytorem i adnotacjami — złożona z gotowych hooków i bloków biblioteki czatowej.

Agent widzi bieżący stan roboczy specyfikacji; odczyt historyczny — mrożony snapshot wydania — jest opcją, nie domyślną posturą, i nigdy nie materializuje się w katalogu roboczym. Wątki czatu zostają lokalne i prywatne — moduł niczego z nich nie publikuje.
</after_change>

#### [t3fsdybv] Zależności (section)

<after_change>
Agent nie wykonuje niczego sam — każda jego zdolność to operacja cudzego modułu wystawiona turze jako narzędzie, a kolejne rodzaje wątku wnoszą moduły, które nimi zarządzają.

<tagged_list type="module-dependency" tags="m05"/>
</after_change>


## Context @2.1.14 — m05-chat-agent.md offset 21
### pages/modules/m05-chat-agent/m05-chat-agent.md (op: create)
#### [2q0prdli] `<agent_path_scope>` (section)

<after_change>
**Warunek emisji.** Blok stoi zawsze, w każdej turze i przy każdym zakresie — także maksymalnie szerokim. Pominięcie go przy zakresie bez ograniczeń byłoby dla agenta nieodróżnialne od braku takiej koncepcji w systemie, a to jest inna wiadomość niż „wolno ci wszędzie”.

Wyliczenie zakresu powstaje przy składaniu z wartości, których regułę — co jest podstawą, co zbiorem zamkniętym bezwarunkowo i w jakiej kolejności jedno bije drugie — ustala <section_ref anchor="nn4361ab"/>. Wkład jest przewodnikiem kierunkowym, a nie granicą: samą granicę egzekwuje piaskownica tury i to w niej, nie w prompcie, wyjście poza zakres się nie udaje.

Jedna linia ciała jest warunkowa, choć sam blok nie jest. Wiersz stawiający przestrzenie stron jako tylko do odczytu dla wbudowanych narzędzi stoi wyłącznie wtedy, gdy przestrzenie stron w ogóle są **i** tura ma zamontowany serwer operacji na stronach — inaczej wskazywałby operacje, których tura nie ma. Warunek dotyczy tej jednej linii, nie obecności bloku: przy jej braku bloku nie ubywa.

Blok **nie wymienia serwerów z nazwy** — po nie odsyła do wkładu narzędziowego tury. Zestaw zamontowanych serwerów jest inny w różnych turach, więc wyliczenie w ciele bloku było zdaniem prawdziwym tylko dla jednej z nich.

**Szablon.**

<single_element type="code-snippet" slug="szablon-agent-path-scope"/>
</after_change>


## Context @2.1.14 — m05-chat-agent.md offset 27..31
### pages/modules/m05-chat-agent/m05-chat-agent.md (op: create)
#### [l8kbpbza] Project Settings (L17) (section)

<after_change></after_change>

#### [6xegs5ac] Plik konfiguracyjny (section)

<after_change>
| Klucz | Typ | Default | Walidacja | Klasa efektu | Blokada wznowienia | Zapis przez API |
|---|---|---|---|---|---|---|
| `agent.claudeUsePreset` | boolean | `false` — prompt systemowy bez presetu Claude Code | | `per-tura` | nie | tak |
| `agent.conversationalLanguage` | string albo `null` | `null` — brak dyrektywy języka rozmowy | `null` albo nazwa z listy języków (<section_ref anchor="m01supplng"/>) | `nowy-wątek` | nie | tak |
| `agent.allowedPaths` | lista ścieżek | `[]` — sama baza zakresu plików (<section_ref anchor="nn4361ab"/>) | | `nowy-wątek` | tak | tak |
| `agent.disallowedPaths` | lista ścieżek | `[]` — wyłącznie wykluczenia predefiniowane (<section_ref anchor="nn4361ab"/>) | | `nowy-wątek` | tak | tak |
| `agent.disableDirectFilesystemAccess` | boolean | `true` — agent bez narzędzi plikowych i powłoki (<section_ref anchor="25mntsy2"/>) | | `nowy-wątek` | tak | tak |
</after_change>

#### [m26agsec] Strona ustawień (section)

<after_change>
**Karty**

| Karta | Kotwica URL | Grupa | Waga | Warunek widoczności |
|---|---|---|---|---|
| Agent | `#agent` | Agent | 10 | |

**Elementy**

| Element | Karta | Waga | Rodzaj | Wartość | Warunek widoczności | Komunikat efektu |
|---|---|---|---|---|---|---|
| Use Claude Code preset | `#agent` | 10 | `toggle` | `agent.claudeUsePreset` | | `Applies from the next agent turn, also in ongoing conversations.` |
| Conversational language | `#agent` | 20 | `select` — lista języków (<section_ref anchor="m01supplng"/>) i opcja `None` zapisywana jako `null` | `agent.conversationalLanguage` | | `Applies from the next new conversation.` |
| Block direct file access | `#agent` | 30 | `toggle` | `agent.disableDirectFilesystemAccess` | | `This change applies to the whole project and ends the ability to resume existing conversations — they will need a new one.` |
| File access enforcement | `#agent` | 40 | `własny` | — | | |
| Allowed paths | `#agent` | 50 | `lines` | `agent.allowedPaths` | `agent.disableDirectFilesystemAccess` wyłączone | `Changing the file scope applies to the whole project and ends the ability to resume existing conversations — they will need a new one. New conversations use the new scope right away.` |
| Always excluded | `#agent` | 60 | `własny` | — | zawsze, niezależnie od `agent.disableDirectFilesystemAccess` | |
| Disallowed paths | `#agent` | 70 | `lines` | `agent.disallowedPaths` | `agent.disableDirectFilesystemAccess` wyłączone | `Changing the file scope applies to the whole project and ends the ability to resume existing conversations — they will need a new one. New conversations use the new scope right away.` |
| Anthropic API key | `#agent` | 80 | `własny` | poza plikiem | | `Applies from the next agent turn, also in resumed conversations.` |

**Teksty pomocnicze**

| Element | Rodzaj | Tekst |
|---|---|---|
| Use Claude Code preset | tooltip | `Append the Claude Code preset to the agent's system prompt. Off by default — the agent receives only the project's prompt.` |
| Conversational language | tooltip | `The language the agent always replies to you in, in chat, regardless of the language of your question. It does not affect the language of the specification content — set that in the Project section.` |
| Block direct file access | helper | `Checked (default): the agent reads and changes the specification only through core operations — it has no file or shell tools. Uncheck only if the agent must work on files outside the specification (code, implementation artifacts).` |
| Allowed paths | helper | `By default the agent sees only the project directory (cwd) and the pages directory. ALLOWED PATHS adds directories, DISALLOWED PATHS excludes them (exclusion wins). Enter absolute paths, one per line.` |

<todo comment="Dwie obowiązkowe noty regresji karty #agent dla projektów bez klucza w pliku (kanał: nota karty i release notes) nie mają literalnych stringów, więc nie weszły do tabeli Teksty pomocnicze: preset Claude Code jest teraz domyślnie wyłączony, także w trwających wątkach od następnej tury; blokada bezpośredniego dostępu jest domyślnie włączona, a odznaczenia wymagają git recovery Fix it with Agent i CLI c4s. Ustalić literalne teksty obu not (wiersze nota karty)."/>

**Elementy własne**
</after_change>

#### [5xehv8t2] File access enforcement — `#agent` (section)

<after_change>
Element tylko do odczytu: pokazuje, jak mocno jest egzekwowana postura plikowa agenta. Treść zależy od stanu `agent.disableDirectFilesystemAccess` po scaleniu, a element stoi bezpośrednio pod przełącznikiem `Block direct file access`.

- **Przełącznik zaznaczony.** Badge siły odebrania narzędzi według wyniku sondy przed dispatchem (<section_ref anchor="25mntsy2"/>): `Tools removed from the catalog (strength: soft)` przy potwierdzeniu, `Enforced softly — model hint only` przy degradacji. Żaden stan nie mówi „hard”. Obok badge'a, nie w tooltipie, element nazywa jedyną drogę obejścia: natywny subagent (`Agent`/`Task`) nie dziedziczy tych ograniczeń. Pod spodem nota: `The file scope still exists — the hard system sandbox remains the only restriction that covers the native subagent. It stops being editable, not being enforced.`
- **Przełącznik odznaczony.** Badge siły zakresu plików według wsparcia adaptera (<section_ref anchor="nn4361ab"/>): `Enforced by the sandbox` przy natywnym sandboxie, `Enforced softly (model hint only)`, gdy adapter nie ma natywnego zakresu plików albo degraduje z twardego do miękkiego. W odróżnieniu od badge'a odebrania narzędzi ten badge ma stan twardy.
- Akcji, walidacji ani efektów poza kartą element nie ma.
</after_change>

#### [8lk6hpxp] Always excluded — `#agent` (section)

<after_change>
Element tylko do odczytu, widoczny **zawsze**, niezależnie od `agent.disableDirectFilesystemAccess`; przy odznaczonej fladze stoi nad `Disallowed paths`. Wyszarzona, nieedytowalna lista katalogów korzeni z `agentDirectFs = nie` (L13) — `dir` każdego takiego korzenia rejestru, ścieżką względną wobec katalogu projektu — z notą `Always excluded — artifacts are edited only through the agent's tools (not by hand). This cannot be turned off.`

- Lista to predefiniowany deny-set zakresu plików (<section_ref anchor="nn4361ab"/>): ma pierwszeństwo nawet nad `Allowed paths` i nie jest zapisywana do `agent.disallowedPaths`, więc element nie uczestniczy we wspólnym zapisie karty.
- **Dlaczego nie znika razem z polami ścieżek.** Deny-set obowiązuje przy każdej wartości flagi — jest zawsze przekazywany do adaptera i zawsze trafia do linii `ALWAYS DISALLOWED` bloku `<agent_path_scope>` (<section_ref anchor="2q0prdli"/>). Ukrycie reguły, która nadal działa, wprowadzałoby użytkownika w błąd; nota „This cannot be turned off” mówi to samo.
</after_change>


## Context @2.1.14 — agent-posture.md offset 1..2
### pages/modules/m05-chat-agent/agent-posture.md (op: create)
#### [nn4361ab] Path scoping (FS) (section)

<after_change>
Agent jest **zamknięty** w obrębie swojego projektu: domyślnie wolno mu `cwd` (oraz katalogi korzeni rodzaju `pages` leżące poza `cwd` — L13), a user może tę bazę **poszerzyć** (`agent.allowedPaths`) lub **zawęzić** (`agent.disallowedPaths`) z poziomu ustawień (pola <section_ref anchor="6xegs5ac"/>, karta ustawień Agent <section_ref anchor="m26agsec"/>). **Twardy gate to natywny sandbox adaptera/biblioteki** (`external/inharness-packages.md` <section_ref anchor="o6q60z0m"/>), egzekwowany na poziomie syscalli — obejmuje subprocesy Basha **bez** parsowania `command`. **Uwaga: jest jednokanałowy** — domyka **zapis** do allow-setu + jawne deny read/write na `disallowedPaths`, ale **nie** zamyka odczytu poza `disallowedPaths` (patrz reguła „Read+write łącznie" niżej). M05 **nie** inspekcjonuje argumentów narzędzi (Read/Write/Edit/Glob/Grep) ani nie parsuje Basha; nasza rola to: **resolve zakresu → przekazanie do adaptera → obsługa sygnału degradacji**.

**Resolver `resolveAgentPathScope({ cwd, roots, allowedPaths, disallowedPaths })`**, gdzie `roots` to rejestr korzeni (L13):

- **Baza implicit** = `cwd` ∪ `{ r.dir : r w rejestrze, rodzaj r = pages }` (katalogi **korzeni rodzaju `pages`** — korzeń podstawowy i korzenie użytkownika; np. korzeń `.claude/skills` **poza** `cwd` **musi** trafić do bazy, inaczej twardy sandbox blokowałby edycję jego stron przez agenta). Katalogi korzeni z `agentDirectFs = nie` leżą **wewnątrz** `cwd` (stały `.claude4spec/<kind>`) → są pokryte przez `cwd` **w allow-bazie**, ale **jednocześnie dodane do implicit deny-setu** (patrz niżej), więc netto **wykluczone** z ręcznego dostępu built-inów. `cwd` **nie** jest doklejany do `allowedPaths` — bazę dokłada biblioteka sama (kontrakt LIB). `dir` korzenia *wewnątrz* `cwd` → już objęty bazą; *poza* `cwd` → resolver dokłada go do `allowedPaths`.
- **Implicit deny-set (predefiniowany, nieprzełamywalny)** = `{ r.dir : r w rejestrze, rodzaj r ma agentDirectFs = nie }`, znormalizowane do ścieżek **absolutnych** (względem `cwd`). Dokładany **zawsze**, niezależnie od list usera — to twardy hard-lock katalogów korzeni systemowych C4S. **Wyprowadzany z rejestru korzeni, nie hardcode** — katalogi są stałe, więc zbiór zmienia się tylko z wersją aplikacji. Predefiniowany deny **wygrywa nawet nad `config.agent.allowedPaths`** usera (precedencja `deny > allow > baza` gwarantowana przez bibliotekę) — user **nie może** otworzyć tych katalogów żadnym wpisem allow. Brak opt-out flagi.
- **allow** = baza ∪ `config.agent.allowedPaths`; **deny** = implicit deny-set ∪ `config.agent.disallowedPaths`. Precedencja **deny > allow > baza** (gwarantowana przez bibliotekę).
- **Granica egzekucji** — deny egzekwują wyłącznie **wbudowane** toole FS agenta (Read/Write/Edit/Glob/Grep) oraz spawnowany Bash (twardy sandbox, syscall-level). **MCP CRUD artefaktów** (`plan-tools`/`brief-tools`/`patch-tools`/`entity-tools`/`release-tools`) piszą do tych katalogów **z hosta, in-process, poza sandboxem** (M05 L3 `createMcpServer`) → deny ich **nie** rusza. Rozdzielenie „ręczna edycja built-inem" vs „edycja przez narzędzie" jest darmowe — sandbox nie rozróżnia kierunku, blokada dotyczy tylko kanału built-in.
- **Normalizacja** — wszystko do ścieżek **absolutnych** (względne resolvowane wzgl. `cwd`), zakaz traversal poza zadeklarowany katalog. Do `adapter.execute` przekazujemy wyłącznie ścieżki absolutne (rekomendacja LIB — bezpieczne przy każdym rozstrzygnięciu formatu).
- **Read+write łącznie (intencja v1 kontraktu LIB)** — konsument deklaruje **jeden zakres** „dostępu", bez rozróżnienia kierunku. **Realizacja w claude-code hard mode jest jednak asymetryczna:** natywny sandbox domyka **tylko zapis** do allow-setu + jawne deny read/write na `disallowedPaths`; **odczyt poza `disallowedPaths` pozostaje otwarty** (default-allow) — rezydualny read-leak, którego **nie da się** domknąć per-call sandbox options (`allowRead` w SDK to re-allow *wewnątrz* `denyRead`, nie restrykcyjna allow-lista; pełne domknięcie odczytu wymaga policy settings `allowManagedReadPathsOnly`, nie per-call `options.sandbox.filesystem`). Pełny kontrakt i uzasadnienie: `external/inharness-packages.md` <section_ref anchor="o6q60z0m"/>. **Korzenie z `agentDirectFs = nie` na implicit deny-secie** — jawny deny domyka dla built-inów **read+write** (agent traci też ręczny odczyt), co jest OK: dostęp odczytowy zapewniają MCP toole (<inline_mention type="mcp-tool" slug="plan-tools-get-plan"/>, `brief-tools`, <inline_mention type="mcp-tool" slug="patch-tools-get-patch"/>, <inline_mention type="mcp-tool" slug="entity-tools-get-entities"/>, `release-tools`). Brak regresu funkcjonalnego.

**Przekazanie do adaptera** — wynik resolvera (efektywny zakres, ścieżki absolutne) idzie **dwiema drogami** z handlera tury agenta (`runAgentTurn` w `routes/agent-turn.ts`): (1) do `adapter.execute({ allowedPaths, disallowedPaths })` (`RuntimeExecuteParams`, `external/inharness-packages.md` <section_ref anchor="o6q60z0m"/>) — **twardy** sandbox; (2) jako `SystemPromptInput.agentPathScope` do `buildSystemPrompt` — **miękki** blok `<agent_path_scope>` (warstwa kierunkowa, <section_ref anchor="2q0prdli"/>). **Zakres jest session-immutable** — oba pola wchodzą do snapshotu tury-1 i do zbioru resume-locked (<section_ref anchor="z9g82hug"/>), więc zmiana ustawień obowiązuje od pierwszej tury **nowego** wątku, nie w kolejnych turach bieżącego; to dokładnie to samo okno, w którym zmienia się persystowany miękki blok (`setInitialSystemPrompt`). Obie listy puste → sama baza implicit plus deny-set korzeni z `agentDirectFs = nie`, a blok `<agent_path_scope>` i tak jest emitowany: agent musi wiedzieć, że zakres **istnieje**, także gdy jest maksymalnie szeroki — pominięcie bloku jest nieodróżnialne od „brak takiej koncepcji".

**Obsługa degradacji** — dwa kanały sygnału z biblioteki:

- **statyczny capability** `architectureCapabilities(arch).pathScope` — czytany **przed** runem; gdy adapter nie wspiera natywnie (OpenCode), runtime odnotowuje `warn` i poleganie na **miękkim bloku promptu** `<agent_path_scope>` (<section_ref anchor="2q0prdli"/>) jako **jedynej** warstwie. Degradację sygnalizuje element `File access enforcement` karty ustawień (<section_ref anchor="5xehv8t2"/>).
- **runtime** event `{ type: 'warning'; message: string }` w strumieniu `execute()` — gdy adapter degraduje twardy→miękki (brak bubblewrap/seatbelt na hoście Claude Code) lub w ogóle nie ma sandboxa. **Widoczny dla użytkownika:** renderowany w strumieniu czatu i persystowany na równi z pozostałymi zdarzeniami tury, więc wchodzi też do replayu (tabela UnifiedEvent <section_ref anchor="yeplbpzz"/>). To **jedyny** kanał, którym konsument dowiaduje się o degradacji zakresu FS oraz o ignorowanych polach `RuntimeExecuteParams` — ostrzeżenie, którego nikt nie widzi, jest równoważne jego brakowi, a dotyczy gwarancji bezpieczeństwa.
- **Jawne „twardy → miękki"** — nie traktujemy statycznego `pathScope: ✅` jako gwarancji **twardego** sandboxa (siła zależy od hosta, znana dopiero w runtime). Miękki blok promptu zostaje **warstwą kierunkową/UX** komplementarną do natywnego gate'u; przy adapterach bez wsparcia jest jedyną warstwą.

**Zakres FS i gating grupowy SUMUJĄ się — nasza konsekwencja, nie tylko kontrakt biblioteki.** Stała projektowa postura narzędziowa (`agent.disableDirectFilesystemAccess`) żyje w <section_ref anchor="25mntsy2"/>; tutaj zostaje wyłącznie to, jak obie osie się składają. Dzisiejsza specyfikacja opisuje precedencję **wewnątrz** path-scope (`deny > allow > baza`) i nic więcej; kompozycja z `disallowedToolGroups` była przemilczana, a przemilczenie łatwo czyta się jako ortogonalność. Trzy zdania wiążące:

- **`agent.allowedPaths` nigdy nie odblokuje narzędzia zdenied grupowo.** Poszerzenie zakresu katalogów nie jest poszerzeniem katalogu narzędzi. Użytkownik, który dopisuje katalog do allow-listy w Settings, nie może tym ruchem cofnąć plan mode — i nie powinien tego próbować.
- **Deny grupowy odbiera narzędzie modelowi, path-scope tylko odmawia dostępu.** To dwie różne obserwowalności w transkrypcie: w pierwszym przypadku model narzędzia **nie widzi**, w drugim widzi je i dostaje odmowę. Różnica jest istotna dla renderu i dla każdego kryterium akceptacji, które mówi „agent nie może X".
- **`autoApproveTools` nie jest furtką** — auto-zatwierdza permissions i nigdy nie przywraca narzędzia z grupy zdenied. Pełny kontrakt: <section_ref anchor="o6q60z0m"/>.

> **Zadeklarowanie zakresu FS odbiera agentowi powłokę i sieć — nawet gdy nikt o to nie prosił.** Gdy **co najmniej jedna** z list (`agent.allowedPaths` / `agent.disallowedPaths`, po dołożeniu naszego implicit deny-setu) jest niepusta, a gate jest **miękki** (host bez bubblewrap/seatbelt), adapter przechodzi na `permissionMode: 'dontAsk'` i pre-approve dostają **wyłącznie file built-iny** — `Bash`, `WebFetch` i `WebSearch` tracą pre-approval. To jest **realna redukcja capability, której konsument nie zamówił z nazwy**, i dotyczy nas natychmiast: nasz implicit deny-set — korzenie z `agentDirectFs = nie` — jest dokładany **zawsze**, więc `disallowedPaths` jest u nas **z definicji niepuste** i ścieżka path-scope jest **zawsze** zażądana.
>
> **Czego to twierdzenie NIE mówi.** Nie mówi, że puste listy cokolwiek odbierają. Przy obu listach pustych adapter nie wchodzi w ścieżkę path-scope w ogóle — `permissionMode` zostaje `bypassPermissions`, a no-op jest ścisły i obejmuje także tryb permissions, nie tylko mapowanie ścieżek. Dwa stany są rozłączne i oba trzeba opisać osobno; zlanie ich dałoby zdanie fałszywe w jedną albo w drugą stronę.

**Jeden builder zakresu na każdy call-site `adapter.execute`.** Zakres tury składa **ten sam builder** (`resolveAgentPathScope` + posture z rejestru kontekstów <section_ref anchor="m05ctxreg"/>) niezależnie od tego, kto woła adapter: route czatu, `runAgentTurn` wołany przez dispatcher transagenta, czy serwis stojący za narzędziem MCP. **Narzędzie MCP nie jest furtką omijającą zawężenia tury, z której je zawołano** — dziedziczy jej zakres. Ma to znaczenie zwłaszcza dla tury `context_type='ask'`, która ma wymuszony plan mode.

**Audyt semantyczny AC dziedziczy scope tury** — <inline_mention type="mcp-tool" slug="ac-tools-analyze-ac-against-entities"/>. Jego wewnętrzne `adapter.execute` przechodzi przez ten sam builder, więc dostaje: `planMode: true` (analiza AC jest z natury read-only — czyta AC i encje przez host, zwraca listę problemów), `allowedPaths` / `disallowedPaths` z configu projektu, **implicit deny-set korzeni z `agentDirectFs = nie`** oraz `architectureConfig` z `claude_sandbox`.

> **Granica cross-repo (prerequisite szczelności).** Nawet skonfigurowany, twardy zakres nie jest jeszcze szczelny z powodu trzech braków **w bibliotece** (`settingSources` nieograniczane → globalne discovery `~/.claude/skills`/`~/.claude/settings.json`; bezwarunkowy `bypassPermissions`; miękka brama deny-only zamiast allow-confinement). Nie do naprawienia w claude4spec samodzielnie — wymaga companion-change w `agent-adapters` + bumpu wersji. Kontrakt i status: `external/inharness-packages.md` <section_ref anchor="o6q60z0m"/> (peer „LIB - agent-adapters", wątek `D9zEOmFen_dP`).
</after_change>

#### [25mntsy2] Gating grupowy built-inów (`agent.disableDirectFilesystemAccess`) (section)

<after_change>
Path scoping wyżej odbiera agentowi **katalogi**; ta sekcja odbiera mu **narzędzia**. Czyta się je razem, bo obie są posturą tury składaną przez ten sam builder — ale są to dwie różne osie i różne obserwowalności, a zlanie ich daje zdanie fałszywe w jedną albo w drugą stronę.

**Granica funkcji.** Tryb wyłączonych built-inów jest trybem pracy **nad specyfikacją**, nie nad repozytorium. Praca poza spec — kod, git, `c4s` CLI, cudze repo — zostaje przy built-inach z zamysłu i wymaga odznaczenia flagi na karcie ustawień (<section_ref anchor="m26agsec"/>).

**Mapowanie, jawnie i w jednym miejscu.** `config.agent.disableDirectFilesystemAccess === true` (default — <section_ref anchor="6xegs5ac"/>) ⇒ `disallowedToolGroups ⊇ ['file-read', 'file-write', 'shell']`. **Nie enumerujemy nazw narzędzi** — kontrakt ich nie przyjmuje i nie przyjmie (`external/inharness-packages.md` <section_ref anchor="xkyowcpq"/>: wiedza „które identyfikatory znaczą shell" należy do adaptera, nie do konsumenta). Egzekucja to **residual allow-lista**, nie deny-lista: adapter liczy zbiór dozwolonych built-inów jako resztę po odjęciu grup, więc **built-in nieznany bibliotece jest blokowany, nie dozwolony**, a bump SDK degraduje w stronę bezpieczną.

**Suma z presetem `planMode`, i dlaczego to nie jest ta sama oś.** Efektywne `disallowedToolGroups` tury = grupy stałe projektu **∪** grupy presetu `planMode` (`['file-write', 'shell']`). Preset **nigdy** nie może zostać osłabiony przez to pole ani przez żadną wartość configu. Dwie osie różnią się **czasem życia**: preset jest per-tura i przełączalny w środku wątku (<section_ref anchor="yazwev1g"/>), nasze grupy są **stałe na cały wątek**.

**Guard resume porównuje NASZE pole, nie policzoną unię (mandatory).** Skoro `planMode` desugaruje się do tego samego `disallowedToolGroups`, guard porównujący **policzone** grupy odrzucałby **każdy** flip Plan Mode kodem `409`. Dlatego snapshot tury-1 niesie `agent.disableDirectFilesystemAccess` — pojedynczy boolean z configu — a **nie** wynik desugarowania. To domyka kontrakt opisany w <section_ref anchor="z9g82hug"/> i <section_ref anchor="7m7kxrbn"/>: pole wchodzi do snapshotu i do zbioru resume-locked, więc wznowienie wątku założonego przy innej wartości kończy się `409 RESUME_CONFIG_LOCKED`, a flip Plan Mode w tym samym wątku przechodzi bez przeszkód.

**`shell` zabiera więcej niż powłokę — i akurat to jest zysk.** Grupa `shell` **suppressuje `Skill`**, więc przy aktywnej fladze natywny `Skill()` znika z katalogu narzędzi **także poza plan mode**. To domyka warstwę 2 blokady D6 (M37 <section_ref anchor="1qv5jepp"/>) tam, gdzie zapisano, że warstwy 2 „nie ma i nie będzie": przy włączonej fladze jest, jako skutek uboczny grupy, a nie osobny mechanizm. Kanałem otwierania skilli pozostaje <inline_mention type="mcp-tool" slug="skill-tools-load-skill-file"/>, który gatingu nie dotyka.

**`shell` wyłącza też start zadań w tle.** Zadania **trwające** dobiegają naturalnie i ich wyniki są dostarczane; **nowe nie startują** (*skip*, nie degradacja do zgłoszenia). Ta sama semantyka co przy presecie — <section_ref anchor="057mv7pz"/>.

**Relacja do path-scope: sumowanie, nie ortogonalność.** Trzy zdania wiążące z <section_ref anchor="nn4361ab"/> zyskują tu ostrzejszą wersję. Przy odciętych grupach plikowych **żadna reguła allow z path-scope nie powstaje w ogóle**, więc `agent.allowedPaths` / `agent.disallowedPaths` **nie mają skutku dla kanału built-in** — nie ma czego bramkować. **Ale nie stają się martwe:** twardy sandbox systemowy pozostaje **jedynym confinementem obejmującym natywnego subagenta**, który deny-grup nie dziedziczy. Wartości zostają w configu i nadal jadą do adaptera; znikają wyłącznie edytowalne pola `Allowed paths` i `Disallowed paths` na karcie ustawień (<section_ref anchor="m26agsec"/>) — zakres przestaje być edytowalny, nie przestaje być egzekwowany, co mówi nota elementu `File access enforcement`. Lista `Always excluded` zostaje widoczna przy każdej wartości flagi, bo implicit deny-set nie zależy od niej w ogóle.

**MCP jest poza gatingiem — bez wyjątków.** Grupy dotyczą wyłącznie built-inów. Cała powierzchnia rdzenia (`reference-tools`, `entity-tools`, `plan-tools`, `release-tools`, `skill-tools`, `c4s-tools`, `transagent-tools`) przeżywa wyłączenie built-inów nietknięta — to dokładnie to, co czyni tę flagę możliwą bez regresu funkcjonalnego w pracy nad spec. Jedyną dźwignią konsumenta wobec MCP jest **nie zamontować serwera** (rejestr kontekstów, <section_ref anchor="m05ctxreg"/>).

**Sonda przed dispatchem.** `routes/agent-turn.ts` woła `probeToolGating(arch, groups)` **przed** `adapter.execute` — ta sama odpowiedzialność, którą <section_ref anchor="yazwev1g"/> opisuje już dla presetu; flaga nie dokłada nowego mechanizmu, tylko poszerza listę badanych grup o `file-read`. Sonda zwraca per grupę `{ enforceable, strength, escapeSurfaces }`; grupa nieegzekwowalna → `AdapterToolPolicyError` **przed** startem tury — to **odmowa**, nie awaria, mapowana w kopercie błędu L4 i w SSE.

**Siła i droga obejścia, nazwane wprost.** Na `claude-code` wszystkie trzy grupy są egzekwowalne, ale o sile **`soft`** — to model-behaviour gate, nie sandbox. Deny **usuwa narzędzie z katalogu modelu** (inna obserwowalność niż path-scope, który narzędzie zostawia i odmawia dopiero przy próbie użycia), ale natywny `Agent`/`Task` startuje z pełnym toolsetem i **nie dziedziczy deny-grup** (`modules/m45-subagents.md` <section_ref anchor="otdgxqdo"/>), więc sonda raportuje go jako `escapeSurface`. Spec **nie twierdzi**, że gating jest szczelny — nazywa go tym, czym jest: usunięciem narzędzi z katalogu przy sile `soft`, z jedną udokumentowaną powierzchnią ucieczki.

**Propagacja na subagentów programowych jest kontraktem.** Deny-grupy biegu `execute()` aplikują się do **każdej** `SubagentDefinition` tego biegu — przez **przecięcie, nigdy poszerzenie** (`external/inharness-packages.md` <section_ref anchor="inhagents1"/>). Enumerowanie w `tools` narzędzia należącego do grupy zdenied **nie jest błędem**; przecięcie po prostu wygrywa. Konsekwencje dla `spec-explore` i `diff-explore` — `modules/m45-subagents.md` <section_ref anchor="iqiwak31"/>.

**Jeden builder na każdy call-site `adapter.execute`.** Flaga wchodzi do tego samego buildera co `resolveAgentPathScope`, więc **każdy** call-site dziedziczy gating bez własnej gałęzi: route czatu (<section_ref anchor="tj0960gk"/>), `POST /api/threads/:id/ask` (<section_ref anchor="qs2bk6jt"/>), dispatcher transagenta (<section_ref anchor="tr4ndisp"/>), seed-thread (<section_ref anchor="m05seedthr"/>) oraz wewnętrzne `adapter.execute` audytu AC opisane w <section_ref anchor="nn4361ab"/>. **Narzędzie MCP nie jest furtką omijającą zawężenia tury, z której je zawołano** — dziedziczy jej posturę, tak samo jak dziedziczy jej zakres FS.
</after_change>


## Criteria (ac) — change 2.1.13→2.1.14

```json
[
 {
  "type": "ac",
  "slug": "ac-ekran-m26-directories-blokuje-przycisk",
  "name": "Karta Directories na stronie ustawień ma jeden element — Roots; nie ma na niej pól katalogów planów, briefów, patchy, encji ani wydań.",
  "op": "update",
  "before": {
   "slug": "ac-ekran-m26-directories-blokuje-przycisk",
   "title": "Karta Directories na stronie ustawień ma jeden element — Roots; nie ma na niej pól katalogów planów, briefów, patchy, encji ani wydań.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "l17",
    "m01"
   ],
   "createdAt": "2026-08-03T16:13:09.826Z",
   "updatedAt": "2026-10-05T15:30:58.778Z"
  },
  "after": {
   "slug": "ac-ekran-m26-directories-blokuje-przycisk",
   "title": "Karta Directories na stronie ustawień ma jeden element — Roots; nie ma na niej pól katalogów planów, briefów, patchy, encji ani wydań.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "type": "ui-view",
     "slug": "settings-page"
    }
   ],
   "tags": [
    "l17",
    "m01"
   ],
   "createdAt": "2026-08-03T16:13:09.826Z",
   "updatedAt": "2026-10-09T09:54:40.651Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-element-always-excluded-na-karcie-age",
  "name": "Element Always excluded na karcie Agent (/settings#agent) jest widoczny przy zaznaczonym checkboxie agent.disableDirectFilesystemAccess (stan domyślny), mimo że pola Allowed paths i Disallowed paths są wtedy ukryte.",
  "op": "create",
  "after": {
   "slug": "ac-element-always-excluded-na-karcie-age",
   "title": "Element Always excluded na karcie Agent (/settings#agent) jest widoczny przy zaznaczonym checkboxie agent.disableDirectFilesystemAccess (stan domyślny), mimo że pola Allowed paths i Disallowed paths są wtedy ukryte.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "l17",
    "m05"
   ],
   "createdAt": "2026-10-08T20:44:00.365Z",
   "updatedAt": "2026-10-08T20:44:00.365Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-lista-elementu-roots-na-karcie-direct",
  "name": "Lista elementu Roots na karcie Directories nie pokazuje korzeni systemowych.",
  "op": "update",
  "before": {
   "slug": "ac-lista-elementu-roots-na-karcie-direct",
   "title": "Lista elementu Roots na karcie Directories nie pokazuje korzeni systemowych.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "l17",
    "m01"
   ],
   "createdAt": "2026-10-05T15:31:09.040Z",
   "updatedAt": "2026-10-05T15:31:09.040Z"
  },
  "after": {
   "slug": "ac-lista-elementu-roots-na-karcie-direct",
   "title": "Lista elementu Roots na karcie Directories nie pokazuje korzeni systemowych.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "type": "ui-view",
     "slug": "settings-page"
    }
   ],
   "tags": [
    "l17",
    "m01"
   ],
   "createdAt": "2026-10-05T15:31:09.040Z",
   "updatedAt": "2026-10-09T09:54:40.653Z"
  }
 }
]
```

## Linked entities @2.1.14 (context, not built)

```json
[
 {
  "type": "ui-view",
  "slug": "settings-page",
  "name": "Settings Page",
  "op": "create",
  "after": {
   "slug": "settings-page",
   "title": "Settings Page",
   "url": "/settings",
   "description": "Jedyna powierzchnia UI do zmiany ustawień projektu. Strona jest składana w całości z deklaracji modułów: karty, elementy i komponenty własne wnoszą moduły-deklaranci, a implementor je rejestruje, porządkuje (grupa → waga karty → waga elementu), generuje z nich kontrolki i montuje jeden pionowy stos kart w outlecie powłoki.\n\nSkład i kolejność kart wynikają z rejestru kart — <section_ref anchor=\"7f76eszm\"/>; montaż, zapis per karta i komunikat efektu — <section_ref anchor=\"oqp0up79\"/>; kontrakt pliku i jego zapis — <section_ref anchor=\"hozcm4w5\"/>, <section_ref anchor=\"ournm78e\"/>. Strona nie renderuje badge'y klas efektu; jedynym sygnałem czasu efektu jest komunikat efektu elementu (<section_ref anchor=\"kkrparjf\"/>).\n\nWejścia do strony i właściciel trasy — M26 <section_ref anchor=\"m26route\"/>.",
   "params": [
    {
     "name": "<kotwica karty>",
     "in": "hash",
     "type": "anchor",
     "required": false,
     "description": "Płynne przewinięcie do karty o tej kotwicy URL. Kotwice deklarują moduły rejestrujące karty (tabela kart w ich sekcjach ustawień projektu, unikalna na stronie); karty pluginów mają kotwicę `plugin-<nazwa>`."
    }
   ],
   "designSystemSlug": "c4s-paper-terra",
   "mockupHtml": null,
   "states": [],
   "tags": [
    "m26"
   ],
   "createdAt": "2026-05-27T20:54:49.000Z",
   "updatedAt": "2026-09-25T16:56:34.286Z"
  }
 }
]
```

## Convention L5 #0
### pages/layers/L5-ui.md (op: create)
#### [ew1yz9k3] L5 — UI (section)

<after_change>
> Kształt opisu interfejsu w pliku modułu: jakie ekrany moduł wnosi i jak je rejestruje, które sloty powłoki zajmuje, jaki stan trzyma po stronie przeglądarki i jakie okna otwiera — to, czego z samych encji widoków wyprowadzić się nie da.
</after_change>


## Convention L5 #1
### pages/layers/L5-ui.md (op: create)
#### [42ewy1oy] Role in the system (section)

<after_change>
Warstwa jest framework-shaped: jeden implementor podnosi powłokę aplikacji webowej — regiony, sloty, hosty okien z rejestrem zdarzeń i trzy szuflady stanu — a konsumenci wnoszą do niej ekrany, deklarują zajmowane sloty, własny stan i własne okna, oraz wyłącznie te miejsca, w których od konwencji odchodzą.

Warstwa **nie** obejmuje frameworka edytora — rozszerzeń, widoków node'ów, komend slash, reguł parsowania markdown — który jest osobną warstwą (`layers/L8-editor.md`) z inną publicznością: powłokę wypełnia garść modułów, edytor niemal wszystkie. Nie obejmuje też anatomii renderowanych komponentów, którą trzyma katalog komponentów hosta (L12), ani wartości tokenów prezentacji.
</after_change>


## Convention L5 #2
### pages/layers/L5-ui.md (op: create)
#### [tehej2wz] Module slice schema (section)

<after_change>
**Każdy moduł dotykający tej warstwy wypełnia swoją sekcję `## UI (L5)`:**

```
Widoki          jeden embed <tagged_list type="ui-view" tags="<tag modułu>" filter="and"/>
                root pages   → tag `mNN` (sam numer modułu, bez sluga)
                root plugins → tag `entity-<typ>`
                każdy ekran i każda trasa to encja `ui-view`: `url` bez prefiksu projektu,
                `params`, opis ekranu w encji (w tym pełnoekranowość trasy — warunek
                przekierowania na nią stoi w `Domain` modułu); bez tabel tras pisanych w prozie
                pomijane, gdy moduł nie wnosi ekranu
Rejestracja     `manifest pluginu` | `trasa bezpośrednia`
                pomijane, gdy moduł nie wnosi ekranu (bez Widoków nie ma czego rejestrować;
                wkład w sloty i w cudze ekrany moduł deklaruje wyłącznie
                w odpowiednich tabelach)
Sloty           tabela slotów poniżej; pomijane, gdy moduł nie zajmuje slotu
Wkład w cudze ekrany
                tabela wkładu poniżej: fragment (baner, sekcja, akcja), który moduł
                wnosi do ekranu innego modułu; pomijane, gdy moduł takiego nie wnosi
Stan            trzy podpola, każde pomijane, gdy puste:
  Store           nazwa store'a, pola trwałe
  Zapytania       klucze zapytań w gramatyce [encja, ...filtry]
                  oraz mapa „zdarzenie WS → klucz zapytania" — jedyny dom tej mapy;
                  inwalidacja zawsze szerokim prefiksem klucza
  Pamięć lokalna  tabela pamięci lokalnej poniżej
Okna            popovery i modale modułu: `kind` w gramatyce
                `<rzecz>-create` | `<rzecz>-edit` | `<rzecz>-<czasownik>`, payload i pola;
                odstępstwa klawiszowe tylko przy `dismissible={false}`
                toasty modułu bez `kind`: wyzwalacz i treść (po angielsku)
                okno zakotwiczone we własnym komponencie modułu nie jest oknem
                powłoki i do pola nie wchodzi
Odstępstwa      tabela odstępstw poniżej; brak wierszy = moduł trzyma konwencję warstwy
```

Tabela slotów: `| Slot | Co moduł wnosi | Warunek widoczności |`. Kolumna `Slot` przyjmuje wyłącznie nazwę z zamkniętej listy: `Pas awarii`, `Nagłówek`, `User`, `Drzewa stron`, `ELEMENTS`, `OTHERS`, `Overlay czatu`. Render, położenie i kolejność slotów trzyma implementor; o tym, czy wpis w slocie jest interaktywny, decyduje moduł, który go zajmuje. Nowa nazwa slotu to zmiana tej listy, nie wpis w module.

Tabela wkładu: `| Ekran | Co moduł wnosi | Warunek widoczności |`. Kolumna `Ekran` to wzmianka `<inline_mention type="ui-view" …/>` ekranu gospodarza. Fragment jest faktem dawcy: jego wygląd i warunek stoją w tej tabeli, a reguły — w `Domain` dawcy; encja gospodarza ani sekcja gospodarza go nie powtarzają. Region powłoki to slot, nie cudzy ekran — idzie do tabeli slotów.

Tabela pamięci lokalnej: `| Klucz | Zakres: projekt/globalny | Wersja | Co przechowuje |`

Tabela odstępstw: `| Pole stałe | Od czego odstępstwo | Dlaczego |`

**Pola stałe warstwy — moduł ich nie powtarza**, a jeżeli od któregoś odchodzi, wpisuje jego **nazwę** w kolumnę „Pole stałe" tabeli odstępstw. Nazwy są częścią kontraktu, nie ozdobnikiem: bez nich tabela odstępstw nie ma czego cytować.

| Pole | Treść |
|---|---|
| `Klucz lokalny` | `c4s:<przestrzeń>:<nazwa>`; `<przestrzeń>` należy do dokładnie jednego modułu, który deklaruje ją w polu **Stan** |
| `Format wartości` | `{v, data}` — numer wersji z kolumny „Wersja" i dane |
| `Język stringów` | każdy literalny string widziany przez użytkownika — etykiety, tooltipy, toasty, treść okien, stany puste, placeholdery, komunikaty walidacji, `message` błędów REST pokazywanych w UI — jest po angielsku; proza specyfikacji zostaje po polsku |
| `Slug w URL` | slug wstawiany do ścieżki bez enkodowania |
| `Parametry standardowe` | `?q=<tekst>` — wyszukiwanie; `?tag=<slug>` / `?tags=<slug,slug>` — filtr tagów; `?filter=and\|or` — tryb filtra tagów; każda trasa waliduje własne parametry, a niepoprawne ignoruje |
| `Poza URL` | URL trzyma tylko „gdzie jestem"; otwarcie paneli, szerokości, motyw i wybór wątku czatu żyją w stanie aplikacji albo w pamięci lokalnej |
| `Prefiks projektu` | nie jest częścią trasy modułu |

**Rejestr zdarzeń powłoki jest jeden i należy do implementora.** Moduł otwiera popover albo modal wyłącznie przez fasadę z `kind`, toast — wyłącznie przez fasadę bez `kind`, i nie deklaruje zdarzeń u siebie — schemat nie ma pola na zdarzenia i jest to decyzja, nie przeoczenie: dwa rejestry rozjeżdżają się przy pierwszym dopisanym zdarzeniu.

**Moduł, który warstwy nie dotyka** — nie wnosi ekranu, slotu, stanu, okna ani wkładu w cudzy ekran — pisze nagłówek `## UI (L5) — n/d` i jedno zdanie dlaczego. Jeden zapis, bez wariantów.

**Wypełnienie schematu stoi w jednym pliku modułu.** W module trzymanym w jednym pliku — w nim. W module już rozbitym na podstrony — w tej podstronie, która tę warstwę nosi, a plik główny niesie wtedy sam embed `Widoki` i jedno zdanie-wskaźnik, bez powtarzania pozostałych pól. **Nowych podstron ani nowych plików pod ten schemat się nie zakłada:** rozbicie modułu na katalog jest osobną decyzją o kształcie modułu i nie zapada przy wypełnianiu warstwy.

**Reading mode — implementor:** sekcja tej warstwy w module-implementorze czytana jest w how-mode. Trzyma runtime powłoki — stos, szkielet z regionami i slotami, tryby edytora, hosty okien z rejestrem zdarzeń, szuflady stanu z wrapperem pamięci lokalnej — a nie wypełnienie schematu; własne klucze pamięci lokalnej implementor deklaruje w podpolu **Pamięć lokalna**, tak jak każdy konsument.

> **Implementor module:** `M50 — App Shell`
</after_change>


## Convention L17 #0
### pages/layers/L17-project-settings.md (op: create)
#### [aa2thduz] L17 — Project Settings (section)

<after_change>
> Każde ustawienie projektu i każdy element strony ustawień ma jednego deklaranta — moduł, do którego należy. Plik konfiguracyjny projektu i strona ustawień są sumą tych deklaracji.
</after_change>


## Convention L17 #1
### pages/layers/L17-project-settings.md (op: create)
#### [mj2r93no] Role in the system (section)

<after_change>
Warstwa jest framework-shaped: jeden implementor trzyma plik konfiguracyjny (koperta, wersja pliku i migracja, normalizacja, scalanie), transport odczytu i zapisu, taksonomię klas efektu wraz z reakcją na każdą z nich, rejestr kart i elementów oraz montaż strony ustawień; konsumenci deklarują pola, karty i elementy. To, na czym konsument może polegać, opisuje implementor w swojej sekcji tej warstwy.

Warstwa **nie** obejmuje magazynów ustawień spoza pliku — moduł opisuje je tam, gdzie opisuje swój stan (`UI (L5)` → `Stan` albo tabela L1), a implementor ich nie czyta ani nie pisze. Nie definiuje też okien ani toastów: te stoją w polu `Okna` warstwy L5. Strona ustawień ma jeden kanał wkładu — moduł wnosi do niej wyłącznie przez tę warstwę, nigdy przez `Wkład w cudze ekrany` warstwy L5.
</after_change>


## Convention L17 #2
### pages/layers/L17-project-settings.md (op: create)
#### [ata1r5sz] Module slice schema (section)

<after_change>
**Każdy moduł dotykający tej warstwy wypełnia swoją sekcję `## Project Settings (L17)`:**

```
### Plik konfiguracyjny   tabela pól poniżej; pomijana, gdy moduł nie wnosi
                          żadnego klucza do pliku
### Strona ustawień       pomijana, gdy moduł nic na stronie nie pokazuje
  Karty                   tabela kart poniżej: karty, które moduł rejestruje;
                          pomijana, gdy żadnej
  Elementy                tabela elementów poniżej: elementy, które moduł wnosi
                          do kart własnych i cudzych
  Teksty pomocnicze       tabela tekstów poniżej; pomijana, gdy brak tekstów
  Elementy własne         nagłówek H4 na każdy element rodzaju `własny`;
                          pomijane, gdy żadnego
```

**Tabela pól:** `| Klucz | Typ | Default | Walidacja | Klasa efektu | Blokada wznowienia | Zapis przez API |`

- `Klucz` — ścieżka z kropkami od korzenia pliku. **Jeden klucz ma dokładnie jednego deklaranta.** Obiekt deklaruje się liśćmi (`git.enabled`, nie `git`). Pola pluginu mieszkają wyłącznie pod `plugins.<nazwa pakietu>` i deklaruje je plugin, nie moduł.
- `Default` — wartość przy braku klucza. Brak klucza nigdy nie znaczy „funkcja wyłączona”, chyba że default tak mówi.
- `Walidacja` — reguła prozą. Reguła międzypolowa nazywa drugi klucz i liczy się od stanu po scaleniu. Pusta komórka znaczy: tylko typ. Reguła poprzedzona prefiksem `UI:` jest sprawdzana wyłącznie w przeglądarce i zapis przez API jej nie egzekwuje; reguła bez prefiksu obowiązuje także przy zapisie przez API.
- `Klasa efektu` ∈ `per-operacja` | `per-tura` | `nowy-wątek` | `przebudowa-kontekstu`:
  - `per-operacja` — wartość czytana przy każdej operacji, która z niej korzysta;
  - `per-tura` — wartość obowiązuje od następnej tury agenta, także w istniejącym wątku;
  - `nowy-wątek` — wartość obowiązuje od pierwszej tury nowego wątku;
  - `przebudowa-kontekstu` — zmiana wymaga przebudowy kontekstu projektu, bez restartu procesu.
- `Blokada wznowienia` ∈ `tak` | `nie` — `tak` znaczy, że wznowienie wątku założonego przy innej wartości jest odrzucane.
- `Zapis przez API` ∈ `tak` | `nie` — `nie` znaczy, że pole ustawia się wyłącznie ręczną edycją pliku.

Treść przyszłego kroku migracji pliku, który dotyczy pola, opisuje jego deklarant pod tabelą pól. Historii pliku sekcja nie opisuje — tylko obecny kształt.

**Tabela kart:** `| Karta | Kotwica URL | Grupa | Waga | Warunek widoczności |`

- `Karta` — tytuł, literalny string po angielsku (pole stałe L5 `Język stringów`).
- `Kotwica URL` — `#<kebab>`, unikalna na stronie; dwie takie same kotwice to błąd rejestracji.
- `Grupa` ∈ `Account` | `Project` | `Integrations` | `Plugins` | `Agent` | `System`. Lista jest zamknięta, a jej kolejność to kolejność grup na stronie. Nowa grupa to zmiana tej listy, nie wpis w module.
- `Waga` — liczba całkowita; mniejsza waga stoi wyżej w obrębie grupy.
- `Warunek widoczności` — proza o stanie; pusta komórka znaczy: zawsze.

Lista kart jest otwarta: nowa karta to wiersz w module, bez zmiany warstwy i bez zmiany implementora.

**Tabela elementów:** `| Element | Karta | Waga | Rodzaj | Wartość | Warunek widoczności | Komunikat efektu |`

- `Element` — etykieta, literalny string po angielsku.
- `Karta` — kotwica URL karty własnej albo cudzej. Element w **cudzej** karcie wymaga rekordu zależności do modułu, który tę kartę rejestruje; rejestracja własnej karty i element we własnej karcie są relacją z warstwą i rekordu nie wymagają.
- `Waga` — liczba całkowita; porządek w obrębie karty. Strona sortuje według grupy, potem wagi karty, potem wagi elementu.
- `Rodzaj` ∈ `toggle` | `text` | `textarea` | `lines` (jedna wartość na linię) | `select` | `multiselect` | `path` | `własny`:
  - rodzaje od `toggle` do `path` generuje implementor; przy `select` i `multiselect` komórka podaje źródło opcji;
  - `własny` to komponent modułu, opisany w `Elementy własne`; komórka zawiera samo słowo `własny`.
- `Wartość` ∈ klucz z tabeli pól **tego** modułu | lista kluczy | `poza plikiem` | `—`:
  - lista kluczy — przy rodzaju `własny` kilka kluczy z tabeli pól **tego** modułu, rozdzielonych przecinkami;
  - `poza plikiem` — ustawienie trwałe, którego magazyn moduł opisuje w `UI (L5)` → `Stan` albo w L1;
  - `—` — odczyt albo akcja, niczego nie zapisuje;
  - rodzaj generowany wymaga dokładnie jednego klucza; `poza plikiem` wymaga rodzaju `własny`.
- `Warunek widoczności` — proza o stanie; pusta komórka znaczy: zawsze.
- `Komunikat efektu` — literalny string po angielsku, mówiący użytkownikowi, **kiedy** zmiana zadziała. Występuje tylko przy wartości innej niż `—`. Nigdy nie nazywa klasy efektu; badge'e klas są zakazane.

Klucz, który nie ma wiersza w tabeli elementów, nie ma kontrolki na stronie.

**Tabela tekstów pomocniczych:** `| Element | Rodzaj | Tekst |` — opcjonalna, po tabeli elementów; pomijana, gdy brak tekstów.

- `Element` — etykieta z tabeli elementów albo `(karta <kotwica>)` dla noty całej karty.
- `Rodzaj` ∈ `tooltip` | `helper` | `placeholder` | `licznik` | `nota karty`.
- `Tekst` — literalny string po angielsku; przy `licznik` — wzór, np. `<n>/200`.

**Elementy własne:** nagłówek H4 nazywa element i kotwicę jego karty. Treść prozą:

- stany elementu (pusty, błąd, zależny od stanu środowiska);
- widoczność podkontrolek zależna od innych pól;
- walidacja na żywo i podgląd;
- akcje poza wspólnym zapisem karty;
- efekty widoczne poza kartą.

Okna i toasty elementu podsekcja nazywa po `kind`; definiuje je pole `Okna` w `UI (L5)` modułu.

**Moduł, który warstwy nie dotyka** — nie wnosi klucza do pliku ani niczego do strony — pisze nagłówek `## Project Settings (L17) — n/d` i jedno zdanie dlaczego. Jeden zapis, bez wariantów.

**Reading mode — implementor:** sekcja tej warstwy w module-implementorze czytana jest w how-mode. Trzyma runtime warstwy — rejestr pól, kontrakt pliku, transport, klasy efektu, rejestr kart i elementów, montaż strony, karty generowane — a nie wypełnienie schematu.

**Kryteria akceptacji** slice'u są encjami `ac` tagowanymi tagiem modułu i tagiem `l17`; renderują się we wspólnych embedach modułu i nie mają w tej sekcji drugiego embeda.

> **Implementor module:** `M26 — Project Settings`
</after_change>


## Stubs

None to close; none expected to open.

## Jobs

None.

## Not yet

None.

## Completes

None.

## Remove

No deletions in the change reads (see before/after markers in changed sections).