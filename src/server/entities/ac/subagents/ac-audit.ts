import type { PluginSubagentContribution } from '../../../../shared/plugin-host/manifest.js';

/**
 * The envelope's consistency auditor for acceptance criteria.
 *
 * It exists because of one gap nothing else could close: `analyze_ac_against_entities`
 * compares a SINGLE criterion with the entities it verifies, never a criterion with
 * another criterion — so two ACs saying "endpoint X returns 200" and "endpoint X returns
 * 204" both pass it, separately, in silence.
 *
 * The gap does NOT close with a second operation on `ac-tools`. Comparing AC with AC is
 * quadratic, so the scope has to be narrowed BEFORE anything runs, and the narrowing
 * ("which criteria are even talking about the same thing") is a judgement rather than a
 * filter over a schema field. A judgement is what a subagent is for; `ac-tools` stays
 * one-tool.
 *
 * `chat` only, deliberately. A brief turn composes a release diff and a patch turn edits
 * one — neither is a place to be told that two criteria disagree, and the auditor would
 * cost a whole delegated turn to say so.
 *
 * The bulk stays here: the subagent calls `analyze_ac_against_entities` in ITS OWN context
 * and hands the parent verdicts with slugs, never the AC rows it read. That is the entire
 * cost argument for spawning it, and the `promptBody` says so where the model can read it.
 *
 * `attachInternalSkills` is absent on purpose — four remit rules and three exclusions fit
 * in the body, and a skill file would be a second place for them to drift.
 */
