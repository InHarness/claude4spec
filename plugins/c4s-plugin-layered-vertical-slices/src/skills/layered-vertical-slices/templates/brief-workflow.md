# Workflow brief: <from_release> → <to_release>

<!-- For an initial window the heading reads: # Initial workflow brief: <to_release> -->
<!-- Genre: a plan of work units. Every pointer into the specification names what to read at the window; the c4s-workflow-implementer skill turns it into c4s release-diff commands. Nothing from the specification is quoted. -->

## Release

- Project identity for every `c4s` command: `--project '<slug>' --workspace '<workspace>'`
- Window: from `<from_release | initial>` to `<to_release>`. Every read is `c4s release-diff --from <from> --to <to>` (the change) or `c4s release-diff --from initial --to <to>` (the state at `<to_release>`), with the identity above; the units below name only what to read.
- Pin: the implementation reads the specification only at this window, never at its live state, so editing the specification while it runs changes nothing here. The next window arrives as a new brief whose `from_release` is `<to_release>`.

## Conventions

<!-- Only the conventions some unit touches. One line each, read at <to_release>. -->

- `<layer> (<name>)` — implementor `<module>`: page `<key>`, section <i> (`<anchor>`)
- User jobs table, for the system verifier: page `<key>`, section <i> (`<anchor>`)

## Units

<!-- One block per unit, in the fixed format below. Every substantive entry of the window has exactly one owner for each of its parts.
     Read: lines, one per page and one per entity type:
       page `<key>` — change: sections <i>–<j> (<anchors>) | change: all ; context: sections <i>–<j> (<anchors>)
         change  = the window's change (--from <from>); its section numbers count the changed sections only
         context = the state at <to_release> (--from initial); its numbers count every section of the page
         numbers are 0-based positions from summaryOnly; anchors are labels to check, not addresses
         an initial window has no change/context split: page `<key>` — sections <i>–<j> (<anchors>)
       <entity-type>: <slug>, <slug>, …      (one line per type; criteria are an entity type like any other)
     Partial scope, always explicit — a part of a read this unit must not build yet, because it needs a later unit:
         - not yet: <what, in prose> → <unit-id> (<why>)
       and in that later unit, under the same read:
         - completes: <what> (deferred from <unit-id>) -->

### <unit-id>
- Goal: <one or two sentences: what changes in the system once the unit is done, naming any removals>
- Depends on: <unit-id> — <why, blocking only> | —
- Read:
  - page `<key>` — change: sections <i>–<j> (`<a>`, `<b>`); context: sections <i>–<j> (`<c>`)
    - not yet: <what> → <later-unit-id> (<why>)
  - <entity-type>: <slug>, <slug>
  - <entity-type>: <slug>

## Order

<!-- Waves: units within a wave are independent. Wave 0 only for an initial window (stack, scaffold, conventions/design tokens). -->

- wave 1 — `<unit-id>`, `<unit-id>`
- wave 2 — `<unit-id>`

### Stub ledger

<!-- Usually empty. A row only where cutting the units differently could not avoid it (a real cycle), and only for behaviour the provider gains in this window. -->

| dependent | provider | what the stub pretends | why it could not be avoided | module-dependency slug | closes in wave |
| --- | --- | --- | --- | --- | --- |

## How to run

Implement this brief with the `c4s-workflow-implementer` skill in the code repo: *"Implement the workflow brief `<this path>`."*
