# Packet m28-bramki-git
window: 2.1.13 -> 2.1.14 (delta)
unit: m28-bramki-git
goal: Serwis gita rozdziela commit release'u i push na wejście z bramką oraz wykonanie bez bramki. Niespełniona bramka wejścia daje brak wyniku zamiast „pominięto”. Commit pull'a przy niespełnionej bramce zwraca „pominięto”. Tryby celu `named` i `new` commitują także przy odłączonym HEAD, a w świeżym repo kończą się błędem celu z odpowiednim rodzajem naprawy. Komunikat commita release'u to nazwa, pusta linia i opis. Usunięte są: dawna nazwa metody commitu release'u, prefiks `Release ` w komunikacie i publiczna metoda wyznaczania gałęzi domyślnej, która staje się prywatna.
layers touched: Domain (M28 git service), L4 (API: git-status-response)
entities: dto 1 (git-status-response); linked endpoints 2 (context)
criteria: 19 ac (all active)
jobs: none
packet size (bytes, body): 127003

## Change (2.1.13 -> 2.1.14) — pages/modules/m28-git-sync.md, change offset 0 limit 6

### section dj6r1sam
{
 "kind": "section",
 "anchor": "dj6r1sam",
 "headingPath": [
  "M28 — Git Sync"
 ],
 "heading": "Zasada graniczna",
 "content": "\n**Dwa stany trybu — `config.git.enabled` (default `false`) samo w sobie oznacza commit-on-release.** Cała warstwa git w M28 jest bramkowana na `config.git.enabled === true`. Osobny sub-toggle `syncCommitOnRelease` **nie istnieje** (usunięty — nie ma stanu „git włączony, ale nie commituję na release\"), co kolapsuje matrycę do dwóch stanów:\n\n| stan | `git.enabled` | model commit / reign |\n|---|---|---|\n| (a) | OFF | pełny SQLite (dzisiejsze zachowanie, niezmienione) — cała ścieżka git = **no-op** |\n| (c) | ON | pełny reign — **commit-on-release ZAWSZE**, pull = commit (`commitPull`), markery w historii (M17 <section_ref anchor=\"m17reldiff\"/>) |\n\n<before_change>Gdy `enabled === false` (domyślnie dla wszystkich projektów, także istniejących — decyzja B1, regresja wsteczna): zachowanie identyczne z SQLite-only + pliki na dysku. `detect()` może dalej działać (zasila wskaźnik statusu git `GitStatusBadge` w nagłówku sidebara — L5), ale mutujące operacje wracają `{ status: 'skipped' }`. **`syncPushOnPush` pozostaje** drugą, niezależną osią obok `enabled` (push NIE kolapsuje do mastera): push-na-remote (M25, serwer inharness) to inna akcja niż commit-on-release, a auto-`git push` upstream ma osobny failure surface (brak upstream, non-fast-forward) — zostaje osobnym opt-inem.</before_change>\n<after_change>Gdy `enabled === false` (domyślnie dla wszystkich projektów, także istniejących — decyzja B1, regresja wsteczna): zachowanie identyczne z SQLite-only + pliki na dysku. `detect()` może dalej działać (zasila wskaźnik statusu git `GitStatusBadge` w nagłówku sidebara — L5), ale mutujące operacje się nie wykonują: wejścia release'u (`commitOnRelease`, `pushOnPush`) zwracają `null`, pozostałe (`commitPull`, `checkout`, `fetch`, `sync`) — `{ status: 'skipped' }`. **`syncPushOnPush` pozostaje** drugą, niezależną osią obok `enabled` (push NIE kolapsuje do mastera): push-na-remote (M25, serwer inharness) to inna akcja niż commit-on-release, a auto-`git push` upstream ma osobny failure surface (brak upstream, non-fast-forward) — zostaje osobnym opt-inem.</after_change>\n\n- **Best-effort, nieblokujący.** Błąd git (brak repo, brak upstream, konflikt) NIE wywraca release'u/pulla (M17) ani pusha na remote (M25) — akcja kończy się sukcesem, a wynik git wraca jako pole `gitSync` w response odpowiedniej akcji; przy `status: 'error'` UI otwiera `GitErrorRecoveryModal` (<section_ref anchor=\"8i5qf0xx\"/>) — post-hoc afordancję naprawy, nie sygnał porażki akcji. Źródłem prawdy jest **commitowany tekst** — pliki wszystkich korzeni rejestru (strony, pliki encji z `tags.json`, metadane wydań, plany, briefy i patche) plus `config.json`; gitignored `db.sqlite*` to pochodny indeks (M29) — git wersjonuje tekst, nie bazę.\n- **Zakres commitowania idzie za rejestrem korzeni.** Ścieżka git obejmuje katalogi **wszystkich korzeni rejestru** (L13 <section_ref anchor=\"m28l13rt\"/>), nie sam katalog stron.\n- **M28 nie jest pluginem M13.** Moduł feature (non-entity) — brak slotów `EntityModule`, brak rejestracji w plugin hoście, brak whitelisty w `config.entities`. Eksponuje własny prefix REST `/api/git/*` (wyjątek od konwencji L4 `/api/{type}s/*`, analogicznie do M24 `/api/remote-account/*` i M25 `/api/release-pushes/*`).\n- **Agent a git.** Brak dedykowanego git MCP toolu (**zostaje**, symetrycznie do M25) — git to side-effect akcji człowieka / release'u, nie narzędzie agenta. Agent dotyka gita **WYŁĄCZNIE** w człowiekowo-zainicjowanym recovery (klik „Fix it with Agent\" w `GitErrorRecoveryModal`), przez built-in **Bash**, scoped do bezpiecznych operacji (stash/commit) — bez force/destructive (spójnie z Git Safety). Patrz <section_ref anchor=\"8i5qf0xx\"/>. Zależność od czatu jest przy tym w całości **kliencka** — warstwa wykonawcza gita o rozmowie nie wie."
}

### section eu1rffp6
{
 "kind": "section",
 "anchor": "eu1rffp6",
 "headingPath": [
  "M28 — Git Sync"
 ],
 "heading": "Domain",
 "content": "\n`gitService` — cienka warstwa nad CLI `git` (spawn przez `child_process`). Stabilny kontrakt dla M17 / M25 i karty Git tego modułu:\n\n```typescript\ninterface GitService {\n  // Wykrycie repo obejmującego korzenie rodzaju pages. `git rev-parse --show-toplevel`\n  // z cwd. Brak repo / brak `git` w PATH / żaden korzeń rodzaju pages w worktree → null.\n  // Gdy repo: zbiera remoteUrl, branch, isDirty, rootPath (korzenie poza repo pomijane, log).\n  detect(): GitRepoInfo | null;\n\n<before_change>  // Best-effort commit przy release (M17). Gate: config.git.enabled (enabled samo w sobie = commit-on-release) + detect().</before_change>\n<after_change>  // Best-effort commit przy release (M17) — wejście z bramką, wołane przez createRelease.\n  // Gate: config.git.enabled (enabled samo w sobie = commit-on-release) + detect() !== null,\n  //       w trybie 'current' dodatkowo detect().branch !== null. Gate niespełniony → null (NIE 'skipped').\n  // Tryby 'named'/'new' nie czytają HEAD — przy detached HEAD przechodzą do commit().\n  // Spełniony gate → commit(). Nigdy nie rzuca. Patrz sekcja commitOnRelease.\n  commitOnRelease(release: Release): GitCommitResult | null;\n\n  // Commit release'u BEZ bramki konfiguracji (wołany przez commitOnRelease; bezpośrednio np. w testach).</after_change>\n  // Kanonikalizuje cele (fs.realpath, per root) i staguje tylko ścieżki wewnątrz roota worktree;\n  // git add <real(dir)> każdego korzenia rejestru (L13) + <real(config.json)>;\n  // pliki korzeni rodzajów bez flagi release jadą w commicie poza wymiarem release_diff;\n<before_change>  // commit msg \"Release {name}\\n\\n{description}\". Nigdy nie rzuca.</before_change>\n<after_change>  // commit msg \"{name}\\n\\n{description}\" — bez prefiksu, liczony raz, wspólny dla wszystkich trybów\n  // (sam \"{name}\" przy pustym opisie — gałąź defensywna, createRelease odmawia pustego opisu). Nigdy nie rzuca.</after_change>\n  // Stagowanie korzenia releases sprawia, że plik metadanych release'u wpada do commita — commit ten jest\n  // STAŁYM markerem reign wyliczanym później przez resolveReleaseCommit().\n  // Cel commita zależy od config.git.commitTarget.mode:\n<before_change>  //   'current' → real-index git add+commit na bieżącym HEAD (dzisiejsze zachowanie);</before_change>\n<after_change>  //   'current' → real-index git add+commit na bieżącym HEAD;</after_change>\n  //   'named'   → temp-index commit na tip istniejącego brancha config.git.commitTarget.branch;\n<before_change>  //   'new'     → nowy branch (od tipa base = commitTarget.base || resolveDefaultBranch()) mechanizmem</before_change>\n<after_change>  //   'new'     → nowy branch (od tipa base = commitTarget.base || prywatne resolveDefaultBranch()) mechanizmem</after_change>\n  //               commit-tree + update-ref, nazwa z commitTarget.template (kolizja → suffix -2/-3/...).\n<after_change>  //   'named' bez branch / 'new' bez template → fallback do ścieżki 'current'.</after_change>\n  // Gdy config.git.switchAfterRelease && mode !== 'current' → po commicie wewnętrzny wariant checkout\n<before_change>  // (bez guardów dirty/busy) na docelowy branch. Patrz sekcja commitForRelease.\n  commitForRelease(release: Release): GitCommitResult;</before_change>\n<after_change>  // (bez guardów dirty/busy) na docelowy branch. Patrz sekcja commitOnRelease.\n  commit(opts: { name: string; description: string /* pozostałe pola — patrz todo pod blokiem */ }): GitCommitResult;</after_change>\n\n<before_change>  // Best-effort commit przy pullu (M17 updateRelease({ assignUnreleased })). Gate: config.git.enabled + detect() + branch !== null.\n  // Ten sam scope stagowania co commitForRelease MINUS nowy plik markera (pull nie dodaje pliku <slug>.json korzenia releases —</before_change>\n<after_change>  // Best-effort commit przy pullu (M17 updateRelease({ assignUnreleased })). Gate: config.git.enabled + detect() + branch !== null;\n  // gate niespełniony → 'skipped' (NIGDY null — inaczej niż commitOnRelease).\n  // Ten sam scope stagowania co commit() MINUS nowy plik markera (pull nie dodaje pliku <slug>.json korzenia releases —</after_change>\n  // stagowanie korzenia releases nieszkodliwe: brak nowego pliku ⇒ --diff-filter=A go nie wyłapie).\n  // Commit msg \"Pull to {latest.name}\". Nigdy nie rzuca.\n  commitPull(latest: Release): GitCommitResult;\n\n<before_change>  // Best-effort push przy push release na remote (M25). Gate: config.git.enabled (master) + config.git.syncPushOnPush + detect().\n  // Pushuje branch DOCELOWY release'u (nie ślepo bieżący HEAD): rozwiązanie brancha przez\n  // `git branch --contains resolveReleaseCommit(release)`; fallback bieżący HEAD, gdy commit nieodnaleziony\n  // (commit-on-release był OFF). git push <branch> → upstream. Nigdy nie rzuca.</before_change>\n<after_change>  // Best-effort push przy push release na remote (M25) — wejście z bramką, wołane przez releasePushService.\n  // Gate: config.git.enabled (master) + config.git.syncPushOnPush + detect() !== null + detect().branch !== null\n  //       — nazwany HEAD wymagany także przy jawnym branch. Gate niespełniony → null (NIE 'skipped').\n  // Spełniony gate → push(branch). Nigdy nie rzuca.\n  pushOnPush(branch?: string): GitPushResult | null;\n\n  // git push BEZ bramki konfiguracji. Pushuje branch DOCELOWY release'u (nie ślepo bieżący HEAD) — branch\n  // rozwiązuje wołający (M25) przez `git branch --contains resolveReleaseCommit(release)`; fallback bieżący HEAD,\n  // gdy commit nieodnaleziony. Bez jawnego branch przy detached HEAD → 'skipped'. git push <branch> → upstream. Nigdy nie rzuca.</after_change>\n  push(branch?: string): GitPushResult;\n\n<before_change>  // Auto-detekcja domyślnego brancha bazowego dla trybu commitTarget 'new' (base === null).\n  // `git symbolic-ref --short refs/remotes/origin/HEAD` → fallback lokalny 'main' → 'master' → bieżący branch.\n  // Read-only, nigdy nie rzuca; null gdy nic nie da się ustalić (świeże repo, unborn HEAD).\n  resolveDefaultBranch(): string | null;</before_change>\n<after_change>  // resolveDefaultBranch() — metoda PRYWATNA, poza tym interfejsem; patrz sekcja resolveDefaultBranch.</after_change>\n\n  // --- Warstwa git jako augmentacja (Faza 2, wszystkie gated na config.git.enabled) ---\n\n  // Marker release'u z historii pliku metadanych: commit wprowadzający plik <slug>.json korzenia releases.\n  // git log --all --diff-filter=A -1 --format=%H -- <path>. `--all` przeszukuje WSZYSTKIE refy (nie tylko\n  // bieżący HEAD) — plik release'u niemutowalny ⇒ istnieje w dokładnie jednym commicie ⇒ marker znajduje się\n  // jednoznacznie niezależnie od brancha (warunek poprawności przy commicie poza HEAD: switch=off / branch-sibling).\n  // Release niemutowalny ⇒ jednoznaczny, STAŁY marker (model reign: M17 interpretuje go jako granicę —\n  // snapshot(vN) = M_{next}~1 / HEAD). Brak w historii żadnego refa (release sprzed włączenia gita, lokalny\n  // niezacommitowany marker) → null. Bez tagów, bez zapisanego gitSha.\n  resolveReleaseCommit(path: string): string | null;\n\n  // Diff dwóch refów (SHA) ograniczony do pathspeców. Źródło release_diff w trybie git ON — wołany na\n  // snapshotach reign (granica następnika / HEAD), nie na samych markerach (M17 release_diff).\n  // git diff <a>..<b> -- <pathspecs>. Nigdy nie rzuca (błąd → null / pusty).\n  diffRefs(shaA: string, shaB: string, pathspecs: string[]): GitRefDiff | null;\n\n  // Status HEAD do wskaźnika sidebara (GitStatusBadge, L5): dirty/clean + opcjonalnie ahead/behind vs upstream.\n  // Read-only, nigdy nie rzuca. null gdy brak repo / master off.\n  statusAheadBehind(): GitStatus | null;\n\n  // --- Warstwa switch brancha (prymityw „switch + reload\", gated na config.git.enabled) ---\n\n  // Read-only lista lokalnych branchy do dropdownu GitStatusBadge (L5) i selektora celu commitu na karcie #git.\n  // `git branch --format=%(refname:short)` + current z `git rev-parse --abbrev-ref HEAD`.\n  // null TYLKO gdy brak repo / master off (nic do listowania). detached HEAD → NIE null,\n  // lecz { current: null, branches: [...] } (lista istnieje, brak bieżącego). Nigdy nie rzuca.\n  listBranches(): { current: string | null; branches: string[] } | null;\n\n  // Przełącza HEAD/working tree na ISTNIEJĄCY branch (`git checkout <branch>`). Guard/never-throw.\n  // Kolejność guardów: gate (enabled + detect() !== null) → busy (aktywna tura mutująca dysk)\n  // → dirty-blocked (zmodyfikowane/staged pliki ŚLEDZONE; untracked NIE blokuje) → not-found\n  // (branch nie istnieje lokalnie) → git checkout → switched. NIE tworzy nowych branchy, NIE robi tagów.\n  checkout(branch: string): GitCheckoutResult;\n}\n\ntype GitRepoInfo = {\n  rootPath: string;\n  remoteUrl: string | null;   // brak origin → null\n  branch: string | null;      // detached HEAD LUB unborn branch (świeże repo, 0 commitów) → null\n  isDirty: boolean;\n};\n\ntype GitCommitResult =\n  | { status: 'committed'; sha: string; branch: string; switched: boolean }  // branch = docelowy branch commita; switched = czy HEAD przełączony (switchAfterRelease)\n  | { status: 'nothing-to-commit' }\n<before_change>  | { status: 'skipped' }                  // gate off, brak repo, lub branch === null (detached/unborn HEAD)</before_change>\n<after_change>  | { status: 'skipped'; message?: string }  // commitPull: gate off / brak repo / detached-unborn HEAD;\n                                             // commit(): ścieżka real-index przy detached HEAD (message 'detached HEAD')\n                                             // albo katalogi stron poza repo (real-index i temp-index)</after_change>\n  | { status: 'error'; message: string; recovery: GitErrorRecovery };  // porażki nowych ścieżek (branch-missing/base-missing/switch-*) też tu, z recovery.kind\n\ntype GitPushResult =\n  | { status: 'pushed' }\n  | { status: 'nothing-to-push' }\n<before_change>  | { status: 'skipped' }                  // gate off, brak repo, lub branch === null (detached/unborn HEAD)</before_change>\n<after_change>  | { status: 'skipped' }                  // push(): detached HEAD bez jawnego branch — przez pushOnPush nieosiągalny</after_change>\n  | { status: 'error'; message: string; recovery: GitErrorRecovery };\n\n// Additive payload wariantu 'error' — kontekst dla GitErrorRecoveryModal (L5) i handoffu „Fix it with Agent\".\n// Komponowany przez backend M28 (jedyny właściciel wiedzy o operacjach git); propagowany w polu gitSync\n// response createRelease / updateRelease (M17) i release-push (M25). Starzy konsumenci ignorują pole.\ntype GitErrorRecovery = {\n  operation: 'commit-on-release' | 'pull' | 'push';   // co backend chciał wykonać (bez zmian — 'commit-on-release' także dla porażek named/new)\n  kind?:                                                // OPCJONALNY, additive — dodatkowa klasyfikacja porażki commit-target/switch\n    | 'branch-missing'                                 //   tryb 'named': docelowy branch zniknął między konfiguracją a release'em\n    | 'base-missing'                                   //   tryb 'new': explicit base zniknął\n    | 'switch-failed'                                  //   switchAfterRelease: checkout na docelowy branch nie przeszedł\n    | 'switch-dirty'                                   //   switchAfterRelease: konflikt working tree (nie-specowe brudne pliki)\n    | 'non-fast-forward';                              //   push: remote ma commity, których lokalnie brak — okno proponuje Sync\n  reason: string;                                      // ludzkie „dlaczego\" (np. \"merge conflict in pages/foo.md\")\n  gitStderr: string;                                   // surowe stderr gita (diagnostyka)\n  intentPrompt: string;                                // gotowy do wysłania prompt dla agenta-recovery (kind-aware, patrz UI L5)\n};\n\n// Read-only status HEAD do wskaźnika sidebara (slice L5, GitStatusBadge).\ntype GitStatus = {\n  branch: string | null;\n  isDirty: boolean;\n  ahead: number | null;                    // null gdy brak upstream\n  behind: number | null;                   // null gdy brak upstream\n};\n\n// Wynik checkout(branch) — switch istniejącego brancha inicjowany z aplikacji (sidebar / release switch).\ntype GitCheckoutResult =\n  | { status: 'switched'; branch: string }\n  | { status: 'dirty-blocked' }            // zmodyfikowane/staged pliki ŚLEDZONE (D1/D1b); untracked NIE blokuje\n  | { status: 'not-found' }                // branch nie istnieje lokalnie\n  | { status: 'skipped' }                  // gate off / brak repo\n  | { status: 'busy' }                     // aktywna tura mutująca dysk tego projektu (D4.3)\n  | { status: 'error'; message: string };\n\n// Wynik diffRefs — źródło release_diff w trybie git ON (M17).\ntype GitRefDiff = {\n  files: Array<{ path: string; status: 'A' | 'M' | 'D' | 'R'; }>;\n  // szczegółowy patch/line-diff derywowany leniwie przez konsumenta (M17 release_diff projekcja)\n};\n```\n<after_change>**Wejście z bramką a wykonanie.** Commit release'u i push mają po dwie metody: wejście z bramką (`commitOnRelease`, `pushOnPush`), które czyta przełączniki konfiguracji, oraz wykonanie (`commit`, `push`), które ich nie czyta. Tylko wejście zwraca `null` — przy niespełnionej bramce — i ten `null` trafia dosłownie do pola `gitSync` odpowiedzi jako „operacja git się nie uruchomiła”. `{ status: 'skipped' }` pochodzi z wykonania albo z `commitPull`, który bramki w osobnym wejściu nie ma.\n**Publiczne metody poza tym kontraktem.** `GitService` eksponuje w kodzie także `branchContainingCommit`, `diffRefToWorkingTree`, `isAncestorOfHead` i `showFile`. <todo comment=\"dopisać sygnatury i semantykę branchContainingCommit, diffRefToWorkingTree, isAncestorOfHead, showFile oraz pełny kształt opts metody commit() — znane są dziś tylko z kodu (src/server/services/git.ts)\"/></after_change>"
}

