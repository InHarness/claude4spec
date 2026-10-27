# Decisions

## Set-up: entityParts (confirmed by the user at plan approval, 2026-10-27)

- `wklad-do-edytora-m53` — built: both data rows (Nazwa: "adnotacje page-bound", "`chat-input`"), key `Nazwa`. Why: Rejestr wkładów M53 do edytora: dekoracja adnotacji page-bound i osadzenie chat-input. Treść identyczna z usuniętym arkuszem M05, zmienia się tylko moduł-właściciel.
- `wklad-do-edytora-m05` — context: all. Why: Arkusz usunięty w oknie; zastąpiony przez wklad-do-edytora-m53 o tej samej treści.
- `moduly-feature` — context: all. Why: Indeks modułów specyfikacji (moduł, warstwy, zakres, plik strony) — nic w kodzie mu nie odpowiada.

## Set-up: user jobs

- The convention `User jobs table, for the system verifier` (pages/SKILL.md §13 `oq23nb0j`) embeds only the `moduly-feature` module index at 2.1.56, not a user-jobs table → every unit has `jobs: []`; the system verifier works from the units' goals, criteria and built entities.

## Set-up: recipe parsing

- `pages/modules/m05-chat-agent.md` is deleted in the window; its ranges are read as `change` (numbers count changed sections). Ranges given as `a … b` keep only their endpoint anchors (plus `80prkz1j`, named in the brief as deleted inside 91–107).
- The L16 convention has two addresses (M48 sections 22–25 and the L16 schema page) → two `conventions[]` entries.
