# Decisions

## setup: entityParts
- `tech-stack` (spreadsheet): built = the row **Git** (key `Warstwa`) — git ≥ 2.38 / `merge-tree --write-tree` gate in the M28 git service, older git reported unsupported (shadow diff falls to `shadow-only`); context = all other rows (stack description, unchanged in the window). Why: the new row states a requirement the system detects and handles in code; the rest describes the stack.