### section aqys9dje
{
 "kind": "section",
 "anchor": "aqys9dje",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`commitOnRelease(release)`",
 "content": "<before_change>### `commitForRelease(release)`</before_change>\n<after_change>### `commitOnRelease(release)`</after_change>\n\n<before_change>Gate: `config.git.enabled === true` **oraz** `detect() !== null` **oraz** `detect().branch !== null` — bez sub-toggle (`enabled` samo w sobie oznacza commit-on-release). Jeśli gate nie spełniony → `{ status: 'skipped' }` (m.in. master off, detached HEAD lub unborn branch — świeże repo bez commitów; w tym ostatnim przypadku pierwszy commit musi powstać poza git sync zanim moduł zacznie działać).</before_change>\n<after_change>Gate: `config.git.enabled === true` **oraz** `detect() !== null`, a w trybie `current` dodatkowo `detect().branch !== null` — bez sub-toggle (`enabled` samo w sobie oznacza commit-on-release). Gate niespełniony → **`null`**, nie wariant `GitCommitResult`: master off, brak repo albo detached/unborn HEAD w trybie `current` (w świeżym repo bez commitów pierwszy commit musi powstać poza git sync, zanim moduł zacznie działać). `createRelease` przekazuje ten `null` dosłownie jako `gitSync: null`. Spełniony gate → `commit()`, wykonanie bez czytania przełączników.</after_change>\n\n<after_change>Tryby `named` i `new` **nie wymagają nazwanego HEAD** — nie czytają go wcale, więc przy detached HEAD commit się wykonuje. W świeżym repo bez commitów oba kończą się błędem celu, nie `null`: `named` → `recovery.kind: 'branch-missing'` (gałęzi nie ma), `new` → `recovery.kind: 'base-missing'` (bazy nie da się ustalić).\n`{ status: 'skipped' }` nadal może wrócić z tej operacji — z wykonania, nie z bramki: ścieżka real-index przy detached HEAD (osiągalna wyłącznie przez fallback konfiguracji niżej) oraz katalogi stron leżące poza repo (w ścieżce real-index i temp-index).</after_change>\n**Resolucja celu commita z `config.git.commitTarget` (dwie oddzielne osie: DOKĄD commit trafia + CZY HEAD się przełącza).** Zachowanie stagowania (scope, kanonikalizacja) jest wspólne dla wszystkich trybów; różni je **gdzie** ląduje ref commita:\n\n- **`mode: 'current'`** (default, backward-compat) — jak dziś: real-index `git add` skanonikalizowanych ścieżek spec + `git commit` na **bieżącym HEAD**. Working tree/indeks jak dotąd. `switched` zawsze `false`, `branch` = bieżący branch.\n- **`mode: 'named'`** — commit na tip **istniejącego** brancha `commitTarget.branch` (wybieranego na karcie ustawień `#git` z `listBranches()`). Branch nie istnieje w momencie release'u (zniknął po konfiguracji) → **NIE tworzymy go**: `{ status: 'error', message, recovery }` z `recovery.kind: 'branch-missing'`. Istnieje → commit mechanizmem **temp-index** na jego tip (niżej).\n- **`mode: 'new'`** — nowy branch release'u. Tip bazy = `commitTarget.base` (jeśli podany) lub `resolveDefaultBranch()` (gdy `base === null`). **Explicit `base` zniknął** → `{ status: 'error', …, recovery.kind: 'base-missing' }`. Nazwa = `template` po renderze placeholderów (`{release_slug}`, `{release_name}` sanityzowany do ref-safe, `{date}` = `YYYY-MM-DD` utworzenia release'u); **kolizja z istniejącym branchem** → numeryczny suffix (`-2`, `-3`, …) aż do wolnej nazwy (gwarancja świeżego brancha). Nowy branch **zawsze wyrasta z tipa base, NIGDY z HEAD** (anti branch-of-branch — decyzja kotwicy base): każdy release-branch to rodzeństwo off base, stackowanie strukturalnie niemożliwe, również przy `switchAfterRelease=on` i przy HEAD stojącym na wcześniejszym release-branchu.\n<after_change>- **Fallback konfiguracji** — `named` bez `commitTarget.branch` albo `new` bez `commitTarget.template` → commit idzie ścieżką trybu `current` (real-index na bieżącym HEAD). Bramka sprawdzała nazwany HEAD tylko dla `current`, więc przy detached HEAD ta ścieżka zwraca `{ status: 'skipped', message: 'detached HEAD' }`.</after_change>\n\n<before_change>**Mechanika temp-index (`named`/`new`) — nie-destrukcyjna, bez dotykania working tree/HEAD/realnego indeksu.** Tymczasowy indeks przez `GIT_INDEX_FILE` (osobny plik), zasiany tipem celu: `git read-tree <tip>` (tip = tip named-brancha lub tip base). Stage **tylko** skanonikalizowanych ścieżek spec (reuse tej samej realpath-logiki co `current` — zestaw stagowania: `dir` każdego korzenia rejestru + `config.json`), `git write-tree` → nowe `tree`. Gdy `tree` == tree tipa (nic nowego) → `{ status: 'nothing-to-commit' }`. Inaczej `git commit-tree <tree> -p <tip> -m \"Release {name}\\n\\n{description}\"` → nowy commit-sha, następnie `git update-ref refs/heads/<target> <sha>` (dla `new`: `<target>` = świeża nazwa; dla `named`: fast-forward tipa brancha). **Working tree, HEAD i realny indeks pozostają nietknięte** aż do opcjonalnego switchu — to jedyny mechanizm poprawny także przy branchu **zdywergowanym** od HEAD (nakłada wyłącznie delty spec na tree celu, nie miesza obcych zmian). Temp-index sprzątany w `finally`.</before_change>\n<after_change>**Mechanika temp-index (`named`/`new`) — nie-destrukcyjna, bez dotykania working tree/HEAD/realnego indeksu.** Tymczasowy indeks przez `GIT_INDEX_FILE` (osobny plik), zasiany tipem celu: `git read-tree <tip>` (tip = tip named-brancha lub tip base). Stage **tylko** skanonikalizowanych ścieżek spec (reuse tej samej realpath-logiki co `current` — zestaw stagowania: `dir` każdego korzenia rejestru + `config.json`), `git write-tree` → nowe `tree`. Gdy `tree` == tree tipa (nic nowego) → `{ status: 'nothing-to-commit' }`. Inaczej `git commit-tree <tree> -p <tip> -m \"{name}\\n\\n{description}\"` → nowy commit-sha, następnie `git update-ref refs/heads/<target> <sha>` (dla `new`: `<target>` = świeża nazwa; dla `named`: fast-forward tipa brancha). **Working tree, HEAD i realny indeks pozostają nietknięte** aż do opcjonalnego switchu — to jedyny mechanizm poprawny także przy branchu **zdywergowanym** od HEAD (nakłada wyłącznie delty spec na tree celu, nie miesza obcych zmian). Temp-index sprzątany w `finally`.</after_change>\n\n**Opcjonalny switch po commicie (`switchAfterRelease && mode !== 'current'`).** Po udanym `update-ref` wołany jest **wewnętrzny wariant `checkout(target)` z pominięciem pre-guardów `dirty-blocked` i `busy`** (patrz <section_ref anchor=\"1svflc6b\"/> — switch odpala się wewnątrz tury release'u, a po temp-index commicie working tree jest z definicji „brudny\" względem bieżącego HEAD). Sukces → `switched: true`. Porażka switchu → **commit pozostaje durable** (release zapisany, branch ma commit), zwracany `{ status: 'error', …, recovery.kind: 'switch-failed' }` (lub `'switch-dirty'` przy konflikcie nie-specowych brudnych plików). `switchAfterRelease=off` → HEAD zostaje, commit żyje na docelowym branchu przez `update-ref`, pliki release'u zostają na dysku working tree jako źródło prawdy (SQLite cache spójny — nota dysk↔SQLite w M17).\n\n**Kanonikalizacja ścieżek przed `git add` (obowiązkowa, per korzeń).** `git add` dopasowuje pathspeci **leksykalnie** do roota worktree, więc niezresolvowana ścieżka osiągana przez symlink (np. `dir` korzenia będący symlinkiem do innego repo) zostaje odrzucona przez git z `fatal: '…' is outside repository`, mimo że `detect()` poprawnie wykrył repo (git kanonikalizuje *wewnątrz* symlinka). Dlatego przed `git add` każdy cel stagowania (`dir` **każdego korzenia rejestru** — osobna kanonikalizacja per korzeń — oraz `config.json`) jest kanonikalizowany przez `fs.realpath`, a stagowane są **tylko** te zresolvowane ścieżki, które leżą wewnątrz wykrytego `rootPath` worktree. Ścieżki nie-symlinkowe resolvują się do siebie (poprawka regresyjnie bezpieczna), więc zwykły setup działa bez zmian, a symlinkowany worktree jest obsługiwany przezroczyście. Cel, który po `realpath` leży **poza** wykrytym repo (np. korzeń użytkownika w innym worktree, albo `config.json` żyjący w cwd c4s, ale nieobecny w docelowym repo), jest **pomijany** — nie przerywa całego commitu.\n\n**Scope stagowania = commitowany tekst = rejestr korzeni.** Zestaw stagowania to `real(dir)` każdego korzenia rejestru (L13, sekcja <section_ref anchor=\"m28l13rt\"/>) plus `config.json`: strony markdown wszystkich korzeni rodzaju `pages`, pliki korzenia `entities` (`<type>/<slug>.json` i `tags.json`), pliki metadanych wydań korzenia `releases` (`<slug>.json`, M17 <section_ref anchor=\"m17reldisk\"/>) oraz pliki korzeni `plans`, `briefs` i `patches`, które lądują w historii git (współdzielenie w zespole). Udział w wydaniu jest osobną osią — rozstrzyga go flaga `release` rodzaju (M17) — więc pliki korzeni rodzajów bez tej flagi jadą w commicie release'u poza wymiarem `release_diff`: to ride-along w commicie, nie treść release'u. Pochodny indeks `db.sqlite*` (M29) **nie** jest stagowany — jest gitignored (M01) i odbudowywany z tekstu przy boot.\n\n> **Blok zarządzany w `.gitignore` przelicza się poza tą operacją** — jego zawartość, cztery reguły przeliczenia i raportowanie created-vs-found niesie <section_ref anchor=\"2qwi21mw\"/>.\n\n<before_change>**Przebieg w trybie `current`.** Przy spełnionym gate: `git add <real(dir)>` dla każdego korzenia rejestru + `<real(config.json)>` (z pominięciem celów spoza roota worktree); jeśli nic do zacommitowania → `{ status: 'nothing-to-commit' }` (sukces, nie błąd). Commit message: `Release {name}` + pusta linia + `{description}`. Zwraca `{ status: 'committed', sha, branch, switched }` przy sukcesie (`branch` = docelowy branch commita, `switched` = czy HEAD przełączony przez `switchAfterRelease`) lub `{ status: 'error', message, recovery }` przy niepowodzeniu (porażki nowych ścieżek `named`/`new`/switch niosą `recovery.kind`). **Nigdy nie rzuca** — wszystkie błędy mapowane na `status: 'error'`. Powyższe dotyczy trybu `current`; `named`/`new` używają temp-index (patrz wyżej), ale kontrakt zwrotu jest ten sam.</before_change>\n<after_change>**Przebieg w trybie `current`.** Przy spełnionym gate: `git add <real(dir)>` dla każdego korzenia rejestru + `<real(config.json)>` (z pominięciem celów spoza roota worktree); jeśli nic do zacommitowania → `{ status: 'nothing-to-commit' }` (sukces, nie błąd). Commit message — jeden dla wszystkich trzech trybów, liczony raz w `commit()`: `{name}` + pusta linia + `{description}`, **bez prefiksu `Release `**; przy pustym opisie sam `{name}` (gałąź defensywna — `createRelease` odmawia pustego opisu, więc trafia tu tylko bezpośrednie wywołanie `commit()`). Zwraca `{ status: 'committed', sha, branch, switched }` przy sukcesie (`branch` = docelowy branch commita, `switched` = czy HEAD przełączony przez `switchAfterRelease`) lub `{ status: 'error', message, recovery }` przy niepowodzeniu (porażki nowych ścieżek `named`/`new`/switch niosą `recovery.kind`). **Nigdy nie rzuca** — wszystkie błędy mapowane na `status: 'error'`; `null` wyłącznie z bramki (wyżej). Powyższe dotyczy trybu `current`; `named`/`new` używają temp-index (patrz wyżej), ale kontrakt zwrotu jest ten sam.</after_change>\n\n**Marker release'u = commit wprowadzający plik metadanych (STAŁY).** Stagowanie korzenia `releases` włącza plik `<slug>.json` tego korzenia do commita release'u. Ponieważ release jest niemutowalny (M17), plik pojawia się w dokładnie jednym commicie — `resolveReleaseCommit(<ścieżka pliku <slug>.json korzenia releases>)` (`git log --diff-filter=A -1 --format=%H`) wylicza ten marker leniwie z historii pliku. **Bez tagów, bez zapisanego `gitSha`, bez re-touch** — tożsamość release'u w gicie wynika wyłącznie z historii jego pliku. Marker wyznacza granice **reign** release'u dla `release_diff` w trybie git ON (M17 <section_ref anchor=\"m17reldiff\"/>).\n\n<before_change>**Rezydualny edge B3 (po usunięciu sub-toggle znacznie zawężony).** Główny scenariusz „marker wchłonięty obcym commitem\" zniknął — commit-on-release jest zawsze aktywny przy `git.enabled`, więc marker commitowany jest w tym samym akcie co release. Pozostaje wąski przypadek: `git.enabled` włączony **po** utworzeniu wcześniejszych release'ów — ich pliki markerów (na dysku, niezacommitowane) wchłonie najbliższy commit; `resolveReleaseCommit` zwróci wtedy commit-nosiciela jako przybliżony marker. Odnotowane w M17 (otwarte pytanie B3-rezydualne).</before_change>\n<after_change>**Rezydualny edge B3 (po usunięciu sub-toggle znacznie zawężony).** Główny scenariusz „marker wchłonięty obcym commitem\" zniknął — commit-on-release jest zawsze aktywny przy `git.enabled`, więc marker commitowany jest w tym samym akcie co release. Pozostaje wąski przypadek: `git.enabled` włączony **po** utworzeniu wcześniejszych release'ów — ich pliki markerów (na dysku, niezacommitowane) wchłonie najbliższy commit; `resolveReleaseCommit` zwróci wtedy commit-nosiciela jako przybliżony marker. Odnotowane jako otwarte pytanie 55 (<section_ref anchor=\"e6nqwep9\"/>).</after_change>"
}

