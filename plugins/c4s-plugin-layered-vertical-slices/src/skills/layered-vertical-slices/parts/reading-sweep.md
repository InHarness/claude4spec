## Cross-cutting reading protocol 1 — sweeping every module's purpose

For an agent that **writes nothing** yet — one orienting itself in an existing corpus before routing a change, partitioning a diff, or locating a deviation. It collects the purpose of every module in **two calls**, and the steps below are the protocol, not a suggested shape for one. The protocol names tools and says why this style calls them the way it does; what a tool accepts, returns and refuses is the tool's own description, not this text's.

**Call 1 — map the `Cel` headings.**

```
search_pages({
  regex: "^## Cel$",
  mode: "map",
  pathInclude: "(^|/)[Mm]odules/(?:([^/]+)/\\2|[^/]+)\\.md$",
  limit: 200
})
```

Map mode returns addresses with no prose: you want the anchors now and the bodies once. **`limit` is part of the call**, set well above any module count you expect — a windowed map reports no shortfall of its own. Read `total` and `hasMore` in the answer and page on `offset` until `hasMore` is false: a module missing from an unread second page looks exactly like a module whose heading was renamed (the failure mode below), and the repair for one does nothing for the other.

A map row without an `anchor` cannot feed call 2. If that is what comes back, the root carries no section index and the corpus cannot be swept this way — stop and say so; no amount of retrying changes it.

**The path filter is a step of this protocol, not a variant of it.** A module's main file is named after the module — `modules/M03-endpoint.md`, or `modules/M03-endpoint/M03-endpoint.md` once the module is split — and its subpages never begin with that prefix, because they are named after the *layer* they carry (`L1-db.md`). That is exactly what the pattern above encodes: a file directly under `modules/`, or a file inside a module directory whose own name repeats the directory's (the `\2` backreference). Drop the filter and the sweep still succeeds, silently returning the purpose of a **file** rather than the purpose of a **module**. That is not a slower answer; it is a different one.

Two properties of the pattern are deliberate and easy to lose in an edit:

- **The path match is case-insensitive, and the pattern has to make it so.** `pathInclude` is a plain regex body: it is compiled with **no `i` flag, and JavaScript offers no inline `(?i)`**, so the insensitivity lives in the pattern's own character classes — hence `[Mm]odules` rather than `modules`, and, in any narrowing that names the module prefix, `[Mm]\d+` rather than `M\d+`. This document writes the naming rule as `M{NN}-{kebab-slug}.md` while a corpus on disk carries `m31-workspace.md`; a pattern spelling a bare `M` therefore works for one author and returns nothing at all for another, with no error in between.
- **The leading alternation `(^|/)` is not decoration.** Whether the path handed to the filter is relative to its root or carries a prefix is not the protocol's to assume, and a bare `^` that guesses wrong matches nothing — silently. Over-matching is visible; under-matching is not.

**Scope of the sweep.** The pattern deliberately says nothing about the `M{NN}` prefix, so a root whose modules are named otherwise — package pages such as `modules/c4s-plugin-<slug>.md` — is swept on the same terms. Narrow it to numbered modules only when you mean to, and then spell the prefix with the character classes above.

**Call 2 — read the sections you mapped.**

```
get_sections({ anchors: [ …every anchor from call 1… ] })
```

Batch the anchors into as many calls as the tool's per-call limit requires — it refuses a longer list rather than truncating it, and says so — and watch `truncated` on the way back: the response is width-budgeted, and at a 1200-character `Cel` a large corpus will start coming back with bodies degraded. "Two calls" is the protocol's shape, not a promise that the second one is literally singular.

This rests on the `Cel` section's **stable anchor**, assigned once at first indexing: it is what makes the map from call 1 valid input to call 2.

Both properties above — `map` mode and `pathInclude` — are **parts** of the protocol rather than optimizations of it. Degrading either does not slow the sweep down; it corrupts the result.

### Failure mode this protocol introduces

The sweep matches on the `## Cel` heading, so **a module that names that section anything else drops out of the result silently** — no error, no empty row, nothing in the response saying a module is missing. The variant that causes this today is the English `## Purpose`. When a sweep returns fewer modules than the index lists, check this first; the repair is to rename the heading to `## Cel` while keeping the section's existing anchor, so every address already handed out stays valid.
