# Decisions

## Set-up: entityParts (confirmed by the user at plan approval, 2026-10-27)

- `flagi-cli-m01` — built: the row whose Flag is `--clone <slug>` (removed in the window), and the list of implying flags in the Opis of the row whose Flag is `--create-project`; context: all other rows. Why: Tabela flag CLI, które parser M01 rejestruje; w oknie znika wiersz `--clone <slug>` i `--clone` znika z listy flag implikujących `--create-project` — to zmiana w kodzie parsera. Opis `--remote-url` zmienia się tylko słownie.
- `moduly-feature` — context: all. Why: Indeks modułów specyfikacji (moduł, warstwy, zakres, plik strony) — nic w kodzie mu nie odpowiada.
- `sub-drzewo-m17` — context: all. Why: Spis podstron modules/m17-snapshots-releases/ — struktura specyfikacji.
- `sub-drzewo-m25` — context: all. Why: Arkusz usunięty w oknie: spis podstron modules/m25-release-push/ — struktura specyfikacji.
- `sub-drzewo-m27` — context: all. Why: Arkusz usunięty w oknie: spis podstron modules/m27-project-clone/ — struktura specyfikacji.

## Set-up: user jobs

- The convention `Tabela modułów (zadania użytkownika)` (pages/SKILL.md §13 `oq23nb0j`) embeds only the `moduly-feature` module index, not a user-jobs table → every unit has `jobs: []`; the system verifier owns the end-to-end pass.