### section yn1oesly
{
 "kind": "section",
 "anchor": "yn1oesly",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`commitPull(latest)`",
 "content": "\n<before_change>**Drugi wołający ścieżki commit — pull w trybie git** (M17 `updateRelease({ assignUnreleased: true })`, <section_ref anchor=\"mbjdcls0\"/>): w gicie „pull do najnowszego\" realizuje się przez commit working tree do reign najnowszego release'u. Osobna operacja od `commitForRelease`, bo różni się intencją i komunikatem, a **nie dodaje nowego pliku markera**:</before_change>\n<after_change>**Drugi wołający ścieżki commit — pull w trybie git** (M17 `updateRelease({ assignUnreleased: true })`, <section_ref anchor=\"mbjdcls0\"/>): w gicie „pull do najnowszego\" realizuje się przez commit working tree do reign najnowszego release'u. Osobna operacja od `commitOnRelease`, bo różni się intencją i komunikatem, a **nie dodaje nowego pliku markera**:</after_change>\n\n<before_change>- Gate: identyczny jak `commitForRelease` (`config.git.enabled` + `detect() !== null` + `detect().branch !== null`); nie spełniony → `{ status: 'skipped' }`.\n- Scope stagowania: **ten sam co `commitForRelease`** (`real(dir)` każdego korzenia rejestru + `config.json`, z kanonikalizacją per korzeń) **minus nowy plik markera** — pull nie tworzy pliku metadanych wydania, więc stagowanie korzenia `releases` jest nieszkodliwe (brak nowego pliku ⇒ `--diff-filter=A` nie wyłapie tego commita jako markera żadnego release'u).</before_change>\n<after_change>- Gate: `config.git.enabled` + `detect() !== null` + `detect().branch !== null` — nazwany HEAD wymagany niezależnie od `commitTarget`, bo pull zawsze commituje na bieżący HEAD. Nie spełniony → `{ status: 'skipped' }`, **nigdy `null`** — inaczej niż `commitOnRelease`; `updateRelease` przekazuje ten wynik do `gitSync` bez zmian.\n- Scope stagowania: **ten sam co `commit()`** (`real(dir)` każdego korzenia rejestru + `config.json`, z kanonikalizacją per korzeń) **minus nowy plik markera** — pull nie tworzy pliku metadanych wydania, więc stagowanie korzenia `releases` jest nieszkodliwe (brak nowego pliku ⇒ `--diff-filter=A` nie wyłapie tego commita jako markera żadnego release'u).</after_change>\n- Commit message: `Pull to {latest.name}` (gdzie `latest` = najnowszy release, do którego reign wchłaniany jest working tree).\n- Czysty working tree → `{ status: 'nothing-to-commit' }` (sukces). **Nigdy nie rzuca** — błędy mapowane na `{ status: 'error', message, recovery }`.\n\nCommit-pull ląduje w historii **między markerami**, więc model reign (M17 <section_ref anchor=\"m17reldiff\"/>) automatycznie zalicza go do reign najnowszego release'u — dokładnie tak samo, jak ręczny `git commit` z terminala (implicit pull).\n\n<before_change>**`commitPull` NIE podlega `commitTarget`.** Pull zawsze commituje working tree na **bieżący HEAD** (semantyka „utrwal working tree przed pullem/wchłonięciem do najnowszego reign\") — `commitTarget.mode`/`branch`/`template`/`base` oraz `switchAfterRelease` dotyczą wyłącznie `commitForRelease`. Commit-pull to real-index commit na HEAD niezależnie od trybu commit-target.</before_change>\n<after_change>**`commitPull` NIE podlega `commitTarget`.** Pull zawsze commituje working tree na **bieżący HEAD** (semantyka „utrwal working tree przed pullem/wchłonięciem do najnowszego reign\") — `commitTarget.mode`/`branch`/`template`/`base` oraz `switchAfterRelease` dotyczą wyłącznie `commitOnRelease`. Commit-pull to real-index commit na HEAD niezależnie od trybu commit-target.</after_change>"
}

### section sw1u84nn
{
 "kind": "section",
 "anchor": "sw1u84nn",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`pushOnPush(branch?)` i `push(branch?)`",
 "content": "<before_change>### `push()`</before_change>\n<after_change>### `pushOnPush(branch?)` i `push(branch?)`</after_change>\n\n<before_change>Gate: `config.git.enabled === true` (master) **oraz** `config.git.syncPushOnPush === true` **oraz** `detect() !== null` **oraz** `detect().branch !== null`. Jeśli gate nie spełniony → `{ status: 'skipped' }` (m.in. master off, detached HEAD lub unborn branch — bez nazwanego brancha nie ma czego pushować).</before_change>\n<after_change>Gate (`pushOnPush`): `config.git.enabled === true` (master) **oraz** `config.git.syncPushOnPush === true` **oraz** `detect() !== null` **oraz** `detect().branch !== null` — nazwany HEAD wymagany także wtedy, gdy wołający podał jawny `branch`. Gate niespełniony → **`null`**, nie wariant `GitPushResult`; M25 przekazuje go jako `gitSync: null`. Spełniony gate → `push(branch)`, wykonanie bez czytania przełączników. Sam `push()` zwraca `{ status: 'skipped' }` przy detached HEAD bez jawnego `branch` — przez `pushOnPush` ten przypadek jest nieosiągalny, bo odfiltrowuje go bramka.</after_change>\n\n**`push(branch?)` targetuje branch DOCELOWY release'u, nie ślepo bieżący HEAD.** Gdy commit-on-release wylądował na innym branchu (`commitTarget` `named`/`new`, `switchAfterRelease=off`), HEAD może wciąż stać na starym branchu — ślepy `git push` bieżącego HEAD pominąłby commit release'u. Dlatego M25 rozwiązuje **branch niosący commit release'u** przez `git branch --contains resolveReleaseCommit(release)` i przekazuje go jako `branch`; **fallback do bieżącego HEAD**, gdy commit nieodnaleziony (commit-on-release był OFF — nie ma dedykowanego brancha release'u). Gdy gate spełniony: `git push <branch>` (docelowy branch → upstream); brak upstream / błąd sieci / odrzucenie → `{ status: 'error', message, recovery }`. Odrzucenie non-fast-forward rozpoznawane jest osobno: `recovery.kind: 'non-fast-forward'`, a okno `git-sync-recover` proponuje wtedy pobranie zmian przez `sync()` zamiast agenta (<section_ref anchor=\"u5vl07ch\"/>). **Nigdy nie rzuca.**"
}

### section rslvdfbr
{
 "kind": "section",
 "anchor": "rslvdfbr",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`resolveDefaultBranch()`",
 "content": "\nAuto-detekcja domyślnego brancha bazowego dla trybu `commitTarget: 'new'`, gdy `commitTarget.base === null` (user nie wskazał bazy na karcie ustawień `#git`). Kolejność prób (pierwsza udana wygrywa):\n\n1. `git symbolic-ref --short refs/remotes/origin/HEAD` → branch domyślny remote (np. `origin/main` → `main`).\n2. Fallback lokalny: istniejący `main` → `master`.\n3. Ostateczny fallback: bieżący branch (`detect().branch`).\n\n<before_change>**Read-only, nigdy nie rzuca** — błąd każdej próby przechodzi do następnej. Zwraca `null` tylko gdy nic nie da się ustalić (świeże repo bez branchy, unborn HEAD) → wtedy `commitForRelease` w trybie `new` nie ma tipa bazy → `{ status: 'error', …, recovery.kind: 'base-missing' }`. Konsument: `commitForRelease` (tryb `new` bez explicit base) oraz karta ustawień `#git` (lista „Base branch\" pokazuje wynik oznaczony „(default)\").</before_change>\n<after_change>**Read-only, nigdy nie rzuca** — błąd każdej próby przechodzi do następnej. Zwraca `null` tylko gdy nic nie da się ustalić (świeże repo bez branchy, unborn HEAD) → wtedy `commitOnRelease` w trybie `new` nie ma tipa bazy → `{ status: 'error', …, recovery.kind: 'base-missing' }`. Metoda **prywatna** `GitService` — poza publicznym interfejsem; woła ją ścieżka commita w trybie `new` bez explicit base. <todo comment=\"ustalić, skąd lista „Base branch” na karcie #git bierze nazwę gałęzi domyślnej przy opcji (default), skoro resolveDefaultBranch jest prywatna\"/></after_change>"
}

## State at 2.1.14 — pages/modules/m28-git-sync.md, context offset 1 limit 10

### section incf3qhp
{
 "kind": "section",
 "anchor": "incf3qhp",
 "headingPath": [
  "M28 — Git Sync"
 ],
 "heading": "Cel",
 "content": "<after_change>\nZespół, którego specyfikacja leży w repozytorium, chce mieć jej historię tam, gdzie trzyma historię reszty pracy — bez pamiętania o ręcznym commicie w każdym punkcie zatwierdzenia. Ten moduł dokłada taką zdolność: przy zamknięciu wydania, przy dociągnięciu zmian jeszcze niewydanych i przy wysłaniu wydania na zewnątrz zapisuje stan tekstu do repozytorium, a gdy się to nie uda — pokazuje afordancję naprawy, nie komunikat o porażce akcji.\n\nJest opcjonalny, wyłączony domyślnie i wzbogacający pracę zespołową, a nie nią rządzący: bez włączenia cała ta ścieżka jest pustą operacją, a niepowodzenie po tej stronie nigdy nie wywraca akcji, przy której zadziałała. Źródłem prawdy jest zapisywany tekst — strony i pliki rekordów — nigdy pochodny indeks bazy.\n\nNie ma własnej persystencji, własnej strony ani narzędzia agenta — sterowanie mieszka w ustawieniach, a samo repozytorium jest logiem.\n</after_change>"
}

### section dj6r1sam
{
 "kind": "section",
 "anchor": "dj6r1sam",
 "headingPath": [
  "M28 — Git Sync"
 ],
 "heading": "Zasada graniczna",
 "content": "<after_change>\n**Dwa stany trybu — `config.git.enabled` (default `false`) samo w sobie oznacza commit-on-release.** Cała warstwa git w M28 jest bramkowana na `config.git.enabled === true`. Osobny sub-toggle `syncCommitOnRelease` **nie istnieje** (usunięty — nie ma stanu „git włączony, ale nie commituję na release\"), co kolapsuje matrycę do dwóch stanów:\n\n| stan | `git.enabled` | model commit / reign |\n|---|---|---|\n| (a) | OFF | pełny SQLite (dzisiejsze zachowanie, niezmienione) — cała ścieżka git = **no-op** |\n| (c) | ON | pełny reign — **commit-on-release ZAWSZE**, pull = commit (`commitPull`), markery w historii (M17 <section_ref anchor=\"m17reldiff\"/>) |\n\nGdy `enabled === false` (domyślnie dla wszystkich projektów, także istniejących — decyzja B1, regresja wsteczna): zachowanie identyczne z SQLite-only + pliki na dysku. `detect()` może dalej działać (zasila wskaźnik statusu git `GitStatusBadge` w nagłówku sidebara — L5), ale mutujące operacje się nie wykonują: wejścia release'u (`commitOnRelease`, `pushOnPush`) zwracają `null`, pozostałe (`commitPull`, `checkout`, `fetch`, `sync`) — `{ status: 'skipped' }`. **`syncPushOnPush` pozostaje** drugą, niezależną osią obok `enabled` (push NIE kolapsuje do mastera): push-na-remote (M25, serwer inharness) to inna akcja niż commit-on-release, a auto-`git push` upstream ma osobny failure surface (brak upstream, non-fast-forward) — zostaje osobnym opt-inem.\n\n- **Best-effort, nieblokujący.** Błąd git (brak repo, brak upstream, konflikt) NIE wywraca release'u/pulla (M17) ani pusha na remote (M25) — akcja kończy się sukcesem, a wynik git wraca jako pole `gitSync` w response odpowiedniej akcji; przy `status: 'error'` UI otwiera `GitErrorRecoveryModal` (<section_ref anchor=\"8i5qf0xx\"/>) — post-hoc afordancję naprawy, nie sygnał porażki akcji. Źródłem prawdy jest **commitowany tekst** — pliki wszystkich korzeni rejestru (strony, pliki encji z `tags.json`, metadane wydań, plany, briefy i patche) plus `config.json`; gitignored `db.sqlite*` to pochodny indeks (M29) — git wersjonuje tekst, nie bazę.\n- **Zakres commitowania idzie za rejestrem korzeni.** Ścieżka git obejmuje katalogi **wszystkich korzeni rejestru** (L13 <section_ref anchor=\"m28l13rt\"/>), nie sam katalog stron.\n- **M28 nie jest pluginem M13.** Moduł feature (non-entity) — brak slotów `EntityModule`, brak rejestracji w plugin hoście, brak whitelisty w `config.entities`. Eksponuje własny prefix REST `/api/git/*` (wyjątek od konwencji L4 `/api/{type}s/*`, analogicznie do M24 `/api/remote-account/*` i M25 `/api/release-pushes/*`).\n- **Agent a git.** Brak dedykowanego git MCP toolu (**zostaje**, symetrycznie do M25) — git to side-effect akcji człowieka / release'u, nie narzędzie agenta. Agent dotyka gita **WYŁĄCZNIE** w człowiekowo-zainicjowanym recovery (klik „Fix it with Agent\" w `GitErrorRecoveryModal`), przez built-in **Bash**, scoped do bezpiecznych operacji (stash/commit) — bez force/destructive (spójnie z Git Safety). Patrz <section_ref anchor=\"8i5qf0xx\"/>. Zależność od czatu jest przy tym w całości **kliencka** — warstwa wykonawcza gita o rozmowie nie wie.\n</after_change>"
}

