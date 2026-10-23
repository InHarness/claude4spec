# Packet m25-unreleased-banner/p1-l2-l5

- window: 2.1.44 → 2.1.45 (delta)
- unit: m25-unreleased-banner
- goal: see state.json unit goal (M25 banner over the list and on the newest card, N from the shared counter, hidden on older releases, gone after a pull; clickable M25 counter removed)
- layers: L2, L5
- entities: 1 module-dependency (context), 4 ac
- criteria: 4
- jobs: none
- size: 39755 bytes (body)

**Not yet**: none. **Completes**: none. **Remove**: the clickable M25 counter with the Compare deep link (goal).

## change: pages/modules/m25-release-push/m25-release-push.md (all)
{
  "from": {
    "id": 32098,
    "name": "2.1.44"
  },
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 2
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m25-release-push/m25-release-push.md",
      "op": "update",
      "sections": [
        {
          "kind": "section",
          "anchor": "49dzhz9l",
          "headingPath": [
            "M25 — Release Push",
            "Domain (L2)"
          ],
          "heading": "Stan pusha widoczny dla użytkownika",
          "content": "\n- **Przycisk pusha jest aktywny tylko przy aktywnej sesji konta zdalnego.** Wyłączają go dwa powody: brak sesji i konto dezaktywowane — te same bramki, które zatrzymują push w kroku 1 algorytmu (<section_ref anchor=\"wosnh845\"/>).\n- **Pierwszy push wymaga potwierdzenia**, bo zakłada projekt zdalny; kolejne idą jednym kliknięciem.\n- **Licznik pushy release'u liczy wyłącznie udane.** Push zdeduplikowany się wlicza — dla użytkownika release jest na remote; push zakończony błędem się nie wlicza.\n<before_change>- **Baner niezreleasowanych zmian pokazuje się tylko na najnowszym release'ie z niepustą kolejką zmian bez release'u.** Starsze release'y są zamrożone, więc baner na nich jest pomijany.</before_change>\n<after_change>- **Baner niezreleasowanych zmian stoi nad listą release'ów i na karcie najnowszego release'u; na kartach starszych release'ów jest pomijany.** Starsze release'y są zamrożone — pull jest na nich niedostępny, więc ostrzeżenie, że zmiany nie wejdą do pusha, nie miałoby czego proponować. Liczbę banera daje licznik niezreleasowanych zmian (<section_ref anchor=\"zbc9jdnr\"/>).</after_change>\n- **Lista pushy jest pobierana raz na render listy release'ów i agregowana po stronie klienta**, bez osobnego zapytania na każdy release. M17 nie niesie liczby pushy: M17 posiada tożsamość release'u, ten moduł — audyt pushy."
        },
        {
          "kind": "section",
          "anchor": "cqhywf9z",
          "headingPath": [
            "M25 — Release Push"
          ],
          "heading": "UI (L5)",
          "content": "\n**Wkład w cudze ekrany**\n\n| Ekran | Co moduł wnosi | Warunek widoczności |\n|---|---|---|\n| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | przycisk „Push to remote” w obszarze akcji karty; w trakcie pusha spinner i przycisk nieaktywny; tooltipy wyłączenia: „Log in to push to the remote server.”, „Account deactivated — push disabled. Contact your administrator.” | zawsze; nieaktywny wg <section_ref anchor=\"49dzhz9l\"/> |\n| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | badge „Pushed” / „Pushed N×” obok nazwy release'u | co najmniej jeden udany push release'u |\n<before_change>| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | baner „You have N unreleased changes — they will NOT be included in this push. Pull them into this release or create a new one.” | najnowszy release i niepusta kolejka niezreleasowanych zmian |</before_change>\n<after_change>| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | baner „You have N unreleased changes — they will NOT be included in this push. Pull them into this release or create a new one.”; N to licznik niezreleasowanych zmian (<section_ref anchor=\"zbc9jdnr\"/>) | najnowszy release i N większe od 0 |</after_change>\n| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | sekcja „Pushes”: wiersz na push — czas, status, numer release'u zdalnego, znacznik deduplikacji, konto, opcjonalny link do release'u zdalnego | zawsze |\n| <inline_mention type=\"ui-view\" slug=\"releases-list\"/> | badge „Pushed” / „Pushed N×” na karcie release'u | co najmniej jeden udany push release'u |\n<before_change>| <inline_mention type=\"ui-view\" slug=\"releases-list\"/> | licznik niezreleasowanych zmian, klikalny: prowadzi do zakładki Compare z porównaniem najnowszego release'u do stanu bieżącego; liczba pochodzi z dotychczasowego źródła licznika, wartość szczegółową wylicza Compare <todo comment=\"parametry deep linku do zakładki Compare (zakładka, release) nie są zapisane — ustalić\"/> | <todo comment=\"warunek widoczności licznika niezreleasowanych zmian na liście release'ów nie jest zapisany — ustalić\"/> |</before_change>\n<after_change>| <inline_mention type=\"ui-view\" slug=\"releases-list\"/> | baner niezreleasowanych zmian nad listą release'ów, ten sam co na karcie najnowszego release'u; N to licznik niezreleasowanych zmian (<section_ref anchor=\"zbc9jdnr\"/>) | istnieje co najmniej jeden release i N większe od 0 |</after_change>\n\n**Stan**\n\n*Zapytania:* `[\"release-pushes\", {}]` — lista pushy bez filtra release'u, agregowana po stronie klienta; inwalidowana szerokim prefiksem po udanym pushu (lista release'ów i sekcja „Pushes” karty). `[\"remote-project\"]` — karta Remote project; inwalidowany szerokim prefiksem po odłączeniu projektu zdalnego (Disconnect), po udanym pushu, po zalogowaniu i wylogowaniu konta zdalnego oraz po udanej edycji projektu zdalnego.\n\n**Okna**\n\n`release-push` — modal (fasada `Modal`) potwierdzenia pierwszego pusha; payload `{ releaseName }`; tytuł „Create remote project '<config.name>'”, treść „This is your first push. A new project will be created on the remote server with this name. Subsequent pushes will go to the same project.”, akcja „Create and push”.\n\nPrzez fasadę `ConfirmModal` (`confirmDestructive`):\n\n| `kind` | Payload i pola | Treść |\n|---|---|---|\n| `remote-project-disconnect` | nazwa projektu zdalnego; wariant dla właściciela i dla nie-właściciela | właściciel: `Disconnect remote project <name>? The next push will create a new remote project with the current config.name.`; nie-właściciel: `Disconnect remote project <name>? This clears remoteProjectId in the local config.json. The next push will create a new remote project.`; oba + `[Cancel]` / `[Disconnect]` |\n\nToasty (bez `kind`):\n\n| Wyzwalacz | `variant` | Treść |\n|---|---|---|\n| udany push nowego release'u | `success` | „Pushed as release #<sequence>” |\n| push zdeduplikowany | `success` | „Already pushed as release #<sequence>” |\n| wygasła sesja | `error` | „Session expired, log in and try again.” |\n| inny błąd pusha | `error` | „Push failed: <error_message>. Try again.” |\n| paczka za duża (`413`) | `error` | „Bundle too large (limit on remote). Reduce content or contact administrator.” |\n| zapis karty Remote project | `success` | „Remote project updated” |\n| edycja projektu zdalnego odrzucona kodem `NOT_OWNER` | `error` | „You are not the owner of this project” |"
        }
      ],
      "xmlRefs": {
        "before": [
          "<inline_mention type=\"spec-operation\" slug=\"push-release\"/>",
          "<section_ref anchor=\"m17trtr01\"/>",
          "<inline_mention type=\"spec-operation\" slug=\"push-release\"/>",
          "<section_ref anchor=\"cqhywf9z\"/>",
          "<tagged_list type=\"module-dependency\" tags=\"m25\"/>",
          "<section_ref anchor=\"d59egewb\"/>",
          "<inline_mention type=\"database-table\" slug=\"release-push\"/>",
          "<section_ref anchor=\"m987ldel\"/>",
          "<tagged_list type=\"database-table\" tags=\"m25\"/>",
          "<section_ref anchor=\"en944ao9\"/>",
          "<section_ref anchor=\"mbjdcls0\"/>",
          "<section_ref anchor=\"xuwev82c\"/>",
          "<inline_mention type=\"dto\" slug=\"release-push-response\"/>",
          "<section_ref anchor=\"u5vl07ch\"/>",
          "<section_ref anchor=\"cqhywf9z\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<section_ref anchor=\"cqhywf9z\"/>",
          "<section_ref anchor=\"wosnh845\"/>",
          "<section_ref anchor=\"l3admit0\"/>",
          "<tagged_list type=\"spec-operation\" tags=\"m25\"/>",
          "<inline_mention type=\"spec-operation\" slug=\"push-release\"/>",
          "<section_ref anchor=\"l3media0\"/>",
          "<inline_mention type=\"endpoint\" slug=\"post-api-release-pushes\"/>",
          "<section_ref anchor=\"k4cq1mtn\"/>",
          "<tagged_list type=\"endpoint\" tags=\"m25\" filter=\"and\"/>",
          "<section_ref anchor=\"k4cq1mtn\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<section_ref anchor=\"49dzhz9l\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<inline_mention type=\"ui-view\" slug=\"releases-list\"/>",
          "<inline_mention type=\"ui-view\" slug=\"releases-list\"/>",
          "<todo comment=\"parametry deep linku do zakładki Compare (zakładka, release) nie są zapisane — ustalić\"/>",
          "<todo comment=\"warunek widoczności licznika niezreleasowanych zmian na liście release'ów nie jest zapisany — ustalić\"/>",
          "<inline_mention type=\"endpoint\" slug=\"get-api-remote-project\"/>",
          "<inline_mention type=\"endpoint\" slug=\"patch-api-remote-project\"/>",
          "<tagged_list type=\"ac\" tags=\"m25-edge\"/>",
          "<inline_mention type=\"database-table\" slug=\"release-push\"/>",
          "<section_ref anchor=\"m31ctx001\"/>",
          "<section_ref anchor=\"ic73uiw3\"/>",
          "<section_ref anchor=\"wosnh845\"/>",
          "<inline_mention type=\"endpoint\" slug=\"get-api-remote-project\"/>",
          "<inline_mention type=\"dto\" slug=\"remote-project-info\"/>",
          "<todo comment=\"Link w pustym stanie: dotychczasowy opis zapowiadał odnośnik „do dokumentacji modułu (sekcja Cel) lub do /releases” bez rozstrzygnięcia. Ustalić cel linku albo go usunąć.\"/>",
          "<inline_mention type=\"endpoint\" slug=\"patch-api-remote-project\"/>",
          "<inline_mention type=\"endpoint\" slug=\"patch-api-config\"/>",
          "<section_ref anchor=\"wosnh845\"/>",
          "<tagged_list type=\"ac\" tags=\"m25\"/>"
        ],
        "after": [
          "<inline_mention type=\"spec-operation\" slug=\"push-release\"/>",
          "<section_ref anchor=\"m17trtr01\"/>",
          "<inline_mention type=\"spec-operation\" slug=\"push-release\"/>",
          "<section_ref anchor=\"cqhywf9z\"/>",
          "<tagged_list type=\"module-dependency\" tags=\"m25\"/>",
          "<section_ref anchor=\"d59egewb\"/>",
          "<inline_mention type=\"database-table\" slug=\"release-push\"/>",
          "<section_ref anchor=\"m987ldel\"/>",
          "<tagged_list type=\"database-table\" tags=\"m25\"/>",
          "<section_ref anchor=\"en944ao9\"/>",
          "<section_ref anchor=\"mbjdcls0\"/>",
          "<section_ref anchor=\"xuwev82c\"/>",
          "<inline_mention type=\"dto\" slug=\"release-push-response\"/>",
          "<section_ref anchor=\"u5vl07ch\"/>",
          "<section_ref anchor=\"cqhywf9z\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<section_ref anchor=\"cqhywf9z\"/>",
          "<section_ref anchor=\"wosnh845\"/>",
          "<section_ref anchor=\"zbc9jdnr\"/>",
          "<section_ref anchor=\"l3admit0\"/>",
          "<tagged_list type=\"spec-operation\" tags=\"m25\"/>",
          "<inline_mention type=\"spec-operation\" slug=\"push-release\"/>",
          "<section_ref anchor=\"l3media0\"/>",
          "<inline_mention type=\"endpoint\" slug=\"post-api-release-pushes\"/>",
          "<section_ref anchor=\"k4cq1mtn\"/>",
          "<tagged_list type=\"endpoint\" tags=\"m25\" filter=\"and\"/>",
          "<section_ref anchor=\"k4cq1mtn\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<section_ref anchor=\"49dzhz9l\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<section_ref anchor=\"zbc9jdnr\"/>",
          "<inline_mention type=\"ui-view\" slug=\"release-detail\"/>",
          "<inline_mention type=\"ui-view\" slug=\"releases-list\"/>",
          "<inline_mention type=\"ui-view\" slug=\"releases-list\"/>",
          "<section_ref anchor=\"zbc9jdnr\"/>",
          "<inline_mention type=\"endpoint\" slug=\"get-api-remote-project\"/>",
          "<inline_mention type=\"endpoint\" slug=\"patch-api-remote-project\"/>",
          "<tagged_list type=\"ac\" tags=\"m25-edge\"/>",
          "<inline_mention type=\"database-table\" slug=\"release-push\"/>",
          "<section_ref anchor=\"m31ctx001\"/>",
          "<section_ref anchor=\"ic73uiw3\"/>",
          "<section_ref anchor=\"wosnh845\"/>",
          "<inline_mention type=\"endpoint\" slug=\"get-api-remote-project\"/>",
          "<inline_mention type=\"dto\" slug=\"remote-project-info\"/>",
          "<todo comment=\"Link w pustym stanie: dotychczasowy opis zapowiadał odnośnik „do dokumentacji modułu (sekcja Cel) lub do /releases” bez rozstrzygnięcia. Ustalić cel linku albo go usunąć.\"/>",
          "<inline_mention type=\"endpoint\" slug=\"patch-api-remote-project\"/>",
          "<inline_mention type=\"endpoint\" slug=\"patch-api-config\"/>",
          "<section_ref anchor=\"wosnh845\"/>",
          "<tagged_list type=\"ac\" tags=\"m25\"/>"
        ]
      }
    }
  ]
}
## context pages/modules/m25-release-push/m25-release-push.md offset 1 limit 1
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 23
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m25-release-push/m25-release-push.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "fl8fm071",
          "headingPath": [
            "M25 — Release Push"
          ],
          "heading": "Cel",
          "content": "<after_change>\nAutor specyfikacji, który zamknął wydanie lokalnie, chce udostępnić je na zewnątrz — tak, by odbiorca mógł je pobrać, a on sam wiedział, co i kiedy wysłał. Ten moduł dostarcza tę akcję: bierze gotową paczkę ze stanem wydania, przenosi ją jednym żądaniem na zdalny serwer i zapisuje lokalnie ślad tej operacji — co poszło, w której kolejności, z jakim skutkiem i pod jaką zdalną tożsamością projektu.\n\nWysyłane jest wydanie odtworzone z historii wersji, nie bieżąca zawartość dysku, więc wypchnięcie starszego wydania daje jego stan, a nie stan dzisiejszy. Przy pierwszym wysłaniu projekt zakłada się po stronie zdalnej, a jego identyfikator zostaje zapamiętany w konfiguracji, żeby kolejne wysyłki trafiały w to samo miejsce.\n\nNie buduje paczki, nie zarządza tożsamością użytkownika i nie opisuje zdalnego serwera — jest wyłącznie transportem i audytem tej jednej akcji, wyzwalanej przez człowieka.\n</after_change>"
        }
      ]
    }
  ]
}
## context pages/modules/m25-release-push/m25-release-push.md offset 4 limit 1
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 23
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m25-release-push/m25-release-push.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "y63ffv9h",
          "headingPath": [
            "M25 — Release Push"
          ],
          "heading": "Zależności",
          "content": "<after_change>\nTen moduł wysyła gotowe wydanie do usługi zewnętrznej i nie ma własnej strony — paczkę, uwierzytelnienie, transport i powierzchnię, na której się pokazuje, bierze z zewnątrz.\n\n<tagged_list type=\"module-dependency\" tags=\"m25\"/>\n</after_change>"
        }
      ]
    }
  ]
}
## context pages/modules/m25-release-push/m25-release-push.md offset 7 limit 1
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 23
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m25-release-push/m25-release-push.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "ik6al1p3",
          "headingPath": [
            "M25 — Release Push"
          ],
          "heading": "Domain (L2)",
          "content": "<after_change>\n`releasePushService` — orkiestracja push flow. Stabilny kontrakt:\n\n```typescript\ninterface ReleasePushService {\n  // Synchroniczny push lokalnego release'u. Throws przy gate failures\n  // (NOT_CONNECTED, ACCOUNT_NOT_ACTIVE) lub po HTTP error (PUSH_FAILED,\n  // SESSION_EXPIRED). Cleanup tarGzPath w `finally` zawsze.\n  push(releaseName: string): Promise<ReleasePushResponse>;\n\n  // Listing pushy dla pojedynczego release'u (sekcja \"Pushes\" na karcie release detail).\n  listForRelease(releaseName: string): ReleasePush[];\n\n  // Listing globalny — konsumowany przez listę `/releases` do derywacji\n  // badge'a „Pushed\" / „Pushed N×\". Klient woła raz per render i agreguje\n  // client-side na `Map<releaseId, successCount>`, zamiast N×`?releaseName=X`.\n  listAll(): ReleasePush[];\n\n  // Single entry detail.\n  get(id: number): ReleasePush;\n}\n```\n\n**Wewnętrzne zależności (intra-process calls):**\n\n- `releaseService.buildBundleArchive(releaseId)` — M17 (jedyne źródło bundle bytes; M25 NIE ma własnego `bundleService`). Specyfikacja bundle'a (layout tar.gz, manifest, sanityzacja `config.json`, SHA-256, `bundleSchemaVersion`, rekonstrukcja z version tables zamiast z dysku) żyje **w całości w M17** (`<section_ref anchor=\"m17bnd001\"/>`, zamknięte 2026-05-26); M25 czyta i konsumuje ten kontrakt (`tarGzPath`→body, `sizeBytes`→`Content-Length`, `sha256`→`X-Content-SHA256`, cleanup `tarGzPath` w `finally`). Dzięki temu M27 (Project Clone) czyta JEDEN kontrakt (M17) dla read direction, nie M25 + reverse-engineering.\n- `releaseService.getRelease(releaseId)` — M17 (walidacja istnienia release'u).\n- `remoteAuthService.getCurrentAccount()` — M24 (gate przed pushem).\n- `remoteHttpClient` — M24 (transport z bearer token injection + 401 error mapping; `<section_ref anchor=\"ux690pt2\"/>`).\n- `readConfig(cwd)` + `writeConfig(cwd, { remoteProjectId })` — M01 (funkcyjny `src/server/config.ts`: `readConfig`/`writeConfig`/`loadOrCreateConfig`; NIE klasa `ConfigService`). `writeConfig` waliduje pole-po-polu i rzuca na nieznanym / źle otypowanym polu → `partial` budowany warunkowo.\n</after_change>"
        }
      ]
    }
  ]
}
## context pages/modules/m25-release-push/m25-release-push.md offset 10 limit 2
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 23
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m25-release-push/m25-release-push.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "tg42w0cm",
          "headingPath": [
            "M25 — Release Push",
            "Domain (L2)"
          ],
          "heading": "Granica z obszarem akcji karty release'u",
          "content": "<after_change>\nPrzycisk „Push to remote\" jest wpisem tego modułu w obszarze akcji <inline_mention type=\"ui-view\" slug=\"release-detail\"/> (wkład: <section_ref anchor=\"cqhywf9z\"/>), a nie trasą tego modułu: ekran gospodarza rozstrzyga, gdzie renderuje obszar akcji, natomiast obsługa żądania, które ten przycisk wysyła, żyje tutaj. Rozdzielenie jest celowe — dołożenie akcji do karty release'u nie wymaga wtedy dotykania transportu, a zmiana transportu nie przechodzi przez ekran gospodarza.\n</after_change>"
        },
        {
          "kind": "section",
          "anchor": "49dzhz9l",
          "headingPath": [
            "M25 — Release Push",
            "Domain (L2)"
          ],
          "heading": "Stan pusha widoczny dla użytkownika",
          "content": "<after_change>\n- **Przycisk pusha jest aktywny tylko przy aktywnej sesji konta zdalnego.** Wyłączają go dwa powody: brak sesji i konto dezaktywowane — te same bramki, które zatrzymują push w kroku 1 algorytmu (<section_ref anchor=\"wosnh845\"/>).\n- **Pierwszy push wymaga potwierdzenia**, bo zakłada projekt zdalny; kolejne idą jednym kliknięciem.\n- **Licznik pushy release'u liczy wyłącznie udane.** Push zdeduplikowany się wlicza — dla użytkownika release jest na remote; push zakończony błędem się nie wlicza.\n- **Baner niezreleasowanych zmian stoi nad listą release'ów i na karcie najnowszego release'u; na kartach starszych release'ów jest pomijany.** Starsze release'y są zamrożone — pull jest na nich niedostępny, więc ostrzeżenie, że zmiany nie wejdą do pusha, nie miałoby czego proponować. Liczbę banera daje licznik niezreleasowanych zmian (<section_ref anchor=\"zbc9jdnr\"/>).\n- **Lista pushy jest pobierana raz na render listy release'ów i agregowana po stronie klienta**, bez osobnego zapytania na każdy release. M17 nie niesie liczby pushy: M17 posiada tożsamość release'u, ten moduł — audyt pushy.\n</after_change>"
        }
      ]
    }
  ]
}
## context pages/modules/m25-release-push/m25-release-push.md offset 14 limit 1
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 23
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "modules/m25-release-push/m25-release-push.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "cqhywf9z",
          "headingPath": [
            "M25 — Release Push"
          ],
          "heading": "UI (L5)",
          "content": "<after_change>\n**Wkład w cudze ekrany**\n\n| Ekran | Co moduł wnosi | Warunek widoczności |\n|---|---|---|\n| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | przycisk „Push to remote” w obszarze akcji karty; w trakcie pusha spinner i przycisk nieaktywny; tooltipy wyłączenia: „Log in to push to the remote server.”, „Account deactivated — push disabled. Contact your administrator.” | zawsze; nieaktywny wg <section_ref anchor=\"49dzhz9l\"/> |\n| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | badge „Pushed” / „Pushed N×” obok nazwy release'u | co najmniej jeden udany push release'u |\n| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | baner „You have N unreleased changes — they will NOT be included in this push. Pull them into this release or create a new one.”; N to licznik niezreleasowanych zmian (<section_ref anchor=\"zbc9jdnr\"/>) | najnowszy release i N większe od 0 |\n| <inline_mention type=\"ui-view\" slug=\"release-detail\"/> | sekcja „Pushes”: wiersz na push — czas, status, numer release'u zdalnego, znacznik deduplikacji, konto, opcjonalny link do release'u zdalnego | zawsze |\n| <inline_mention type=\"ui-view\" slug=\"releases-list\"/> | badge „Pushed” / „Pushed N×” na karcie release'u | co najmniej jeden udany push release'u |\n| <inline_mention type=\"ui-view\" slug=\"releases-list\"/> | baner niezreleasowanych zmian nad listą release'ów, ten sam co na karcie najnowszego release'u; N to licznik niezreleasowanych zmian (<section_ref anchor=\"zbc9jdnr\"/>) | istnieje co najmniej jeden release i N większe od 0 |\n\n**Stan**\n\n*Zapytania:* `[\"release-pushes\", {}]` — lista pushy bez filtra release'u, agregowana po stronie klienta; inwalidowana szerokim prefiksem po udanym pushu (lista release'ów i sekcja „Pushes” karty). `[\"remote-project\"]` — karta Remote project; inwalidowany szerokim prefiksem po odłączeniu projektu zdalnego (Disconnect), po udanym pushu, po zalogowaniu i wylogowaniu konta zdalnego oraz po udanej edycji projektu zdalnego.\n\n**Okna**\n\n`release-push` — modal (fasada `Modal`) potwierdzenia pierwszego pusha; payload `{ releaseName }`; tytuł „Create remote project '<config.name>'”, treść „This is your first push. A new project will be created on the remote server with this name. Subsequent pushes will go to the same project.”, akcja „Create and push”.\n\nPrzez fasadę `ConfirmModal` (`confirmDestructive`):\n\n| `kind` | Payload i pola | Treść |\n|---|---|---|\n| `remote-project-disconnect` | nazwa projektu zdalnego; wariant dla właściciela i dla nie-właściciela | właściciel: `Disconnect remote project <name>? The next push will create a new remote project with the current config.name.`; nie-właściciel: `Disconnect remote project <name>? This clears remoteProjectId in the local config.json. The next push will create a new remote project.`; oba + `[Cancel]` / `[Disconnect]` |\n\nToasty (bez `kind`):\n\n| Wyzwalacz | `variant` | Treść |\n|---|---|---|\n| udany push nowego release'u | `success` | „Pushed as release #<sequence>” |\n| push zdeduplikowany | `success` | „Already pushed as release #<sequence>” |\n| wygasła sesja | `error` | „Session expired, log in and try again.” |\n| inny błąd pusha | `error` | „Push failed: <error_message>. Try again.” |\n| paczka za duża (`413`) | `error` | „Bundle too large (limit on remote). Reduce content or contact administrator.” |\n| zapis karty Remote project | `success` | „Remote project updated” |\n| edycja projektu zdalnego odrzucona kodem `NOT_OWNER` | `error` | „You are not the owner of this project” |\n</after_change>"
        }
      ]
    }
  ]
}
## entities module-dependency
{
  "from": {
    "id": 32098,
    "name": "2.1.44"
  },
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "entities": 1
  },
  "entities": [
    {
      "type": "module-dependency",
      "slug": "m25-requires-m17",
      "name": "M25 wymaga od M17",
      "op": "update",
      "before": {
        "slug": "m25-requires-m17",
        "title": "M25 wymaga od M17",
        "dependent": "M25",
        "provider": "M17",
        "needs": "Bez tego nie byłoby czego wypchnąć: paczka do wysłki powstaje po drugiej stronie, razem z walidacją istnienia wydania i rejestrem akcji, w którym osadza się przycisk.",
        "tags": [
          "m25"
        ],
        "createdAt": "2026-09-07T19:54:37.246Z",
        "updatedAt": "2026-09-07T19:54:37.246Z"
      },
      "after": {
        "slug": "m25-requires-m17",
        "title": "M25 wymaga od M17",
        "dependent": "M25",
        "provider": "M17",
        "needs": "Bez tego nie byłoby czego wypchnąć: paczka do wysyłki powstaje po drugiej stronie, razem z walidacją istnienia wydania i rejestrem akcji, w którym osadza się przycisk, oraz liczby niezreleasowanych zmian, którą pokazuje w banerze nad listą wydań i na karcie wydania.",
        "tags": [
          "m25"
        ],
        "createdAt": "2026-09-07T19:54:37.246Z",
        "updatedAt": "2026-10-23T16:17:25.839Z"
      }
    }
  ]
}
## entities ac (change)
{
  "from": {
    "id": 32098,
    "name": "2.1.44"
  },
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "entities": 4
  },
  "entities": [
    {
      "type": "ac",
      "slug": "ac-baner-you-have-n-unreleased-changes-p",
      "name": "Baner „You have N unreleased changes” pokazuje się nad listą release'ów na /releases, gdy licznik niezreleasowanych zmian jest większy od 0.",
      "op": "create",
      "after": {
        "slug": "ac-baner-you-have-n-unreleased-changes-p",
        "title": "Baner „You have N unreleased changes” pokazuje się nad listą release'ów na /releases, gdy licznik niezreleasowanych zmian jest większy od 0.",
        "kind": "requirement",
        "status": "active",
        "verifies": [
          {
            "type": "ui-view",
            "slug": "releases-list"
          }
        ],
        "tags": [
          "m25"
        ],
        "createdAt": "2026-10-23T16:17:20.652Z",
        "updatedAt": "2026-10-23T16:17:20.652Z"
      }
    },
    {
      "type": "ac",
      "slug": "ac-na-release-ie-starszym-niz-najnowszy",
      "name": "Na release'ie starszym niż najnowszy baner „You have N unreleased changes” nie jest pokazywany.",
      "op": "create",
      "after": {
        "slug": "ac-na-release-ie-starszym-niz-najnowszy",
        "title": "Na release'ie starszym niż najnowszy baner „You have N unreleased changes” nie jest pokazywany.",
        "kind": "edge-case",
        "status": "active",
        "verifies": [
          {
            "type": "ui-view",
            "slug": "release-detail"
          }
        ],
        "tags": [
          "m25",
          "m25-edge"
        ],
        "createdAt": "2026-10-23T16:17:20.649Z",
        "updatedAt": "2026-10-23T16:17:20.649Z"
      }
    },
    {
      "type": "ac",
      "slug": "ac-po-udanym-pull-in-unreleased-changes",
      "name": "Po udanym „Pull in unreleased changes” baner „You have N unreleased changes” znika z karty najnowszego release'u.",
      "op": "create",
      "after": {
        "slug": "ac-po-udanym-pull-in-unreleased-changes",
        "title": "Po udanym „Pull in unreleased changes” baner „You have N unreleased changes” znika z karty najnowszego release'u.",
        "kind": "edge-case",
        "status": "active",
        "verifies": [
          {
            "type": "ui-view",
            "slug": "release-detail"
          }
        ],
        "tags": [
          "m25",
          "m25-edge"
        ],
        "createdAt": "2026-10-23T16:17:20.651Z",
        "updatedAt": "2026-10-23T16:17:20.651Z"
      }
    },
    {
      "type": "ac",
      "slug": "ac-ui-banner-you-have-n-unreleased-changes",
      "name": "Baner „You have N unreleased changes” pokazuje się na karcie najnowszego release'u na osi wydań, gdy licznik niezreleasowanych zmian jest większy od 0.",
      "op": "update",
      "before": {
        "slug": "ac-ui-banner-you-have-n-unreleased-changes",
        "title": "UI banner „You have N unreleased changes\" widoczny jest WYŁĄCZNIE na karcie release detail najnowszego release'u na osi wydań (`release.id === latestReleaseId AND queue_size > 0`); na starszych (frozen) release'ach banner pominięty.",
        "kind": "edge-case",
        "status": "active",
        "verifies": [],
        "tags": [
          "m25",
          "m25-edge"
        ],
        "createdAt": "2026-05-26T17:48:23.000Z",
        "updatedAt": "2026-10-01T18:49:16.049Z"
      },
      "after": {
        "slug": "ac-ui-banner-you-have-n-unreleased-changes",
        "title": "Baner „You have N unreleased changes” pokazuje się na karcie najnowszego release'u na osi wydań, gdy licznik niezreleasowanych zmian jest większy od 0.",
        "kind": "edge-case",
        "status": "active",
        "verifies": [
          {
            "type": "ui-view",
            "slug": "release-detail"
          }
        ],
        "tags": [
          "m25",
          "m25-edge"
        ],
        "createdAt": "2026-05-26T17:48:23.000Z",
        "updatedAt": "2026-10-23T16:17:11.567Z"
      }
    }
  ]
}
## convention L5 offset 0
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 3
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L5-ui.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "ew1yz9k3",
          "headingPath": [],
          "heading": "L5 — UI",
          "content": "<after_change>\n> Kształt opisu interfejsu w pliku modułu: jakie ekrany moduł wnosi i jak je rejestruje, które sloty powłoki zajmuje, jaki stan trzyma po stronie przeglądarki i jakie okna otwiera — to, czego z samych encji widoków wyprowadzić się nie da.\n</after_change>"
        }
      ],
      "xmlRefs": {
        "after": []
      }
    }
  ]
}
## convention L5 offset 1
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 3
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L5-ui.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "42ewy1oy",
          "headingPath": [
            "L5 — UI"
          ],
          "heading": "Role in the system",
          "content": "<after_change>\nWarstwa jest framework-shaped: jeden implementor podnosi powłokę aplikacji webowej — regiony, sloty, hosty okien z rejestrem zdarzeń i trzy szuflady stanu — a konsumenci wnoszą do niej ekrany, deklarują zajmowane sloty, własny stan i własne okna, oraz wyłącznie te miejsca, w których od konwencji odchodzą.\n\nWarstwa **nie** obejmuje frameworka edytora — rozszerzeń, widoków node'ów, komend slash, reguł parsowania markdown — który jest osobną warstwą (`layers/L8-editor.md`) z inną publicznością: powłokę wypełnia garść modułów, edytor niemal wszystkie. Nie obejmuje też anatomii renderowanych komponentów, którą trzyma katalog komponentów hosta (L12), ani wartości tokenów prezentacji.\n</after_change>"
        }
      ]
    }
  ]
}
## convention L5 offset 2
{
  "from": null,
  "to": {
    "id": 32264,
    "name": "2.1.45"
  },
  "total": {
    "pages": 1,
    "sections": 3
  },
  "pages": [
    {
      "rootId": "pages",
      "path": "layers/L5-ui.md",
      "op": "create",
      "sections": [
        {
          "kind": "section",
          "anchor": "tehej2wz",
          "headingPath": [
            "L5 — UI"
          ],
          "heading": "Module slice schema",
          "content": "<after_change>\n**Każdy moduł dotykający tej warstwy wypełnia swoją sekcję `## UI (L5)`:**\n\n```\nWidoki          jeden embed <tagged_list type=\"ui-view\" tags=\"<tag modułu>\" filter=\"and\"/>\n                root pages   → tag `mNN` (sam numer modułu, bez sluga)\n                root plugins → tag `entity-<typ>`\n                każdy ekran i każda trasa to encja `ui-view`: `url` bez prefiksu projektu,\n                `params`, opis ekranu w encji (w tym pełnoekranowość trasy — warunek\n                przekierowania na nią stoi w `Domain` modułu); bez tabel tras pisanych w prozie\n                pomijane, gdy moduł nie wnosi ekranu\nRejestracja     `manifest pluginu` | `trasa bezpośrednia`\n                pomijane, gdy moduł nie wnosi ekranu (bez Widoków nie ma czego rejestrować;\n                wkład w sloty i w cudze ekrany moduł deklaruje wyłącznie\n                w odpowiednich tabelach)\nSloty           tabela slotów poniżej; pomijane, gdy moduł nie zajmuje slotu\nWkład w cudze ekrany\n                tabela wkładu poniżej: fragment (baner, sekcja, akcja), który moduł\n                wnosi do ekranu innego modułu; pomijane, gdy moduł takiego nie wnosi\nStan            trzy podpola, każde pomijane, gdy puste:\n  Store           nazwa store'a, pola trwałe\n  Zapytania       klucze zapytań w gramatyce [encja, ...filtry]\n                  oraz mapa „zdarzenie WS → klucz zapytania\" — jedyny dom tej mapy;\n                  inwalidacja zawsze szerokim prefiksem klucza\n  Pamięć lokalna  tabela pamięci lokalnej poniżej\nOkna            popovery i modale modułu: `kind` w gramatyce\n                `<rzecz>-create` | `<rzecz>-edit` | `<rzecz>-<czasownik>`, payload i pola;\n                odstępstwa klawiszowe tylko przy `dismissible={false}`\n                toasty modułu bez `kind`: wyzwalacz i treść (po angielsku)\n                okno zakotwiczone we własnym komponencie modułu nie jest oknem\n                powłoki i do pola nie wchodzi\nOdstępstwa      tabela odstępstw poniżej; brak wierszy = moduł trzyma konwencję warstwy\n```\n\nTabela slotów: `| Slot | Co moduł wnosi | Warunek widoczności |`. Kolumna `Slot` przyjmuje wyłącznie nazwę z zamkniętej listy: `Pas awarii`, `Nagłówek`, `User`, `Drzewa stron`, `ELEMENTS`, `OTHERS`, `Overlay czatu`. Render, położenie i kolejność slotów trzyma implementor; o tym, czy wpis w slocie jest interaktywny, decyduje moduł, który go zajmuje. Nowa nazwa slotu to zmiana tej listy, nie wpis w module.\n\nTabela wkładu: `| Ekran | Co moduł wnosi | Warunek widoczności |`. Kolumna `Ekran` to wzmianka `<inline_mention type=\"ui-view\" …/>` ekranu gospodarza. Fragment jest faktem dawcy: jego wygląd i warunek stoją w tej tabeli, a reguły — w `Domain` dawcy; encja gospodarza ani sekcja gospodarza go nie powtarzają. Region powłoki to slot, nie cudzy ekran — idzie do tabeli slotów.\n\nTabela pamięci lokalnej: `| Klucz | Zakres: projekt/globalny | Wersja | Co przechowuje |`\n\nTabela odstępstw: `| Pole stałe | Od czego odstępstwo | Dlaczego |`\n\n**Pola stałe warstwy — moduł ich nie powtarza**, a jeżeli od któregoś odchodzi, wpisuje jego **nazwę** w kolumnę „Pole stałe\" tabeli odstępstw. Nazwy są częścią kontraktu, nie ozdobnikiem: bez nich tabela odstępstw nie ma czego cytować.\n\n| Pole | Treść |\n|---|---|\n| `Klucz lokalny` | `c4s:<przestrzeń>:<nazwa>`; `<przestrzeń>` należy do dokładnie jednego modułu, który deklaruje ją w polu **Stan** |\n| `Format wartości` | `{v, data}` — numer wersji z kolumny „Wersja\" i dane |\n| `Język stringów` | każdy literalny string widziany przez użytkownika — etykiety, tooltipy, toasty, treść okien, stany puste, placeholdery, komunikaty walidacji, `message` błędów REST pokazywanych w UI — jest po angielsku; proza specyfikacji zostaje po polsku |\n| `Slug w URL` | slug wstawiany do ścieżki bez enkodowania |\n| `Parametry standardowe` | `?q=<tekst>` — wyszukiwanie; `?tag=<slug>` / `?tags=<slug,slug>` — filtr tagów; `?filter=and\\|or` — tryb filtra tagów; każda trasa waliduje własne parametry, a niepoprawne ignoruje |\n| `Poza URL` | URL trzyma tylko „gdzie jestem\"; otwarcie paneli, szerokości, motyw i wybór wątku czatu żyją w stanie aplikacji albo w pamięci lokalnej |\n| `Prefiks projektu` | nie jest częścią trasy modułu |\n\n**Rejestr zdarzeń powłoki jest jeden i należy do implementora.** Moduł otwiera popover albo modal wyłącznie przez fasadę z `kind`, toast — wyłącznie przez fasadę bez `kind`, i nie deklaruje zdarzeń u siebie — schemat nie ma pola na zdarzenia i jest to decyzja, nie przeoczenie: dwa rejestry rozjeżdżają się przy pierwszym dopisanym zdarzeniu.\n\n**Moduł, który warstwy nie dotyka** — nie wnosi ekranu, slotu, stanu, okna ani wkładu w cudzy ekran — pisze nagłówek `## UI (L5) — n/d` i jedno zdanie dlaczego. Jeden zapis, bez wariantów.\n\n**Wypełnienie schematu stoi w jednym pliku modułu.** W module trzymanym w jednym pliku — w nim. W module już rozbitym na podstrony — w tej podstronie, która tę warstwę nosi, a plik główny niesie wtedy sam embed `Widoki` i jedno zdanie-wskaźnik, bez powtarzania pozostałych pól. **Nowych podstron ani nowych plików pod ten schemat się nie zakłada:** rozbicie modułu na katalog jest osobną decyzją o kształcie modułu i nie zapada przy wypełnianiu warstwy.\n\n**Reading mode — implementor:** sekcja tej warstwy w module-implementorze czytana jest w how-mode. Trzyma runtime powłoki — stos, szkielet z regionami i slotami, tryby edytora, hosty okien z rejestrem zdarzeń, szuflady stanu z wrapperem pamięci lokalnej — a nie wypełnienie schematu; własne klucze pamięci lokalnej implementor deklaruje w podpolu **Pamięć lokalna**, tak jak każdy konsument.\n\n> **Implementor module:** `M50 — App Shell`\n</after_change>"
        }
      ]
    }
  ]
}