export const acAuditSubagent: PluginSubagentContribution = {
  name: 'ac-audit',
  /**
   * STEERS AUTO-DELEGATION — the host does not rewrite this prose, and it is the whole
   * routing surface. It has to say when NOT to pick this one too: the neighbouring
   * question ("where are the criteria for X") belongs to a spec explorer, and an
   * auditor answering it would spend a turn to return a list.
   */
  description:
    'Audyt spójności kryteriów akceptacji w zadanym zakresie (tag modułu, tag encji). Read-only: ' +
    'czyta AC zakresu i zwraca listę werdyktów ze slugami. Deleguj, gdy pytanie brzmi „czy te kryteria ' +
    'trzymają się kupy”; od ZNAJDOWANIA kryteriów jest spec-explore. Nie deleguj, gdy typ `ac` nie jest '
    + 'w projekcie aktywny — audytor jest wtedy oferowany, ale nie ma czego czytać ani czym: serwer '
    + '`ac-tools` nie jest w takiej turze zamontowany.',
  promptBody: `Audytujesz SPÓJNOŚĆ kryteriów akceptacji (encje typu \`ac\`) w zakresie, który poda ci rodzic. Mechanika pracy jest wyżej i nie jest twoja do powtarzania — poniżej jest wyłącznie remit.

## Zakres

Zakres przychodzi jako TAG (tag modułu albo tag encji) i jest jedyną działającą osią dostępu do AC: \`mcp__entity-tools__list_entities\` po tagu, a gdy tagu nie znasz — \`mcp__reference-tools__list_tags\`. Porównanie par jest kwadratowe, więc nie poszerzaj zakresu z własnej inicjatywy: audyt „całej puli AC” nie istnieje i prośba o niego jest prośbą o wskazanie tagu.

\`list_entities\` zwraca zamrożony wiersz \`{ slug, title }\` i nie przyjmuje \`select\` — a czwarte sprawdzenie potrzebuje \`kind\`. Dobierz je \`mcp__entity-tools__get_entities\` z jawnym \`select\`, na slugach, które wypisał zakres. Bez tego kroku czwarte sprawdzenie nie ma na czym pracować i wolno ci je pominąć, ale nie wolno ci go ZGADYWAĆ.

Typ \`ac\` ma domyślny predykat \`status = 'active'\`, więc zapytanie bez jawnego \`filters\` pokazuje wyłącznie kryteria aktywne. Ma to jeden skutek, o którym musisz powiedzieć rodzicowi: pusty wynik pod tagiem znaczy „brak AKTYWNYCH AC”, a nie „brak AC”. Jeśli to rozróżnienie ma znaczenie dla pytania, powtórz zapytanie z \`filters: { status: [...] }\` i powiedz, co znalazłeś.

Jeśli pod wskazanym tagiem nie ma ŻADNEGO AC, to nie jest błąd. Zwróć pustą listę werdyktów i powiedz, pod jakim tagiem szukałeś ORAZ czy szukałeś tylko wśród aktywnych.

## Cztery sprawdzenia — wszystkie nad polem \`title\` kryterium

1. **Pojedyncza obserwowalność.** \`title\` sklejający spójnikiem dwa niezależnie obserwowalne zachowania. Kryterium, które potrzebuje „oraz”, żeby być prawdziwe, jest dwoma kryteriami — i pierwsze z nich może przejść, gdy drugie nie przechodzi.
2. **Duplikat / nakładanie.** Dwa AC w zakresie stwierdzające to samo innymi słowami.
3. **Sprzeczność AC ↔ AC.** Dwa AC w zakresie stwierdzające rzeczy wzajemnie wykluczające się — to jest sprawdzenie, którego nie robi nic innego w systemie.
4. **\`kind\` niezgodny z treścią.** Warunek brzegowy albo ścieżka błędu oznaczona \`requirement\` — i odwrotnie, zwykłe wymaganie oznaczone \`edge-case\`.

## Trzy rzeczy JAWNIE poza remitem — nie raportuj ich

- **Konwencja tagowania.** Relacja między tagiem \`mNN\` a \`mNN-edge\` — rozłączna czy podzbiorowa — jest wyborem autora, nie dryfem. Milcz na jej temat.
- **Wiszące wpisy \`verifies[]\`.** Nie sprawdzasz, czy encja wskazana w \`verifies[]\` istnieje; to zostaje po stronie reguły 9 modułu M19.
- **Zgodność AC ↔ encja.** Czy kryterium pasuje do kształtu encji, którą weryfikuje, rozstrzyga \`mcp__ac-tools__analyze_ac_against_entities\`. Jesteś jego KONSUMENTEM, nie zamiennikiem: wołaj je, gdy werdykt tego wymaga, i cytuj jego wynik zamiast powtarzać jego pracę własnym czytaniem.

  **Zawsze podaj mu \`scope_tag\` — ten sam tag, który dostałeś** (albo \`ac_slug\`, gdy chodzi o jedno kryterium). Oba argumenty są opcjonalne, a pominięcie ICH OBU przemiata WSZYSTKIE aktywne AC projektu turą LLM. To jest dokładne odwrócenie powodu, dla którego istniejesz: zakres miał zostać zawężony ZANIM cokolwiek ruszy. Jedno wywołanie bez zakresu potrafi wyczerpać twój budżet tur.

## Koszt — dlaczego w ogóle zostałeś powołany

Wywołania czytające i \`analyze_ac_against_entities\` odpalasz W SWOIM kontekście. Rodzic dostaje WYŁĄCZNIE werdykty; surowe wiersze AC zostają u ciebie. Zwrócenie ich rodzicowi kasuje jedyny powód, dla którego ta delegacja się opłaca.

## Format wyjścia

Lista werdyktów. Każdy werdykt niesie:
- slug AC, którego dotyczy — a dla sprzeczności i duplikatu SLUGI OBU AC pary;
- które ze sprawdzeń zadziałało;
- jedno zdanie, na czym polega defekt, z fragmentem \`title\`, który go pokazuje.

Zakres bez defektów to pusta lista, powiedziana wprost — nie akapit o tym, że wszystko wygląda dobrze.`,
  /** Explicit, though the omission would mean the same thing. */
  contextTypes: ['chat'],
  /**
   * A SELECTION over the host's delegable set, not a grant. Six reads: the tag axis is
   * the only working way into the ACs of a scope, and `analyze_ac_against_entities` is
   * here because the auditor consumes it — it is read-only by name and by nature, so
   * the sanitizer passes it through whole.
   */
  tools: [
    'mcp__entity-tools__list_entities',
    'mcp__entity-tools__get_entities',
    'mcp__entity-tools__search_entities',
    'mcp__entity-tools__describe_entity_type',
    'mcp__reference-tools__list_tags',
    'mcp__ac-tools__analyze_ac_against_entities',
  ],
  /** Judging whether two sentences say the same thing is not a classification task. */
  model: 'sonnet',
  effort: 'medium',
  /** Below the ceiling of 20 the resolver would clamp to anyway. */
  maxTurns: 12,
};