### section snn15dck
{
 "kind": "section",
 "anchor": "snn15dck",
 "headingPath": [
  "M28 — Git Sync"
 ],
 "heading": "Zależności",
 "content": "<after_change>\nTen moduł opakowuje operacje systemu kontroli wersji dla katalogów tego projektu i nie ma własnej strony — zakres commitowanych katalogów, przebudowę kontekstu i wątek ratunkowy bierze z zewnątrz, a swoje ustawienia i ich kartę deklaruje sam.\n\n<tagged_list type=\"module-dependency\" tags=\"m28\"/>\n</after_change>"
}

### section eu1rffp6
{
 "kind": "section",
 "anchor": "eu1rffp6",
 "headingPath": [
  "M28 — Git Sync"
 ],
 "heading": "Domain",
 "content": "<after_change>\n`gitService` — cienka warstwa nad CLI `git` (spawn przez `child_process`). Stabilny kontrakt dla M17 / M25 i karty Git tego modułu:\n\n```typescript\ninterface GitService {\n  // Wykrycie repo obejmującego korzenie rodzaju pages. `git rev-parse --show-toplevel`\n  // z cwd. Brak repo / brak `git` w PATH / żaden korzeń rodzaju pages w worktree → null.\n  // Gdy repo: zbiera remoteUrl, branch, isDirty, rootPath (korzenie poza repo pomijane, log).\n  detect(): GitRepoInfo | null;\n\n  // Best-effort commit przy release (M17) — wejście z bramką, wołane przez createRelease.\n  // Gate: config.git.enabled (enabled samo w sobie = commit-on-release) + detect() !== null,\n  //       w trybie 'current' dodatkowo detect().branch !== null. Gate niespełniony → null (NIE 'skipped').\n  // Tryby 'named'/'new' nie czytają HEAD — przy detached HEAD przechodzą do commit().\n  // Spełniony gate → commit(). Nigdy nie rzuca. Patrz sekcja commitOnRelease.\n  commitOnRelease(release: Release): GitCommitResult | null;\n\n  // Commit release'u BEZ bramki konfiguracji (wołany przez commitOnRelease; bezpośrednio np. w testach).\n  // Kanonikalizuje cele (fs.realpath, per root) i staguje tylko ścieżki wewnątrz roota worktree;\n  // git add <real(dir)> każdego korzenia rejestru (L13) + <real(config.json)>;\n  // pliki korzeni rodzajów bez flagi release jadą w commicie poza wymiarem release_diff;\n  // commit msg \"{name}\\n\\n{description}\" — bez prefiksu, liczony raz, wspólny dla wszystkich trybów\n  // (sam \"{name}\" przy pustym opisie — gałąź defensywna, createRelease odmawia pustego opisu). Nigdy nie rzuca.\n  // Stagowanie korzenia releases sprawia, że plik metadanych release'u wpada do commita — commit ten jest\n  // STAŁYM markerem reign wyliczanym później przez resolveReleaseCommit().\n  // Cel commita zależy od config.git.commitTarget.mode:\n  //   'current' → real-index git add+commit na bieżącym HEAD;\n  //   'named'   → temp-index commit na tip istniejącego brancha config.git.commitTarget.branch;\n  //   'new'     → nowy branch (od tipa base = commitTarget.base || prywatne resolveDefaultBranch()) mechanizmem\n  //               commit-tree + update-ref, nazwa z commitTarget.template (kolizja → suffix -2/-3/...).\n  //   'named' bez branch / 'new' bez template → fallback do ścieżki 'current'.\n  // Gdy config.git.switchAfterRelease && mode !== 'current' → po commicie wewnętrzny wariant checkout\n  // (bez guardów dirty/busy) na docelowy branch. Patrz sekcja commitOnRelease.\n  commit(opts: { name: string; description: string /* pozostałe pola — patrz todo pod blokiem */ }): GitCommitResult;\n\n  // Best-effort commit przy pullu (M17 updateRelease({ assignUnreleased })). Gate: config.git.enabled + detect() + branch !== null;\n  // gate niespełniony → 'skipped' (NIGDY null — inaczej niż commitOnRelease).\n  // Ten sam scope stagowania co commit() MINUS nowy plik markera (pull nie dodaje pliku <slug>.json korzenia releases —\n  // stagowanie korzenia releases nieszkodliwe: brak nowego pliku ⇒ --diff-filter=A go nie wyłapie).\n  // Commit msg \"Pull to {latest.name}\". Nigdy nie rzuca.\n  commitPull(latest: Release): GitCommitResult;\n\n  // Best-effort push przy push release na remote (M25) — wejście z bramką, wołane przez releasePushService.\n  // Gate: config.git.enabled (master) + config.git.syncPushOnPush + detect() !== null + detect().branch !== null\n  //       — nazwany HEAD wymagany także przy jawnym branch. Gate niespełniony → null (NIE 'skipped').\n  // Spełniony gate → push(branch). Nigdy nie rzuca.\n  pushOnPush(branch?: string): GitPushResult | null;\n\n  // git push BEZ bramki konfiguracji. Pushuje branch DOCELOWY release'u (nie ślepo bieżący HEAD) — branch\n  // rozwiązuje wołający (M25) przez `git branch --contains resolveReleaseCommit(release)`; fallback bieżący HEAD,\n  // gdy commit nieodnaleziony. Bez jawnego branch przy detached HEAD → 'skipped'. git push <branch> → upstream. Nigdy nie rzuca.\n  push(branch?: string): GitPushResult;\n\n  // resolveDefaultBranch() — metoda PRYWATNA, poza tym interfejsem; patrz sekcja resolveDefaultBranch.\n\n  // --- Warstwa git jako augmentacja (Faza 2, wszystkie gated na config.git.enabled) ---\n\n  // Marker release'u z historii pliku metadanych: commit wprowadzający plik <slug>.json korzenia releases.\n  // git log --all --diff-filter=A -1 --format=%H -- <path>. `--all` przeszukuje WSZYSTKIE refy (nie tylko\n  // bieżący HEAD) — plik release'u niemutowalny ⇒ istnieje w dokładnie jednym commicie ⇒ marker znajduje się\n  // jednoznacznie niezależnie od brancha (warunek poprawności przy commicie poza HEAD: switch=off / branch-sibling).\n  // Release niemutowalny ⇒ jednoznaczny, STAŁY marker (model reign: M17 interpretuje go jako granicę —\n  // snapshot(vN) = M_{next}~1 / HEAD). Brak w historii żadnego refa (release sprzed włączenia gita, lokalny\n  // niezacommitowany marker) → null. Bez tagów, bez zapisanego gitSha.\n  resolveReleaseCommit(path: string): string | null;\n\n  // Diff dwóch refów (SHA) ograniczony do pathspeców. Źródło release_diff w trybie git ON — wołany na\n  // snapshotach reign (granica następnika / HEAD), nie na samych markerach (M17 release_diff).\n  // git diff <a>..<b> -- <pathspecs>. Nigdy nie rzuca (błąd → null / pusty).\n  diffRefs(shaA: string, shaB: string, pathspecs: string[]): GitRefDiff | null;\n\n  // Status HEAD do wskaźnika sidebara (GitStatusBadge, L5): dirty/clean + opcjonalnie ahead/behind vs upstream.\n  // Read-only, nigdy nie rzuca. null gdy brak repo / master off.\n  statusAheadBehind(): GitStatus | null;\n\n  // --- Warstwa switch brancha (prymityw „switch + reload\", gated na config.git.enabled) ---\n\n  // Read-only lista lokalnych branchy do dropdownu GitStatusBadge (L5) i selektora celu commitu na karcie #git.\n  // `git branch --format=%(refname:short)` + current z `git rev-parse --abbrev-ref HEAD`.\n  // null TYLKO gdy brak repo / master off (nic do listowania). detached HEAD → NIE null,\n  // lecz { current: null, branches: [...] } (lista istnieje, brak bieżącego). Nigdy nie rzuca.\n  listBranches(): { current: string | null; branches: string[] } | null;\n\n  // Przełącza HEAD/working tree na ISTNIEJĄCY branch (`git checkout <branch>`). Guard/never-throw.\n  // Kolejność guardów: gate (enabled + detect() !== null) → busy (aktywna tura mutująca dysk)\n  // → dirty-blocked (zmodyfikowane/staged pliki ŚLEDZONE; untracked NIE blokuje) → not-found\n  // (branch nie istnieje lokalnie) → git checkout → switched. NIE tworzy nowych branchy, NIE robi tagów.\n  checkout(branch: string): GitCheckoutResult;\n}\n\ntype GitRepoInfo = {\n  rootPath: string;\n  remoteUrl: string | null;   // brak origin → null\n  branch: string | null;      // detached HEAD LUB unborn branch (świeże repo, 0 commitów) → null\n  isDirty: boolean;\n};\n\ntype GitCommitResult =\n  | { status: 'committed'; sha: string; branch: string; switched: boolean }  // branch = docelowy branch commita; switched = czy HEAD przełączony (switchAfterRelease)\n  | { status: 'nothing-to-commit' }\n  | { status: 'skipped'; message?: string }  // commitPull: gate off / brak repo / detached-unborn HEAD;\n                                             // commit(): ścieżka real-index przy detached HEAD (message 'detached HEAD')\n                                             // albo katalogi stron poza repo (real-index i temp-index)\n  | { status: 'error'; message: string; recovery: GitErrorRecovery };  // porażki nowych ścieżek (branch-missing/base-missing/switch-*) też tu, z recovery.kind\n\ntype GitPushResult =\n  | { status: 'pushed' }\n  | { status: 'nothing-to-push' }\n  | { status: 'skipped' }                  // push(): detached HEAD bez jawnego branch — przez pushOnPush nieosiągalny\n  | { status: 'error'; message: string; recovery: GitErrorRecovery };\n\n// Additive payload wariantu 'error' — kontekst dla GitErrorRecoveryModal (L5) i handoffu „Fix it with Agent\".\n// Komponowany przez backend M28 (jedyny właściciel wiedzy o operacjach git); propagowany w polu gitSync\n// response createRelease / updateRelease (M17) i release-push (M25). Starzy konsumenci ignorują pole.\ntype GitErrorRecovery = {\n  operation: 'commit-on-release' | 'pull' | 'push';   // co backend chciał wykonać (bez zmian — 'commit-on-release' także dla porażek named/new)\n  kind?:                                                // OPCJONALNY, additive — dodatkowa klasyfikacja porażki commit-target/switch\n    | 'branch-missing'                                 //   tryb 'named': docelowy branch zniknął między konfiguracją a release'em\n    | 'base-missing'                                   //   tryb 'new': explicit base zniknął\n    | 'switch-failed'                                  //   switchAfterRelease: checkout na docelowy branch nie przeszedł\n    | 'switch-dirty'                                   //   switchAfterRelease: konflikt working tree (nie-specowe brudne pliki)\n    | 'non-fast-forward';                              //   push: remote ma commity, których lokalnie brak — okno proponuje Sync\n  reason: string;                                      // ludzkie „dlaczego\" (np. \"merge conflict in pages/foo.md\")\n  gitStderr: string;                                   // surowe stderr gita (diagnostyka)\n  intentPrompt: string;                                // gotowy do wysłania prompt dla agenta-recovery (kind-aware, patrz UI L5)\n};\n\n// Read-only status HEAD do wskaźnika sidebara (slice L5, GitStatusBadge).\ntype GitStatus = {\n  branch: string | null;\n  isDirty: boolean;\n  ahead: number | null;                    // null gdy brak upstream\n  behind: number | null;                   // null gdy brak upstream\n};\n\n// Wynik checkout(branch) — switch istniejącego brancha inicjowany z aplikacji (sidebar / release switch).\ntype GitCheckoutResult =\n  | { status: 'switched'; branch: string }\n  | { status: 'dirty-blocked' }            // zmodyfikowane/staged pliki ŚLEDZONE (D1/D1b); untracked NIE blokuje\n  | { status: 'not-found' }                // branch nie istnieje lokalnie\n  | { status: 'skipped' }                  // gate off / brak repo\n  | { status: 'busy' }                     // aktywna tura mutująca dysk tego projektu (D4.3)\n  | { status: 'error'; message: string };\n\n// Wynik diffRefs — źródło release_diff w trybie git ON (M17).\ntype GitRefDiff = {\n  files: Array<{ path: string; status: 'A' | 'M' | 'D' | 'R'; }>;\n  // szczegółowy patch/line-diff derywowany leniwie przez konsumenta (M17 release_diff projekcja)\n};\n```\n\n**Wejście z bramką a wykonanie.** Commit release'u i push mają po dwie metody: wejście z bramką (`commitOnRelease`, `pushOnPush`), które czyta przełączniki konfiguracji, oraz wykonanie (`commit`, `push`), które ich nie czyta. Tylko wejście zwraca `null` — przy niespełnionej bramce — i ten `null` trafia dosłownie do pola `gitSync` odpowiedzi jako „operacja git się nie uruchomiła”. `{ status: 'skipped' }` pochodzi z wykonania albo z `commitPull`, który bramki w osobnym wejściu nie ma.\n\n**Publiczne metody poza tym kontraktem.** `GitService` eksponuje w kodzie także `branchContainingCommit`, `diffRefToWorkingTree`, `isAncestorOfHead` i `showFile`. <todo comment=\"dopisać sygnatury i semantykę branchContainingCommit, diffRefToWorkingTree, isAncestorOfHead, showFile oraz pełny kształt opts metody commit() — znane są dziś tylko z kodu (src/server/services/git.ts)\"/>\n</after_change>"
}

### section mm4bidri
{
 "kind": "section",
 "anchor": "mm4bidri",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`detect()`",
 "content": "<after_change>\n`git rev-parse --show-toplevel` z `cwd` procesu c4s. Jeśli komenda zwraca błąd (nie repo) lub `git` nie istnieje w PATH → `null`. Gdy repo wykryte, zbiera:\n\n- `remoteUrl` — `git remote get-url origin` (nullable gdy brak remote `origin`).\n- `branch` — `git rev-parse --abbrev-ref HEAD` (nullable). Komenda zwraca literał `HEAD` zarówno przy prawdziwym detached HEAD, jak i przy **unborn branch** (świeże `git init`, zero commitów) — oba przypadki są tą komendą nieodróżnialne i mapowane na `branch: null`.\n- `isDirty` — `git status --porcelain` niepuste = są niezacommitowane zmiany. **Semantyka szeroka:** `isDirty` obejmuje **także pliki untracked** (nowe, niezacommitowane `pages/*.md` / pliki w korzeniu `entities` to w tym projekcie codzienność) — służy wyłącznie do badge dirty/clean, nie jest guardem checkoutu. **Guard `checkout()` używa węższego pojęcia „dirty\" (tylko zmodyfikowane/zastage'owane pliki ŚLEDZONE)** — patrz sekcja `checkout(branch)` niżej; sam untracked **nie** blokuje przełączenia (D1b).\n- `rootPath` — absolutna ścieżka root worktree.\n\nWeryfikuje, że **korzenie rodzaju `pages`** (sekcja <section_ref anchor=\"m28l13rt\"/>) mieszczą się w worktree repo; jeśli żaden nie leży w worktree — traktuje jak brak repo (`null`). Gdy część korzeni leży w innym worktree lub poza repo — te są pomijane (log), a scope commitu obejmuje **best-effort** tylko korzenie będące w wykrytym repo.\n</after_change>"
}

### section aqys9dje
{
 "kind": "section",
 "anchor": "aqys9dje",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`commitOnRelease(release)`",
 "content": "<after_change>\nGate: `config.git.enabled === true` **oraz** `detect() !== null`, a w trybie `current` dodatkowo `detect().branch !== null` — bez sub-toggle (`enabled` samo w sobie oznacza commit-on-release). Gate niespełniony → **`null`**, nie wariant `GitCommitResult`: master off, brak repo albo detached/unborn HEAD w trybie `current` (w świeżym repo bez commitów pierwszy commit musi powstać poza git sync, zanim moduł zacznie działać). `createRelease` przekazuje ten `null` dosłownie jako `gitSync: null`. Spełniony gate → `commit()`, wykonanie bez czytania przełączników.\n\nTryby `named` i `new` **nie wymagają nazwanego HEAD** — nie czytają go wcale, więc przy detached HEAD commit się wykonuje. W świeżym repo bez commitów oba kończą się błędem celu, nie `null`: `named` → `recovery.kind: 'branch-missing'` (gałęzi nie ma), `new` → `recovery.kind: 'base-missing'` (bazy nie da się ustalić).\n\n`{ status: 'skipped' }` nadal może wrócić z tej operacji — z wykonania, nie z bramki: ścieżka real-index przy detached HEAD (osiągalna wyłącznie przez fallback konfiguracji niżej) oraz katalogi stron leżące poza repo (w ścieżce real-index i temp-index).\n\n**Resolucja celu commita z `config.git.commitTarget` (dwie oddzielne osie: DOKĄD commit trafia + CZY HEAD się przełącza).** Zachowanie stagowania (scope, kanonikalizacja) jest wspólne dla wszystkich trybów; różni je **gdzie** ląduje ref commita:\n\n- **`mode: 'current'`** (default, backward-compat) — jak dziś: real-index `git add` skanonikalizowanych ścieżek spec + `git commit` na **bieżącym HEAD**. Working tree/indeks jak dotąd. `switched` zawsze `false`, `branch` = bieżący branch.\n- **`mode: 'named'`** — commit na tip **istniejącego** brancha `commitTarget.branch` (wybieranego na karcie ustawień `#git` z `listBranches()`). Branch nie istnieje w momencie release'u (zniknął po konfiguracji) → **NIE tworzymy go**: `{ status: 'error', message, recovery }` z `recovery.kind: 'branch-missing'`. Istnieje → commit mechanizmem **temp-index** na jego tip (niżej).\n- **`mode: 'new'`** — nowy branch release'u. Tip bazy = `commitTarget.base` (jeśli podany) lub `resolveDefaultBranch()` (gdy `base === null`). **Explicit `base` zniknął** → `{ status: 'error', …, recovery.kind: 'base-missing' }`. Nazwa = `template` po renderze placeholderów (`{release_slug}`, `{release_name}` sanityzowany do ref-safe, `{date}` = `YYYY-MM-DD` utworzenia release'u); **kolizja z istniejącym branchem** → numeryczny suffix (`-2`, `-3`, …) aż do wolnej nazwy (gwarancja świeżego brancha). Nowy branch **zawsze wyrasta z tipa base, NIGDY z HEAD** (anti branch-of-branch — decyzja kotwicy base): każdy release-branch to rodzeństwo off base, stackowanie strukturalnie niemożliwe, również przy `switchAfterRelease=on` i przy HEAD stojącym na wcześniejszym release-branchu.\n- **Fallback konfiguracji** — `named` bez `commitTarget.branch` albo `new` bez `commitTarget.template` → commit idzie ścieżką trybu `current` (real-index na bieżącym HEAD). Bramka sprawdzała nazwany HEAD tylko dla `current`, więc przy detached HEAD ta ścieżka zwraca `{ status: 'skipped', message: 'detached HEAD' }`.\n\n**Mechanika temp-index (`named`/`new`) — nie-destrukcyjna, bez dotykania working tree/HEAD/realnego indeksu.** Tymczasowy indeks przez `GIT_INDEX_FILE` (osobny plik), zasiany tipem celu: `git read-tree <tip>` (tip = tip named-brancha lub tip base). Stage **tylko** skanonikalizowanych ścieżek spec (reuse tej samej realpath-logiki co `current` — zestaw stagowania: `dir` każdego korzenia rejestru + `config.json`), `git write-tree` → nowe `tree`. Gdy `tree` == tree tipa (nic nowego) → `{ status: 'nothing-to-commit' }`. Inaczej `git commit-tree <tree> -p <tip> -m \"{name}\\n\\n{description}\"` → nowy commit-sha, następnie `git update-ref refs/heads/<target> <sha>` (dla `new`: `<target>` = świeża nazwa; dla `named`: fast-forward tipa brancha). **Working tree, HEAD i realny indeks pozostają nietknięte** aż do opcjonalnego switchu — to jedyny mechanizm poprawny także przy branchu **zdywergowanym** od HEAD (nakłada wyłącznie delty spec na tree celu, nie miesza obcych zmian). Temp-index sprzątany w `finally`.\n\n**Opcjonalny switch po commicie (`switchAfterRelease && mode !== 'current'`).** Po udanym `update-ref` wołany jest **wewnętrzny wariant `checkout(target)` z pominięciem pre-guardów `dirty-blocked` i `busy`** (patrz <section_ref anchor=\"1svflc6b\"/> — switch odpala się wewnątrz tury release'u, a po temp-index commicie working tree jest z definicji „brudny\" względem bieżącego HEAD). Sukces → `switched: true`. Porażka switchu → **commit pozostaje durable** (release zapisany, branch ma commit), zwracany `{ status: 'error', …, recovery.kind: 'switch-failed' }` (lub `'switch-dirty'` przy konflikcie nie-specowych brudnych plików). `switchAfterRelease=off` → HEAD zostaje, commit żyje na docelowym branchu przez `update-ref`, pliki release'u zostają na dysku working tree jako źródło prawdy (SQLite cache spójny — nota dysk↔SQLite w M17).\n\n**Kanonikalizacja ścieżek przed `git add` (obowiązkowa, per korzeń).** `git add` dopasowuje pathspeci **leksykalnie** do roota worktree, więc niezresolvowana ścieżka osiągana przez symlink (np. `dir` korzenia będący symlinkiem do innego repo) zostaje odrzucona przez git z `fatal: '…' is outside repository`, mimo że `detect()` poprawnie wykrył repo (git kanonikalizuje *wewnątrz* symlinka). Dlatego przed `git add` każdy cel stagowania (`dir` **każdego korzenia rejestru** — osobna kanonikalizacja per korzeń — oraz `config.json`) jest kanonikalizowany przez `fs.realpath`, a stagowane są **tylko** te zresolvowane ścieżki, które leżą wewnątrz wykrytego `rootPath` worktree. Ścieżki nie-symlinkowe resolvują się do siebie (poprawka regresyjnie bezpieczna), więc zwykły setup działa bez zmian, a symlinkowany worktree jest obsługiwany przezroczyście. Cel, który po `realpath` leży **poza** wykrytym repo (np. korzeń użytkownika w innym worktree, albo `config.json` żyjący w cwd c4s, ale nieobecny w docelowym repo), jest **pomijany** — nie przerywa całego commitu.\n\n**Scope stagowania = commitowany tekst = rejestr korzeni.** Zestaw stagowania to `real(dir)` każdego korzenia rejestru (L13, sekcja <section_ref anchor=\"m28l13rt\"/>) plus `config.json`: strony markdown wszystkich korzeni rodzaju `pages`, pliki korzenia `entities` (`<type>/<slug>.json` i `tags.json`), pliki metadanych wydań korzenia `releases` (`<slug>.json`, M17 <section_ref anchor=\"m17reldisk\"/>) oraz pliki korzeni `plans`, `briefs` i `patches`, które lądują w historii git (współdzielenie w zespole). Udział w wydaniu jest osobną osią — rozstrzyga go flaga `release` rodzaju (M17) — więc pliki korzeni rodzajów bez tej flagi jadą w commicie release'u poza wymiarem `release_diff`: to ride-along w commicie, nie treść release'u. Pochodny indeks `db.sqlite*` (M29) **nie** jest stagowany — jest gitignored (M01) i odbudowywany z tekstu przy boot.\n\n> **Blok zarządzany w `.gitignore` przelicza się poza tą operacją** — jego zawartość, cztery reguły przeliczenia i raportowanie created-vs-found niesie <section_ref anchor=\"2qwi21mw\"/>.\n\n**Przebieg w trybie `current`.** Przy spełnionym gate: `git add <real(dir)>` dla każdego korzenia rejestru + `<real(config.json)>` (z pominięciem celów spoza roota worktree); jeśli nic do zacommitowania → `{ status: 'nothing-to-commit' }` (sukces, nie błąd). Commit message — jeden dla wszystkich trzech trybów, liczony raz w `commit()`: `{name}` + pusta linia + `{description}`, **bez prefiksu `Release `**; przy pustym opisie sam `{name}` (gałąź defensywna — `createRelease` odmawia pustego opisu, więc trafia tu tylko bezpośrednie wywołanie `commit()`). Zwraca `{ status: 'committed', sha, branch, switched }` przy sukcesie (`branch` = docelowy branch commita, `switched` = czy HEAD przełączony przez `switchAfterRelease`) lub `{ status: 'error', message, recovery }` przy niepowodzeniu (porażki nowych ścieżek `named`/`new`/switch niosą `recovery.kind`). **Nigdy nie rzuca** — wszystkie błędy mapowane na `status: 'error'`; `null` wyłącznie z bramki (wyżej). Powyższe dotyczy trybu `current`; `named`/`new` używają temp-index (patrz wyżej), ale kontrakt zwrotu jest ten sam.\n\n**Marker release'u = commit wprowadzający plik metadanych (STAŁY).** Stagowanie korzenia `releases` włącza plik `<slug>.json` tego korzenia do commita release'u. Ponieważ release jest niemutowalny (M17), plik pojawia się w dokładnie jednym commicie — `resolveReleaseCommit(<ścieżka pliku <slug>.json korzenia releases>)` (`git log --diff-filter=A -1 --format=%H`) wylicza ten marker leniwie z historii pliku. **Bez tagów, bez zapisanego `gitSha`, bez re-touch** — tożsamość release'u w gicie wynika wyłącznie z historii jego pliku. Marker wyznacza granice **reign** release'u dla `release_diff` w trybie git ON (M17 <section_ref anchor=\"m17reldiff\"/>).\n\n**Rezydualny edge B3 (po usunięciu sub-toggle znacznie zawężony).** Główny scenariusz „marker wchłonięty obcym commitem\" zniknął — commit-on-release jest zawsze aktywny przy `git.enabled`, więc marker commitowany jest w tym samym akcie co release. Pozostaje wąski przypadek: `git.enabled` włączony **po** utworzeniu wcześniejszych release'ów — ich pliki markerów (na dysku, niezacommitowane) wchłonie najbliższy commit; `resolveReleaseCommit` zwróci wtedy commit-nosiciela jako przybliżony marker. Odnotowane jako otwarte pytanie 55 (<section_ref anchor=\"e6nqwep9\"/>).\n</after_change>"
}

### section 2qwi21mw
{
 "kind": "section",
 "anchor": "2qwi21mw",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "Blok zarządzany w `.gitignore` (`ensureGitignore`)",
 "content": "<after_change>\nBlok powstaje przy bootstrapie i jest **przeliczany po każdym zapisie konfiguracji dotykającym `git`**. Jego zawartość jest funkcją `git.enabled` i rejestru korzeni: wpis stały (`*.deprecated`) jest obecny niezależnie od przełącznika, a `dir` każdego korzenia, którego rodzaj ma flagę `gitignore` (L13, sekcja <section_ref anchor=\"m28l13rt\"/>), wyłącznie przy `git.enabled = false` (default) — przy master git ON mają być commitowane, więc z bloku znikają. Przeliczenie jest **best-effort**: jego niepowodzenie jest logowane, ale nie wywraca zapisu konfiguracji. Konsekwencja praktyczna: włączenie synchronizacji git nie wymaga ręcznego czyszczenia `.gitignore`.\n\n```gitignore\n*.deprecated              # stały — niezależny od przełącznika git\n.claude4spec/briefs/      # dynamiczne — obecne wyłącznie gdy\n.claude4spec/patches/     # synchronizacja git jest wyłączona (default);\n.claude4spec/plans/       # przy master git ON pomijane, bo katalogi\n.claude4spec/releases/    # artefaktów mają być commitowane\n```\n\n**Cztery reguły przeliczenia.** Wpisy powstają z `dir` korzeni rejestru z flagą `gitignore`; te ścieżki są stałe, więc relokacji nie ma czego śledzić. Szerszy istniejący ignore całego `.claude4spec/` liczy się jako pokrycie i redundantna linia nie jest dopisywana. Bootstrap **nie nadpisuje** zastanego `.gitignore` — dopisuje brakujące wpisy na końcu, pod komentarzem `# claude4spec (auto-added)`. Wzorzec bez wiodącego ukośnika łapie na dowolnej głębokości, więc działa także wtedy, gdy dotfolder nie leży w korzeniu repo.\n\n**Ignorowane są wyłącznie wymienione ścieżki, NIE cały `.claude4spec/`** — to celowe. Katalog encji i registry tagów są źródłem prawdy i muszą być trackowane, mimo że leżą wewnątrz dotfolderu (M29 <section_ref anchor=\"m29cel001\"/>); gdyby ignore obejmował dotfolder w całości, encje wypadłyby z gita. Dlatego blok obejmuje wyłącznie wzorzec `*.deprecated` oraz katalogi korzeni z flagą `gitignore`, a konfiguracja, encje, tagi i pluginy pozostają widoczne dla gita. Politykę commitowania samego dotfolderu trzyma M01 <section_ref anchor=\"cfg0gitw\"/>.\n\n**Created-vs-found jest wynikiem przeliczenia, nie efektem ubocznym.** Operacja raportuje, czy `.gitignore` *utworzyła* (pliku wcześniej nie było), czy tylko *dopisała* blok do istniejącego. Rozróżnienie ma jednego konsumenta i to on decyduje, co z nim zrobić: rollback nieudanego klonowania usuwa plik wyłącznie wtedy, gdy powstał w tym runie (M27 <section_ref anchor=\"64bmqf81\"/>).\n</after_change>"
}

### section yn1oesly
{
 "kind": "section",
 "anchor": "yn1oesly",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`commitPull(latest)`",
 "content": "<after_change>\n**Drugi wołający ścieżki commit — pull w trybie git** (M17 `updateRelease({ assignUnreleased: true })`, <section_ref anchor=\"mbjdcls0\"/>): w gicie „pull do najnowszego\" realizuje się przez commit working tree do reign najnowszego release'u. Osobna operacja od `commitOnRelease`, bo różni się intencją i komunikatem, a **nie dodaje nowego pliku markera**:\n\n- Gate: `config.git.enabled` + `detect() !== null` + `detect().branch !== null` — nazwany HEAD wymagany niezależnie od `commitTarget`, bo pull zawsze commituje na bieżący HEAD. Nie spełniony → `{ status: 'skipped' }`, **nigdy `null`** — inaczej niż `commitOnRelease`; `updateRelease` przekazuje ten wynik do `gitSync` bez zmian.\n- Scope stagowania: **ten sam co `commit()`** (`real(dir)` każdego korzenia rejestru + `config.json`, z kanonikalizacją per korzeń) **minus nowy plik markera** — pull nie tworzy pliku metadanych wydania, więc stagowanie korzenia `releases` jest nieszkodliwe (brak nowego pliku ⇒ `--diff-filter=A` nie wyłapie tego commita jako markera żadnego release'u).\n- Commit message: `Pull to {latest.name}` (gdzie `latest` = najnowszy release, do którego reign wchłaniany jest working tree).\n- Czysty working tree → `{ status: 'nothing-to-commit' }` (sukces). **Nigdy nie rzuca** — błędy mapowane na `{ status: 'error', message, recovery }`.\n\nCommit-pull ląduje w historii **między markerami**, więc model reign (M17 <section_ref anchor=\"m17reldiff\"/>) automatycznie zalicza go do reign najnowszego release'u — dokładnie tak samo, jak ręczny `git commit` z terminala (implicit pull).\n\n**`commitPull` NIE podlega `commitTarget`.** Pull zawsze commituje working tree na **bieżący HEAD** (semantyka „utrwal working tree przed pullem/wchłonięciem do najnowszego reign\") — `commitTarget.mode`/`branch`/`template`/`base` oraz `switchAfterRelease` dotyczą wyłącznie `commitOnRelease`. Commit-pull to real-index commit na HEAD niezależnie od trybu commit-target.\n</after_change>"
}

### section sw1u84nn
{
 "kind": "section",
 "anchor": "sw1u84nn",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`pushOnPush(branch?)` i `push(branch?)`",
 "content": "<after_change>\nGate (`pushOnPush`): `config.git.enabled === true` (master) **oraz** `config.git.syncPushOnPush === true` **oraz** `detect() !== null` **oraz** `detect().branch !== null` — nazwany HEAD wymagany także wtedy, gdy wołający podał jawny `branch`. Gate niespełniony → **`null`**, nie wariant `GitPushResult`; M25 przekazuje go jako `gitSync: null`. Spełniony gate → `push(branch)`, wykonanie bez czytania przełączników. Sam `push()` zwraca `{ status: 'skipped' }` przy detached HEAD bez jawnego `branch` — przez `pushOnPush` ten przypadek jest nieosiągalny, bo odfiltrowuje go bramka.\n\n**`push(branch?)` targetuje branch DOCELOWY release'u, nie ślepo bieżący HEAD.** Gdy commit-on-release wylądował na innym branchu (`commitTarget` `named`/`new`, `switchAfterRelease=off`), HEAD może wciąż stać na starym branchu — ślepy `git push` bieżącego HEAD pominąłby commit release'u. Dlatego M25 rozwiązuje **branch niosący commit release'u** przez `git branch --contains resolveReleaseCommit(release)` i przekazuje go jako `branch`; **fallback do bieżącego HEAD**, gdy commit nieodnaleziony (commit-on-release był OFF — nie ma dedykowanego brancha release'u). Gdy gate spełniony: `git push <branch>` (docelowy branch → upstream); brak upstream / błąd sieci / odrzucenie → `{ status: 'error', message, recovery }`. Odrzucenie non-fast-forward rozpoznawane jest osobno: `recovery.kind: 'non-fast-forward'`, a okno `git-sync-recover` proponuje wtedy pobranie zmian przez `sync()` zamiast agenta (<section_ref anchor=\"u5vl07ch\"/>). **Nigdy nie rzuca.**\n</after_change>"
}

### section rslvdfbr
{
 "kind": "section",
 "anchor": "rslvdfbr",
 "headingPath": [
  "M28 — Git Sync",
  "Domain"
 ],
 "heading": "`resolveDefaultBranch()`",
 "content": "<after_change>\nAuto-detekcja domyślnego brancha bazowego dla trybu `commitTarget: 'new'`, gdy `commitTarget.base === null` (user nie wskazał bazy na karcie ustawień `#git`). Kolejność prób (pierwsza udana wygrywa):\n\n1. `git symbolic-ref --short refs/remotes/origin/HEAD` → branch domyślny remote (np. `origin/main` → `main`).\n2. Fallback lokalny: istniejący `main` → `master`.\n3. Ostateczny fallback: bieżący branch (`detect().branch`).\n\n**Read-only, nigdy nie rzuca** — błąd każdej próby przechodzi do następnej. Zwraca `null` tylko gdy nic nie da się ustalić (świeże repo bez branchy, unborn HEAD) → wtedy `commitOnRelease` w trybie `new` nie ma tipa bazy → `{ status: 'error', …, recovery.kind: 'base-missing' }`. Metoda **prywatna** `GitService` — poza publicznym interfejsem; woła ją ścieżka commita w trybie `new` bez explicit base. <todo comment=\"ustalić, skąd lista „Base branch” na karcie #git bierze nazwę gałęzi domyślnej przy opcji (default), skoro resolveDefaultBranch jest prywatna\"/>\n</after_change>"
}

## Entity (dto) — change
[
 {
  "type": "dto",
  "slug": "git-status-response",
  "name": "GitStatusResponse",
  "op": "update",
  "before": {
   "slug": "git-status-response",
   "title": "GitStatusResponse",
   "description": "Response `GET /api/git/status` (M28). Runtime fakt o repozytorium git wykrytym w katalogu stron (`pagesDir`). Konsumowany wyłącznie przez M26 sekcja Git w `/settings` — warunkuje pokazanie sekcji (`detected`) i renderuje kartę info o repo. Wynik z `gitService.detect()`; gdy brak `git` w PATH, brak repo, lub `pagesDir` poza worktree → `detected: false` i pozostałe pola `null/false`. NIE jest persystowane w configu — czytane na żądanie.",
   "fields": [
    {
     "name": "detected",
     "type": "boolean",
     "required": true,
     "description": "`true` gdy pagesDir leży w repo git (i `git` jest w PATH). `false` → M26 pokazuje empty state, checkboxy git ukryte/disabled."
    },
    {
     "name": "rootPath",
     "type": "string | null",
     "required": true,
     "description": "Absolutna ścieżka root worktree repo (`git rev-parse --show-toplevel`). `null` gdy `detected: false`."
    },
    {
     "name": "remoteUrl",
     "type": "string | null",
     "required": true,
     "description": "URL remote `origin` (`git remote get-url origin`). `null` gdy brak origin lub `detected: false`."
    },
    {
     "name": "branch",
     "type": "string | null",
     "required": true,
     "description": "Aktualny branch (`git rev-parse --abbrev-ref HEAD`). `null` gdy `detected: false`, detached HEAD, lub unborn branch (świeże repo, 0 commitów) — komenda zwraca `HEAD` w obu ostatnich przypadkach i są nieodróżnialne. Branch `null` powoduje, że commit/push przy release zwracają `skipped`."
    },
    {
     "name": "isDirty",
     "type": "boolean",
     "required": true,
     "description": "`true` gdy `git status --porcelain` zwraca niepusty wynik (są niezacommitowane zmiany). `false` gdy clean lub `detected: false`."
    },
    {
     "name": "ahead",
     "type": "number | null",
     "required": true,
     "description": "Liczba lokalnych commitów bieżącej gałęzi, których nie ma jej upstream — liczona lokalnie względem ostatnio pobranych refów zdalnych. `null` gdy brak upstreamu, detached HEAD albo `detected: false`."
    },
    {
     "name": "behind",
     "type": "number | null",
     "required": true,
     "description": "Liczba commitów upstreamu, których bieżąca gałąź nie ma — liczona lokalnie względem ostatnio pobranych refów zdalnych, więc aktualna po fetchu. `null` gdy brak upstreamu, detached HEAD albo `detected: false`."
    },
    {
     "name": "lastFetchedAt",
     "type": "string | null",
     "required": true,
     "description": "ISO 8601 czas ostatniego pobrania z remote. `null` gdy repozytorium nigdy nie pobierało albo `detected: false`. Zasila podpowiedź wpisu w slocie `Nagłówek` („Last fetched …”)."
    }
   ],
   "examples": [],
   "tags": [
    "api",
    "m28"
   ],
   "createdAt": "2026-06-02T14:52:43.000Z",
   "updatedAt": "2026-10-06T22:21:44.887Z"
  },
  "after": {
   "slug": "git-status-response",
   "title": "GitStatusResponse",
   "description": "Response `GET /api/git/status` (M28). Runtime fakt o repozytorium git wykrytym w katalogu stron (`pagesDir`). Konsumowany wyłącznie przez M26 sekcja Git w `/settings` — warunkuje pokazanie sekcji (`detected`) i renderuje kartę info o repo. Wynik z `gitService.detect()`; gdy brak `git` w PATH, brak repo, lub `pagesDir` poza worktree → `detected: false` i pozostałe pola `null/false`. NIE jest persystowane w configu — czytane na żądanie.",
   "fields": [
    {
     "name": "detected",
     "type": "boolean",
     "required": true,
     "description": "`true` gdy pagesDir leży w repo git (i `git` jest w PATH). `false` → M26 pokazuje empty state, checkboxy git ukryte/disabled."
    },
    {
     "name": "rootPath",
     "type": "string | null",
     "required": true,
     "description": "Absolutna ścieżka root worktree repo (`git rev-parse --show-toplevel`). `null` gdy `detected: false`."
    },
    {
     "name": "remoteUrl",
     "type": "string | null",
     "required": true,
     "description": "URL remote `origin` (`git remote get-url origin`). `null` gdy brak origin lub `detected: false`."
    },
    {
     "name": "branch",
     "type": "string | null",
     "required": true,
     "description": "Aktualny branch (`git rev-parse --abbrev-ref HEAD`). `null` gdy `detected: false`, detached HEAD, lub unborn branch (świeże repo, 0 commitów) — komenda zwraca `HEAD` w obu ostatnich przypadkach i są nieodróżnialne. Branch `null` powoduje, że push przy release i commit release'u w trybie commitTarget `current` się nie wykonują (`gitSync: null`), a commit pulla zwraca `skipped`; tryby `named`/`new` commitują także przy detached HEAD."
    },
    {
     "name": "isDirty",
     "type": "boolean",
     "required": true,
     "description": "`true` gdy `git status --porcelain` zwraca niepusty wynik (są niezacommitowane zmiany). `false` gdy clean lub `detected: false`."
    },
    {
     "name": "ahead",
     "type": "number | null",
     "required": true,
     "description": "Liczba lokalnych commitów bieżącej gałęzi, których nie ma jej upstream — liczona lokalnie względem ostatnio pobranych refów zdalnych. `null` gdy brak upstreamu, detached HEAD albo `detected: false`."
    },
    {
     "name": "behind",
     "type": "number | null",
     "required": true,
     "description": "Liczba commitów upstreamu, których bieżąca gałąź nie ma — liczona lokalnie względem ostatnio pobranych refów zdalnych, więc aktualna po fetchu. `null` gdy brak upstreamu, detached HEAD albo `detected: false`."
    },
    {
     "name": "lastFetchedAt",
     "type": "string | null",
     "required": true,
     "description": "ISO 8601 czas ostatniego pobrania z remote. `null` gdy repozytorium nigdy nie pobierało albo `detected: false`. Zasila podpowiedź wpisu w slocie `Nagłówek` („Last fetched …”)."
    }
   ],
   "examples": [],
   "tags": [
    "api",
    "m28"
   ],
   "createdAt": "2026-06-02T14:52:43.000Z",
   "updatedAt": "2026-10-08T19:37:59.760Z"
  }
 }
]

## Criteria (ac) — change, 19 active
[
 {
  "type": "ac",
  "slug": "ac-commit-release-u-ma-komunikat-name-pu",
  "name": "Commit release'u ma komunikat `{name}` + pusta linia + `{description}`, bez prefiksu `Release `, jednakowo w trybach commitTarget `current`, `named` i `new`.",
  "op": "create",
  "after": {
   "slug": "ac-commit-release-u-ma-komunikat-name-pu",
   "title": "Commit release'u ma komunikat `{name}` + pusta linia + `{description}`, bez prefiksu `Release `, jednakowo w trybach commitTarget `current`, `named` i `new`.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "git-enabled",
    "m28"
   ],
   "createdAt": "2026-10-08T19:39:01.699Z",
   "updatedAt": "2026-10-08T19:39:01.699Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-commitforrelease-przed-git-add-kan",
  "name": "`commitOnRelease()` przed `git add` kanonikalizuje cele przez `fs.realpath` (per root) i staguje tylko ścieżki wewnątrz `rootPath`, dzięki czemu symlinkowany root/cwd nie wywołuje `git add … outside repository`; cel resolvujący poza repo jest pomijany, nie przerywa commitu.",
  "op": "update",
  "before": {
   "slug": "ac-commitforrelease-przed-git-add-kan",
   "text": "`commitForRelease()` przed `git add` kanonikalizuje cele przez `fs.realpath` (per root) i staguje tylko ścieżki wewnątrz `rootPath`, dzięki czemu symlinkowany root/cwd nie wywołuje `git add … outside repository`; cel resolvujący poza repo jest pomijany, nie przerywa commitu.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "m28-edge"
   ]
  },
  "after": {
   "slug": "ac-commitforrelease-przed-git-add-kan",
   "title": "`commitOnRelease()` przed `git add` kanonikalizuje cele przez `fs.realpath` (per root) i staguje tylko ścieżki wewnątrz `rootPath`, dzięki czemu symlinkowany root/cwd nie wywołuje `git add … outside repository`; cel resolvujący poza repo jest pomijany, nie przerywa commitu.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-07-13T12:19:46.000Z",
   "updatedAt": "2026-10-08T19:38:53.539Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-commitforrelease-staguje-tez-releasesdir",
  "name": "commitOnRelease staguje plik <slug>.json korzenia releases (obok katalogów pozostałych korzeni rejestru i config.json), by plik release'u trafił do commita jako kotwica.",
  "op": "update",
  "before": {
   "slug": "ac-commitforrelease-staguje-tez-releasesdir",
   "title": "commitForRelease staguje plik <slug>.json korzenia releases (obok katalogów pozostałych korzeni rejestru i config.json), by plik release'u trafił do commita jako kotwica.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28",
    "releases-on-disk"
   ],
   "createdAt": "2026-07-09T14:06:51.000Z",
   "updatedAt": "2026-10-05T16:10:03.531Z"
  },
  "after": {
   "slug": "ac-commitforrelease-staguje-tez-releasesdir",
   "title": "commitOnRelease staguje plik <slug>.json korzenia releases (obok katalogów pozostałych korzeni rejestru i config.json), by plik release'u trafił do commita jako kotwica.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28",
    "releases-on-disk"
   ],
   "createdAt": "2026-07-09T14:06:51.000Z",
   "updatedAt": "2026-10-08T19:38:53.542Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-gdy-docelowy-branch-tryb-named-zniknal",
  "name": "Gdy docelowy branch (tryb named) zniknął między konfiguracją a release'em, commitOnRelease zwraca status='error' z recovery.kind='branch-missing' (nie tworzy brancha); commit/release pozostaje durable, UI otwiera kind-aware GitErrorRecoveryModal.",
  "op": "update",
  "before": {
   "slug": "ac-gdy-docelowy-branch-tryb-named-zniknal",
   "text": "Gdy docelowy branch (tryb named) zniknął między konfiguracją a release'em, commitForRelease zwraca status='error' z recovery.kind='branch-missing' (nie tworzy brancha); commit/release pozostaje durable, UI otwiera kind-aware GitErrorRecoveryModal.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "m28-edge"
   ]
  },
  "after": {
   "slug": "ac-gdy-docelowy-branch-tryb-named-zniknal",
   "title": "Gdy docelowy branch (tryb named) zniknął między konfiguracją a release'em, commitOnRelease zwraca status='error' z recovery.kind='branch-missing' (nie tworzy brancha); commit/release pozostaje durable, UI otwiera kind-aware GitErrorRecoveryModal.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-07-14T09:41:42.000Z",
   "updatedAt": "2026-10-08T19:38:53.608Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-gdy-explicit-committarget-base-tryb-new",
  "name": "Gdy explicit commitTarget.base (tryb new) zniknął przed release'em, commitOnRelease zwraca status='error' z recovery.kind='base-missing'; release pozostaje udany.",
  "op": "update",
  "before": {
   "slug": "ac-gdy-explicit-committarget-base-tryb-new",
   "text": "Gdy explicit commitTarget.base (tryb new) zniknął przed release'em, commitForRelease zwraca status='error' z recovery.kind='base-missing'; release pozostaje udany.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "m28-edge"
   ]
  },
  "after": {
   "slug": "ac-gdy-explicit-committarget-base-tryb-new",
   "title": "Gdy explicit commitTarget.base (tryb new) zniknął przed release'em, commitOnRelease zwraca status='error' z recovery.kind='base-missing'; release pozostaje udany.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-07-14T09:41:42.000Z",
   "updatedAt": "2026-10-08T19:38:53.611Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-gdy-git-add-niczego-nie-wniosl-commi",
  "name": "Gdy `git add` niczego nie wniósł, `commitOnRelease()` zwraca `{ status: 'nothing-to-commit' }` — sukces, nie błąd, bez żadnego sygnału w interfejsie.",
  "op": "update",
  "before": {
   "slug": "ac-gdy-git-add-niczego-nie-wniosl-commi",
   "text": "Gdy `git add` niczego nie wniósł, `commitForRelease()` zwraca `{ status: 'nothing-to-commit' }` — sukces, nie błąd, bez warningu w toaście.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "m28-edge"
   ]
  },
  "after": {
   "slug": "ac-gdy-git-add-niczego-nie-wniosl-commi",
   "title": "Gdy `git add` niczego nie wniósł, `commitOnRelease()` zwraca `{ status: 'nothing-to-commit' }` — sukces, nie błąd, bez żadnego sygnału w interfejsie.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-07-13T12:19:46.000Z",
   "updatedAt": "2026-10-08T19:38:53.613Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-gdy-wyrenderowana-nazwa-nowego-brancha",
  "name": "Gdy wyrenderowana nazwa nowego brancha (tryb new) koliduje z istniejącym branchem, commitOnRelease dokleja numeryczny suffix (-2, -3, ...) aż do wolnej nazwy, gwarantując świeży branch.",
  "op": "update",
  "before": {
   "slug": "ac-gdy-wyrenderowana-nazwa-nowego-brancha",
   "text": "Gdy wyrenderowana nazwa nowego brancha (tryb new) koliduje z istniejącym branchem, commitForRelease dokleja numeryczny suffix (-2, -3, ...) aż do wolnej nazwy, gwarantując świeży branch.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "m28-edge"
   ]
  },
  "after": {
   "slug": "ac-gdy-wyrenderowana-nazwa-nowego-brancha",
   "title": "Gdy wyrenderowana nazwa nowego brancha (tryb new) koliduje z istniejącym branchem, commitOnRelease dokleja numeryczny suffix (-2, -3, ...) aż do wolnej nazwy, gwarantując świeży branch.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-07-14T09:41:42.000Z",
   "updatedAt": "2026-10-08T19:38:53.616Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-gitservice-commitpull-latest-commituje",
  "name": "gitService.commitPull(latest) commituje working tree z komunikatem 'Pull to {latest.name}' i scope stagowania identycznym z commitOnRelease, ale bez dodawania nowego pliku markera (brak nowego pliku <slug>.json korzenia releases ⇒ --diff-filter=A nie wyłapie tego commita jako markera); gate = config.git.enabled + detect() + branch !== null; czysty working tree → nothing-to-commit; nigdy nie rzuca.",
  "op": "update",
  "before": {
   "slug": "ac-gitservice-commitpull-latest-commituje",
   "title": "gitService.commitPull(latest) commituje working tree z komunikatem 'Pull to {latest.name}' i scope stagowania identycznym z commitForRelease, ale bez dodawania nowego pliku markera (brak nowego pliku <slug>.json korzenia releases ⇒ --diff-filter=A nie wyłapie tego commita jako markera); gate = config.git.enabled + detect() + branch !== null; czysty working tree → nothing-to-commit; nigdy nie rzuca.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "slug": "patch-api-releases-nameorid",
     "type": "endpoint"
    }
   ],
   "tags": [
    "git-enabled",
    "m28"
   ],
   "createdAt": "2026-07-13T22:11:57.000Z",
   "updatedAt": "2026-10-05T16:10:03.539Z"
  },
  "after": {
   "slug": "ac-gitservice-commitpull-latest-commituje",
   "title": "gitService.commitPull(latest) commituje working tree z komunikatem 'Pull to {latest.name}' i scope stagowania identycznym z commitOnRelease, ale bez dodawania nowego pliku markera (brak nowego pliku <slug>.json korzenia releases ⇒ --diff-filter=A nie wyłapie tego commita jako markera); gate = config.git.enabled + detect() + branch !== null; czysty working tree → nothing-to-commit; nigdy nie rzuca.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "slug": "patch-api-releases-nameorid",
     "type": "endpoint"
    }
   ],
   "tags": [
    "git-enabled",
    "m28"
   ],
   "createdAt": "2026-07-13T22:11:57.000Z",
   "updatedAt": "2026-10-08T19:38:53.618Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-gitservice-push-branch-pushuje-branch",
  "name": "gitService.pushOnPush(branch?) pushuje branch niosący commit release'u (git branch --contains resolveReleaseCommit(release)), z fallbackiem do bieżącego HEAD gdy commit nieodnaleziony — nie ślepo bieżący HEAD.",
  "op": "update",
  "before": {
   "slug": "ac-gitservice-push-branch-pushuje-branch",
   "text": "gitService.push(branch?) pushuje branch niosący commit release'u (git branch --contains resolveReleaseCommit(release)), z fallbackiem do bieżącego HEAD gdy commit nieodnaleziony — nie ślepo bieżący HEAD.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "git-enabled",
    "m28"
   ]
  },
  "after": {
   "slug": "ac-gitservice-push-branch-pushuje-branch",
   "title": "gitService.pushOnPush(branch?) pushuje branch niosący commit release'u (git branch --contains resolveReleaseCommit(release)), z fallbackiem do bieżącego HEAD gdy commit nieodnaleziony — nie ślepo bieżący HEAD.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "git-enabled",
    "m28"
   ],
   "createdAt": "2026-07-14T09:41:42.000Z",
   "updatedAt": "2026-10-08T19:38:53.534Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-przy-committarget-named-bez-branch-al",
  "name": "Przy commitTarget `named` bez `branch` (albo `new` bez `template`) i detached HEAD commitOnRelease zwraca `{ status: 'skipped', message: 'detached HEAD' }`.",
  "op": "create",
  "after": {
   "slug": "ac-przy-committarget-named-bez-branch-al",
   "title": "Przy commitTarget `named` bez `branch` (albo `new` bez `template`) i detached HEAD commitOnRelease zwraca `{ status: 'skipped', message: 'detached HEAD' }`.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-10-08T19:39:01.721Z",
   "updatedAt": "2026-10-08T19:39:01.721Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-przy-config-git-enabled-false-commitp",
  "name": "Przy config.git.enabled=false commitPull zwraca `{ status: 'skipped' }`, a nie `null`.",
  "op": "create",
  "after": {
   "slug": "ac-przy-config-git-enabled-false-commitp",
   "title": "Przy config.git.enabled=false commitPull zwraca `{ status: 'skipped' }`, a nie `null`.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "git-enabled",
    "m28"
   ],
   "createdAt": "2026-10-08T19:39:01.705Z",
   "updatedAt": "2026-10-08T19:39:01.705Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-przy-detached-head-pushonpush-zwraca",
  "name": "Przy detached HEAD pushOnPush zwraca `null` także wtedy, gdy wołający podał jawny branch.",
  "op": "create",
  "after": {
   "slug": "ac-przy-detached-head-pushonpush-zwraca",
   "title": "Przy detached HEAD pushOnPush zwraca `null` także wtedy, gdy wołający podał jawny branch.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-10-08T19:39:01.711Z",
   "updatedAt": "2026-10-08T19:39:01.711Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-push-bez-upstream-przy-bledzie-sie",
  "name": "`push()` bez upstream / przy błędzie sieci / non-fast-forward zwraca `{ status: 'error', message }` (best-effort), a sam release/push na remote pozostaje nietknięty.",
  "op": "update",
  "before": {
   "slug": "ac-push-bez-upstream-przy-bledzie-sie",
   "text": "`push()` bez upstream / przy błędzie sieci / non-fast-forward zwraca `{ status: 'error', message }` (best-effort, warning w toaście), a sam release/push pozostaje nietknięty.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "m28-edge"
   ]
  },
  "after": {
   "slug": "ac-push-bez-upstream-przy-bledzie-sie",
   "title": "`push()` bez upstream / przy błędzie sieci / non-fast-forward zwraca `{ status: 'error', message }` (best-effort), a sam release/push na remote pozostaje nietknięty.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-07-13T12:19:46.000Z",
   "updatedAt": "2026-10-08T19:38:53.532Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-w-swiezym-repo-bez-commitow-commitonr-2",
  "name": "W świeżym repo bez commitów commitOnRelease w trybie `new` zwraca status='error' z recovery.kind='base-missing'.",
  "op": "create",
  "after": {
   "slug": "ac-w-swiezym-repo-bez-commitow-commitonr-2",
   "title": "W świeżym repo bez commitów commitOnRelease w trybie `new` zwraca status='error' z recovery.kind='base-missing'.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-10-08T19:39:01.720Z",
   "updatedAt": "2026-10-08T19:39:01.720Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-w-swiezym-repo-bez-commitow-commitonr",
  "name": "W świeżym repo bez commitów commitOnRelease w trybie `named` zwraca status='error' z recovery.kind='branch-missing'.",
  "op": "create",
  "after": {
   "slug": "ac-w-swiezym-repo-bez-commitow-commitonr",
   "title": "W świeżym repo bez commitów commitOnRelease w trybie `named` zwraca status='error' z recovery.kind='branch-missing'.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-10-08T19:39:01.717Z",
   "updatedAt": "2026-10-08T19:39:01.717Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-w-trybie-committarget-named-przy-deta",
  "name": "W trybie commitTarget `named` przy detached HEAD commitOnRelease wykonuje commit na tip docelowej gałęzi.",
  "op": "create",
  "after": {
   "slug": "ac-w-trybie-committarget-named-przy-deta",
   "title": "W trybie commitTarget `named` przy detached HEAD commitOnRelease wykonuje commit na tip docelowej gałęzi.",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-10-08T19:39:01.714Z",
   "updatedAt": "2026-10-08T19:39:01.714Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-w-trybie-config-git-committarget-mode-n",
  "name": "W trybie config.git.commitTarget.mode='named' commitOnRelease commituje delty spec na tip istniejącego brancha przez temp-index (GIT_INDEX_FILE + read-tree <tip> + stage ścieżek spec + write-tree + commit-tree -p <tip> + update-ref), bez dotykania working tree, HEAD ani realnego indeksu.",
  "op": "update",
  "before": {
   "slug": "ac-w-trybie-config-git-committarget-mode-n",
   "text": "W trybie config.git.commitTarget.mode='named' commitForRelease commituje delty spec na tip istniejącego brancha przez temp-index (GIT_INDEX_FILE + read-tree <tip> + stage ścieżek spec + write-tree + commit-tree -p <tip> + update-ref), bez dotykania working tree, HEAD ani realnego indeksu.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "type": "endpoint",
     "slug": "get-api-git-status"
    }
   ],
   "description": null,
   "tags": [
    "git-enabled",
    "m28"
   ]
  },
  "after": {
   "slug": "ac-w-trybie-config-git-committarget-mode-n",
   "title": "W trybie config.git.commitTarget.mode='named' commitOnRelease commituje delty spec na tip istniejącego brancha przez temp-index (GIT_INDEX_FILE + read-tree <tip> + stage ścieżek spec + write-tree + commit-tree -p <tip> + update-ref), bez dotykania working tree, HEAD ani realnego indeksu.",
   "kind": "requirement",
   "status": "active",
   "verifies": [
    {
     "slug": "get-api-git-status",
     "type": "endpoint"
    }
   ],
   "tags": [
    "git-enabled",
    "m28"
   ],
   "createdAt": "2026-07-14T09:41:42.000Z",
   "updatedAt": "2026-10-08T19:38:53.619Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-w-trybie-named-new-gdy-tree-po-stage-je",
  "name": "W trybie named/new, gdy tree po stage jest tożsame z tree tipa celu, commitOnRelease zwraca nothing-to-commit (bez pustego commita).",
  "op": "update",
  "before": {
   "slug": "ac-w-trybie-named-new-gdy-tree-po-stage-je",
   "text": "W trybie named/new, gdy tree po stage jest tożsame z tree tipa celu, commitForRelease zwraca nothing-to-commit (bez pustego commita).",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "m28-edge"
   ]
  },
  "after": {
   "slug": "ac-w-trybie-named-new-gdy-tree-po-stage-je",
   "title": "W trybie named/new, gdy tree po stage jest tożsame z tree tipa celu, commitOnRelease zwraca nothing-to-commit (bez pustego commita).",
   "kind": "edge-case",
   "status": "active",
   "verifies": [],
   "tags": [
    "m28-edge"
   ],
   "createdAt": "2026-07-14T09:41:42.000Z",
   "updatedAt": "2026-10-08T19:38:53.621Z"
  }
 },
 {
  "type": "ac",
  "slug": "ac-w-trybie-new-commitforrelease-tworzy-n",
  "name": "W trybie 'new' commitOnRelease tworzy nowy branch release'u od tipa base (commitTarget.base lub prywatne resolveDefaultBranch()) przez commit-tree -p <base-tip> + update-ref refs/heads/<nazwa>, gdzie nazwa pochodzi z wyrenderowanego template.",
  "op": "update",
  "before": {
   "slug": "ac-w-trybie-new-commitforrelease-tworzy-n",
   "text": "W trybie 'new' commitForRelease tworzy nowy branch release'u od tipa base (commitTarget.base lub resolveDefaultBranch()) przez commit-tree -p <base-tip> + update-ref refs/heads/<nazwa>, gdzie nazwa pochodzi z wyrenderowanego template.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "description": null,
   "tags": [
    "git-enabled",
    "m28"
   ]
  },
  "after": {
   "slug": "ac-w-trybie-new-commitforrelease-tworzy-n",
   "title": "W trybie 'new' commitOnRelease tworzy nowy branch release'u od tipa base (commitTarget.base lub prywatne resolveDefaultBranch()) przez commit-tree -p <base-tip> + update-ref refs/heads/<nazwa>, gdzie nazwa pochodzi z wyrenderowanego template.",
   "kind": "requirement",
   "status": "active",
   "verifies": [],
   "tags": [
    "git-enabled",
    "m28"
   ],
   "createdAt": "2026-07-14T09:41:42.000Z",
   "updatedAt": "2026-10-08T19:38:53.622Z"
  }
 }
]

## Linked entities at 2.1.14 (endpoint, context only)
[
 {
  "type": "endpoint",
  "slug": "get-api-git-status",
  "name": "get-api-git-status",
  "op": "create",
  "after": {
   "slug": "get-api-git-status",
   "method": "GET",
   "path": "/api/git/status",
   "summary": "Runtime status repozytorium git wykrytego w pagesDir (M28).",
   "description": "Zwraca `GitStatusResponse` — wynik `gitService.detect()`. Konsumowany przez M26 sekcja Git: warunkuje render sekcji (`detected`) i wypełnia kartę info o repo (remote, branch, root, badge dirty/clean). Prefix `/api/git/*` to wyjątek konwencji L4 (per-encja prefix), analogicznie do `/api/remote-project/*` M24 i `/api/release-pushes/*` M25. Read-only, bez body. Nigdy nie rzuca na brak repo — zwraca `detected: false`.",
   "linked_dtos": [],
   "tags": [
    "api",
    "m28-git-sync"
   ]
  }
 },
 {
  "type": "endpoint",
  "slug": "patch-api-releases-nameorid",
  "name": "PATCH /api/releases/:name",
  "op": "create",
  "after": {
   "slug": "patch-api-releases-nameorid",
   "title": "PATCH /api/releases/:name",
   "method": "PATCH",
   "path": "/api/releases/:name",
   "summary": "Edycja najnowszego release'a (name?, description?, assignUnreleased?)",
   "description": "Edytuje tylko najnowszy release na osi wydań (najpóźniejszy `created_at`, remis po `id`; implicit-last-mutable, decyzje 13+14). Scope: name, description, opcjonalny pull wiszacych mutacji (assignUnreleased: true → UPDATE entity_version/file_version SET release_id WHERE release_id IS NULL). Atomowa walidacja najnowszego w transakcji. Segment `:name` jest nazwą release'u zakodowaną procentowo, nigdy id. Errors: 404 RELEASE_NOT_FOUND (literał `current`, `initial` albo `null` w segmencie), 409 RELEASE_FROZEN (release nie jest najnowszy), 409 RELEASE_NAME_CONFLICT (rename collision), 400 RELEASE_NAME_RESERVED (rename na `current`, `initial` albo `null`), 400 RELEASE_DESCRIPTION_REQUIRED (pusty description), 400 RELEASE_DESCRIPTION_TOO_LONG (description ponad 500 znaków).",
   "linkedDtos": [
    {
     "dto": "release",
     "relation": "response",
     "statusCode": 200
    },
    {
     "dto": "release-update-request",
     "relation": "request",
     "statusCode": null
    }
   ],
   "tags": [
    "api",
    "m17"
   ],
   "createdAt": "2026-06-19T11:12:08.000Z",
   "updatedAt": "2026-10-06T22:35:15.933Z"
  }
 }
]

## Conventions (L3/L4/L13 at 2.1.14)

### c0
[
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

### c1
[
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

### c2
[
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

### L4_0
[
 {
  "rootId": "pages",
  "path": "layers/L4-api.md",
  "op": "create",
  "sections": [
   {
    "kind": "section",
    "anchor": "lepbk8sv",
    "headingPath": [],
    "heading": "L4 — API",
    "content": "<after_change>\n> Grubość wire'u nad katalogiem operacji: metoda i ścieżka, kody statusu, koperta odpowiedzi, transporty specjalne i wyjątki od konwencji routingu — to, czego z samej operacji wyprowadzić się nie da.\n</after_change>"
   }
  ],
  "xmlRefs": {
   "after": [
    "<element_list type=\"dto\" slugs=\"entity-created-response,entity-updated-response,delete-entity-response,broken-reference\"/>"
   ]
  }
 }
]

### L4_1
[
 {
  "rootId": "pages",
  "path": "layers/L4-api.md",
  "op": "create",
  "sections": [
   {
    "kind": "section",
    "anchor": "4ekrg55r",
    "headingPath": [
     "L4 — API"
    ],
    "heading": "Rola w systemie",
    "content": "<after_change>\nWarstwa jest framework-shaped: jeden implementor podnosi powierzchnię żądań i powierzchnię połączeń trwałych, trzyma rejestr zdarzeń i egzekwuje wspólną kopertę odpowiedzi, a konsumenci wnoszą do niej trasy i deklarują wyłącznie to, czym od konwencji odchodzą. REST jest tu **jedną powierzchnią o dwóch konsumentach** — interfejsem i wołającym programowym — a nie powierzchnią zarezerwowaną dla UI: szerokość rekordu dla obu ustala ten sam parametr `select` operacji rdzenia, nie osobna rodzina tras i nie osobna polityka per powierzchnia.\n\nWarstwa **nie** mówi, co można zrobić — to katalog operacji — ani jak długo żyje obiekt obsługujący żądanie, ani która przestrzeń stron odpowiada pod danym adresem. Fiksuje grubość wire'u i nic ponad to.\n</after_change>"
   }
  ]
 }
]

### L4_2
[
 {
  "rootId": "pages",
  "path": "layers/L4-api.md",
  "op": "create",
  "sections": [
   {
    "kind": "section",
    "anchor": "pondhd6o",
    "headingPath": [
     "L4 — API"
    ],
    "heading": "Module slice schema",
    "content": "<after_change>\n**Każdy moduł dotykający tej warstwy wypełnia swoją sekcję `## API (L4)`:**\n\n```\nPowierzchnia  jeden embed <tagged_list type=\"endpoint\" tags=\"<tag modułu>\" filter=\"and\"/>\n              root pages   → tag `mNN` (sam numer modułu, bez sluga)\n              root plugins → tag `entity-<typ>`\n              bez ręcznych list slugów, bez tabel endpointów pisanych w prozie\nDTO           embed <tagged_list type=\"dto\" tags=\"<ten sam tag>\" filter=\"and\"/>\n              pomijany, gdy moduł nie wnosi własnych DTO — koperty wspólne są w warstwie\nMontowanie    `host` (CRUD generowany z pathPrefix) | `własny router: <prefiks>`\nOdstępstwa    tabela poniżej; brak wierszy = moduł trzyma konwencję warstwy\nTransport     pomijane, gdy wszystko jedzie JSON-em; inaczej wiersz per trasa — w tym\n              zasób serwowany surowymi bajtami z własnym `Content-Type`, bez koperty\n```\n\nTabela odstępstw: `| Trasa | Od czego odstępstwo | Dlaczego |`\n\n**Pola stałe warstwy — moduł ich nie powtarza**, a jeżeli od któregoś odchodzi, wpisuje jego **nazwę** w kolumnę „Od czego odstępstwo\". Nazwy są częścią kontraktu, nie ozdobnikiem: bez nich tabela odstępstw nie ma czego cytować.\n\n| Pole | Treść |\n|---|---|\n| `Koperta` | `{data}` / `{data, total}` / `{error, code}`; moduł opisuje wyłącznie payload |\n| `Kody` | zamknięta lista `200/201/400/404/409/500`; `DELETE` zwraca `200` z ciałem, nie `204` |\n| `Content-Type` | `application/json` w żądaniu i odpowiedzi |\n| `Paginacja` | `limit` + `offset`, domyślnie 50, maks. 200 |\n| `Filtry` | filtr opcjonalny pominięty znaczy „wszystko\"; wartość dosłowna w rodzaju `all` jest błędem walidacji, nie synonimem pominięcia |\n| `Widok` | `view` wybiera projekcję inną niż domyślna trasy; pominięty znaczy projekcję domyślną. Widoki trasy deklaruje opis jej encji `endpoint`; wartość spoza nich oraz parametr należący wyłącznie do widoku jawnego, podany bez niego, to `400` — nie cichy powrót do projekcji domyślnej |\n| `Ścieżki` | `kebab-case`, rzeczowniki w liczbie mnogiej |\n| `Prefiks projektu` | nie jest częścią kontraktu endpointu |\n| `Slug` | zmiana wyłącznie jawna, kolizja to `409` |\n\nKanoniczne koperty zostają w warstwie jako encje, nie jako proza — to zbiór **wspólny**, a DTO własne modułu idą w jego pole `DTO`, nie tutaj:\n\n<element_list type=\"dto\" slugs=\"entity-created-response,entity-updated-response,delete-entity-response,broken-reference\"/>\n\n**Moduł, który warstwy nie dotyka**, pisze nagłówek `## API (L4) — n/d` i jedno zdanie dlaczego. Jeden zapis, bez wariantów.\n\n**Wypełnienie schematu stoi w jednym pliku modułu.** W module trzymanym w jednym pliku — w nim. W module już rozbitym na podstrony — w tej podstronie, która tę warstwę nosi, a plik główny niesie wtedy sam embed `Powierzchnia` i jedno zdanie-wskaźnik, bez powtarzania pozostałych pól. **Nowych podstron ani nowych plików pod ten schemat się nie zakłada:** rozbicie modułu na katalog jest osobną decyzją o kształcie modułu i nie zapada przy wypełnianiu warstwy — także wtedy, gdy wypełnienie wychodzi długie.\n\n**Rejestr zdarzeń powierzchni połączeń trwałych jest jeden i należy do implementora.** Moduł emitujący zdarzenie nie deklaruje go u siebie — schemat nie ma pola na zdarzenia i jest to decyzja, nie przeoczenie: dwa rejestry rozjeżdżają się przy pierwszym dopisanym zdarzeniu.\n\n**Reading mode — implementor:** sekcja tej warstwy w module-implementorze czytana jest w how-mode. Trzyma runtime — proces, port, gateway, adresowanie zdarzeń, egzekwowanie koperty — a nie wypełnienie schematu, bo implementor nie wnosi żadnej trasy własnej.\n\n> **Implementor module:** `M49 — Local Server`\n</after_change>"
   }
  ]
 }
]

### L13_0
[
 {
  "rootId": "pages",
  "path": "layers/L13-page-roots.md",
  "op": "create",
  "sections": [
   {
    "kind": "section",
    "anchor": "l13top001",
    "headingPath": [],
    "heading": "L13 — Korzenie i rodzaje korzeni",
    "content": "<after_change>\n> Konwencja, w której moduł obsługujący pliki specyfikacji albo **wnosi rodzaj korzenia** — dopisuje wartość do enumu rodzajów i deklaruje jej mapę plików, flagi i reakcje L7 — albo deklaruje, **którą flagę lub który rodzaj czyta**, zamiast wskazywać katalog.\n\n</after_change>"
   }
  ],
  "xmlRefs": {
   "after": []
  }
 }
]

### L13_1
[
 {
  "rootId": "pages",
  "path": "layers/L13-page-roots.md",
  "op": "create",
  "sections": [
   {
    "kind": "section",
    "anchor": "l13role01",
    "headingPath": [
     "L13 — Korzenie i rodzaje korzeni"
    ],
    "heading": "Role in the system",
    "content": "<after_change>\nL13 jest warstwą framework-shaped. Implementor:\n\n- trzyma rejestr korzeni — korzenie z konfiguracji oraz korzenie zarejestrowane w kodzie;\n- składa enum rodzajów z deklaracji modułów;\n- rozstrzyga typ pliku z mapy rodzaju;\n- egzekwuje flagi w jednym miejscu;\n- montuje źródło zdarzeń każdego korzenia, podpina do niego reakcje L7 wybrane przez rodzaj, waliduje ich wymagania i dokłada reakcję bazową o zmianie pliku.\n\nWarstwa nie definiuje transportu, routingu, wersjonowania ani indeksowania. Ustala wyłącznie kontrakt: **każde zachowanie per plik jest bramkowane flagą albo rodzajem korzenia, nigdy katalogiem ani identyfikatorem**.\n\n</after_change>"
   }
  ]
 }
]

### L13_2
[
 {
  "rootId": "pages",
  "path": "layers/L13-page-roots.md",
  "op": "create",
  "sections": [
   {
    "kind": "section",
    "anchor": "l13slice0",
    "headingPath": [
     "L13 — Korzenie i rodzaje korzeni"
    ],
    "heading": "Module slice schema",
    "content": "<after_change>\nSekcja `## Korzenie i rodzaje korzeni (L13)` modułu odpowiada na poniższe pola. Wariant `## Korzenie i rodzaje korzeni (L13) — n/d` zachowuje sufiks. Każde pole to deklaracja „jaki rodzaj korzenia wnoszę” albo „którą flagę lub który rodzaj czytam”, nie opis funkcjonalny modułu.\n\n```\nDeklaracja rodzaju korzenia — wypełnia WYŁĄCZNIE moduł wnoszący rodzaj; jeden blok na rodzaj:\n  kind         — nowa wartość enumu rodzajów (kebab, liczba mnoga), unikalna w enumie.\n                 Rodzaj o jednym korzeniu: kind = id korzenia, identyfikator zastrzeżony.\n  źródło       — konfiguracja (N korzeni użytkownika: id, name, dir, builtin)\n                 | kod (dokładnie jeden korzeń)\n  dir          — dla źródła „kod”: stały `.claude4spec/<kind>`, poza plikiem konfiguracji\n  sidebar      — hidden | accordion | reduktor. Reduktor podaje glob wejścia i regułę\n                 wyliczenia akordeonów; kontrakt w akapicie „Pole sidebar” pod blokiem.\n  mapa plików  — uporządkowana lista: wzorzec → format (markdown | json | surowy),\n                 kontrakt zmian (markdown: pola nagłówka niezmienne / zmienne;\n                 json: schemat rekordu albo odesłanie do jego źródła),\n                 tor wersji (file_version | entity_version | HEAD | brak).\n                 Wygrywa pierwszy pasujący wzorzec.\n  flagi        — cztery wiersze: release / references / gitignore / agentDirectFs → tak | nie.\n                 Stałe dla rodzaju, nie ma ich w konfiguracji. Polityki czytane na żądanie;\n                 żadna nie bramkuje reakcji.\n  reakcje      — lista stabilnych identyfikatorów reakcji L7, które biegną na plikach\n                 korzeni rodzaju. Każda przyjmuje format co najmniej jednego wpisu mapy,\n                 a jej wymagania (inne reakcje, flagi) są spełnione w tej samej deklaracji.\n                 Reakcji bazowej się nie wymienia.\n\nKeyed flag         — którą flagę (release / references / gitignore / agentDirectFs), który\n                     rodzaj (kind) albo które źródło rodzaju (konfiguracja | kod) czyta\n                     konsument. Wymienić konkretną.\nRoot iteration     — „korzenie rodzaju K”, „korzenie rodzajów ze źródłem Z”\n                     (Z = konfiguracja | kod), „korzenie rodzajów z flagą F” albo „korzenie\n                     rodzajów, które wybrały reakcję R”.\n                     NIGDY samo „pages”, katalog, lista katalogów ani wyliczenie\n                     identyfikatorów korzeni ze źródłem kod.\nGated behavior     — co flaga albo rodzaj włącza lub wyłącza per plik albo per katalog korzenia;\n                     obserwowalny efekt, nie flaga.\nKey shape          — gdy moduł keyuje stan per plik: klucz niesie rootId, np. (rootId, path).\nNo-hardcode assert — jedno zdanie: moduł nie czyta katalogu z klucza konfiguracji, nie trzyma\n                     listy katalogów, nie rozpoznaje korzenia podstawowego po id (tylko builtin)\n                     ani korzenia jednokorzeniowego rodzaju po id (tylko kind). Obowiązkowe.\n```\n\n**Słownik flag** — po jednym zdaniu na flagę:\n\n- `release` — plik wchodzi do wydania swoim torem wersji.\n- `references` — plik należy do grafu referencji do encji i sekcji: jest walidowany, przeszukiwany i przepisywany przy zmianie nazwy. Działa wyłącznie na wpisach w formacie markdown.\n- `gitignore` — przy wyłączonej synchronizacji git katalog korzenia trafia do zarządzanego bloku ignorowanych.\n- `agentDirectFs` — wartość `nie` wyłącza katalog korzenia z bezpośredniego dostępu plikowego agenta.\n\n**Reguły stosowania.** `references` dotyczy wyłącznie wpisów mapy w formacie markdown. `release` dotyczy wyłącznie wpisów z torem wersji innym niż `brak`. Reakcja wybrana przez rodzaj działa wyłącznie na wpisach mapy w formatach, które przyjmuje, a jej kontrakt przyjęcia stoi w jej wierszu warstwy L7.\n\n**Pole `sidebar`.** Wartość mówi, jak korzeń rodzaju wchodzi do drzewa stron w sidebarze. Postacią ogólną jest reduktor: reguła, która z zawartości korzenia wylicza uporządkowaną tablicę akordeonów. `hidden` i `accordion` to jej przypadki szczególne i nie deklarują reguły.\n\n- **Wejście:** ścieżki wszystkich plików korzenia oraz sparsowany frontmatter plików pasujących do globu, który deklaruje reduktor. Treść plików nie wchodzi do wejścia.\n- **Wynik:** uporządkowana tablica elementów `{ key, label, path }`:\n  - `key` — stabilny identyfikator akordeonu; trzyma stan rozwinięcia w UI;\n  - `label` — etykieta akordeonu;\n  - `path` — poddrzewo w korzeniu; `''` oznacza cały korzeń;\n  - kolejność tablicy jest kolejnością akordeonów w sidebarze.\n- **Przypadki szczególne:** `hidden` daje pustą tablicę, a `accordion` jeden element `{ key: id korzenia, label: name korzenia, path: '' }`.\n- **Reguły wyniku:**\n  - `path` leży w obrębie korzenia, `key` jest unikalny w tablicy, a poddrzewa są rozłączne;\n  - element łamiący regułę jest pomijany z ostrzeżeniem;\n  - plik poza wszystkimi poddrzewami nie ma miejsca w sidebarze, ale nadal należy do korzenia: ma swój tor wersji i podlega flagom rodzaju.\n- **Wymagania wypełniania:**\n  - właściciel rodzaju z reduktorem podaje w bloku deklaracji glob wejścia oraz regułę wyliczenia `key`, `label`, `path` i kolejności;\n  - reguła wylicza wynik wyłącznie z wejścia;\n  - ikona, opis i znaczniki akordeonu nie są polami wyniku.\n\n**Obowiązkowość pól:**\n\n- Moduł wnoszący rodzaj wypełnia `Deklaracja rodzaju korzenia`, w tym `reakcje`, oraz `No-hardcode assert`.\n- Konsument wypełnia `Keyed flag`, `Root iteration` i `No-hardcode assert`. `Key shape` jest wymagany tylko przy stanie kluczowanym per plik.\n- Moduł bywa jednocześnie właścicielem rodzaju i konsumentem cudzego.\n- Moduł, którego reakcję wybiera rodzaj, nie staje się przez to konsumentem L13: jego wiersz L7 niesie kontrakt przyjęcia. Konsumentem jest, jeśli czyta flagę albo iteruje korzenie.\n- Moduł, który nie spełnia żadnego z powyższych, ma `— n/d` z jednym zdaniem.\n- Moduł, który tylko przenosi klucz `(rootId, path)` nadany gdzie indziej, sekcji nie ma; jego tekst nazywa wtedy klucz, nie warstwę.\n\n**Wymagania wypełniania:** konsument nie przepisuje wartości flag ani mapy plików cudzego rodzaju — odsyła do deklaracji rodzaju u jej właściciela.\n\n**Reading mode — implementor.** Sekcja tej warstwy w module-implementorze jest czytana w how-mode, nie jako wypełnienie schematu. Opisuje:\n\n- rejestr korzeni z dwoma źródłami;\n- enum rodzajów jako sumę deklaracji;\n- rozstrzyganie typu pliku z mapy;\n- egzekwowanie flag z regułami stosowania;\n- montaż źródeł, wiązanie reakcji z deklaracji, walidację wymagań i reakcję bazową o zmianie pliku;\n- walidację nakładania się przestrzeni nazw;\n- wywołanie reduktorów `sidebar`, przeliczanie ich wyniku, fallback i dostarczenie tablicy akordeonów do UI.\n\n> **Implementor module:** `M02 — Pages (Root Registry)`\n</after_change>"
   }
  ]
 }
]

## Stubs
None to close, none open (stubs.json empty).
## Jobs
None.
## Not yet
None.
## Completes
None.
## Remove
Per goal/change sections: old commit-release method name, the `Release ` message prefix, public resolveDefaultBranch (becomes private). See change sections (lone <before_change> content).
