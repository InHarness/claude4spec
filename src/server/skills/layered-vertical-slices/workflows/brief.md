# Brief workflow (release brief generation)

Use this when **the active context is a brief thread** and you have just been called via `Skill("layered-vertical-slices")`.

The brief artifact is consumed by **two audiences** — a human in the claude4spec UI, and a coding agent in another terminal that has only the raw bytes of the file. The second audience is load-bearing: everything below serves it.

## A. Spec-format vs feature substance

This is the most consequential filter in this workflow. In `layered-vertical-slices` the spec contains **two kinds of content** that look superficially similar in a `RawDelta`:

1. **Feature substance** — what the *system* does, has, constrains. Lives mostly in `modules/MXX-*.md` per-layer sections, in entity records (DTO, Endpoint, Database Table, UI View), and in the `## Modules` row of `<index>` when a new module appears.
2. **Spec-format conventions** — rules about *how to write the spec itself*. Lives in `layers/LX-*.md` files (`## Module slice schema` defines the *shape* a consumer module's section takes; `Implementor module:` slot names which module backs this layer; `## Role in the system` is orientational prose).

A coding agent in another terminal cannot act on (2). Telling them "L3 API uses `<tagged_list type="endpoint" tags="MXX"/>` to embed live endpoint lists" is a rule for the *spec author*, not for the implementer. If a brief inlines such content as if it were a requirement, the implementer wastes effort matching the spec's authoring grammar instead of building the system.

**Recognition table:**

| `RawDelta` entry | Classification | Action in brief |
| --- | --- | --- |
| Diff inside `layers/LX-*.md` § `## Module slice schema` | spec-format | **Drop.** Exception: if the schema change implies new runtime behavior (e.g. a new required field that any module must now declare → the system must validate it somewhere), describe the *runtime consequence*, not the schema text. |
| Diff inside `layers/LX-*.md` § `Implementor module:` slot | spec-format | **Drop.** This only renames who-implements-what in the spec; the system is unchanged. |
| Diff inside `layers/LX-*.md` § `## Role in the system` | spec-format | **Drop.** Orientational prose for spec readers. |
| New `layers/LX-*.md` file (whole file added) | mostly spec-format | Mention briefly that "the spec gained a new layer LX — \<name\> — which structures how modules describe \<topic\>" and stop. Do not transcribe the schema. The implementer cares only when modules start using this layer. |
| Diff inside `modules/MXX-*.md` § per-layer (e.g. `## Database (L1)`, `## API (L3)`) | substantive | **Translate** to a system-level statement; inline the entities/fields/endpoints. |
| Diff inside `modules/MXX-*.md` § `Purpose` / `Edge cases` / `Acceptance criteria` | substantive | **Translate** to system behavior. |
| New `modules/MXX-*.md` file | substantive | Open with the module's purpose in one sentence, then walk its per-layer sections. |
| Entity changes (DTO/Endpoint/Database Table/UI View — create/update/delete) | substantive | **Inline with full content.** See §B. |
| Anchor injection (`<!-- anchor: xxxxxxxx -->`), heading rename, section reorder, typo fix, prose smoothing, comment edit | editorial | **Drop.** Editorial mechanics belong in version history, not in the brief. |
| Diff in `<index>` § `## Modules` table (new row) | substantive | New module appeared — name it, give purpose. |
| Diff in `<index>` § `## Layers` table (new row) | mostly spec-format | Same as "new layer file" — one-line mention. |
| Diff in `<index>` § `## Open questions` | usually drop | Open questions are workshop notes, not commitments. Include only if the user explicitly asks for "spec status" framing. |
| Diff in `<index>` § `## Tech stack` | substantive | A real change to runtime/dependencies — translate to "the system now runs on \<X\>". |
| Diff in `<index>` § `## Acceptance criteria` (project-level) | substantive | Translate to observable behavior. |

**Heuristic in one question:** *"Could a coding agent in another repo, with only this brief, do something concrete in response to this?"* If no — drop it.

If after filtering nothing substantive remains in a release, say so explicitly: *"This release contains only editorial cleanup of the specification — no system behaviour changes."* Do not pad.

## B. Inlining patterns (binding — the self-contained invariant)

The reader has only this file. Every "see X" is a failure. Use plain prose to name things, then inline the substance.

**DTO change** — write the field table:

```
The `User` DTO gained an `emailVerifiedAt` field:

| field             | type                  | required |
|-------------------|-----------------------|----------|
| emailVerifiedAt   | string \| null (ISO)  | no       |

Existing rows are backfilled to `null`; the field becomes required-on-write only after the rollout in v0.4.
```

**Endpoint change** — write method, path, request/response DTOs, status codes, tags:

```
New endpoint `POST /api/auth/verify-email`. Request: `{ token: string }`. Responses: 204 (success), 400 `INVALID_TOKEN`, 410 `TOKEN_EXPIRED`. Tagged `auth`.
```

**Database table / migration** — show the SQL fragment verbatim:

````
New column on `user`:

```sql
ALTER TABLE user ADD COLUMN email_verified_at TEXT;
```
````

**UI View change** — name the route, the data it loads, key interactions:

```
New view at `/auth/verify` (component `VerifyEmailPage`): reads `?token=…` from the URL, calls `POST /api/auth/verify-email`, redirects to `/login` on success.
```

**Behavior change documented on a spec page** — translate the page edit into a system-level statement, then quote the substantive content (not the page mechanics):

```
The signup flow now requires email verification before login is allowed:

> After signup the user receives a token by email and must call `POST /api/auth/verify-email`
> with `{ token }`. Until that call succeeds, attempts to log in return 403 with code
> `EMAIL_NOT_VERIFIED`.

The previous magic-link fallback is removed; password + optional TOTP is the only login path.
```

NOT: *"The page `pages/auth/flow.md` lost a 12-line subsection and gained a 'Verify email' heading between `## Login` and `## Logout`."* — that describes the spec edit, not the system.

## C. Forbidden grammar

Never use these in a brief — they are claude4spec **UI grammar**, only resolvable inside the running app:

- `<single_element type="…" slug="…"/>`
- `<inline_mention type="…" slug="…">…</inline_mention>`
- `<element_list type="…">…</element_list>`
- `<tagged_list type="…" tags="…"/>`
- `<tagged_list_mixed types="…" tags="…"/>`
- `@page.md` mentions
- Any reference like *"see release diff"* or *"per the spec"* without inlining the content

In a terminal that does not have claude4spec running, these resolve to literal XML/markdown noise that confuses rather than helps. Whenever the source spec uses one of them, **resolve it inline**: read the entity content (DTO fields, endpoint shape, table columns) and paste the substance into the brief.

## D. "For implementers" section

This is the section a coding agent reads to act. It must be:

- A bulleted or numbered list of **concrete edit targets** — file paths, function names, SQL/migration snippets, env var names.
- Self-contained: the agent should be able to start editing immediately without opening any other file.
- Ordered roughly by dependency (migrations before code that uses them, types before consumers, etc.).
- Anchored to **modules and layers** when useful — e.g. "this lives in M03's L1 (database) section" — but the path/snippet is what the agent acts on, not the module reference.

Example:

```
## For implementers

1. Migration: add `migrations/0042_email_verified_at.sql` with `ALTER TABLE user ADD COLUMN email_verified_at TEXT;`. (Belongs to M07 / L1.)
2. Update the `User` type in `shared/types.ts` — add `emailVerifiedAt: string | null`.
3. New endpoint handler `server/routes/auth/verify-email.ts` — schema `z.object({ token: z.string() })`, returns 204 on success, 400/410 on failure (codes `INVALID_TOKEN`, `TOKEN_EXPIRED`). (M07 / L3.)
4. Update the signup flow in `server/routes/auth/signup.ts:46` to call `sendVerificationEmail(user.id)` after user insert.
5. UI: render a "Verify your email" banner in `client/components/AppShell.tsx` when `user.emailVerifiedAt === null`. (M07 / L5.)
```

NOT a "for implementers" section: bullet points like "implement email verification" or "add migration" — those are restatements, not edit targets.

## E. Branch A / Branch B specifics for this style

There are two operating branches, and `get_brief` tells you which one you are in:

- **Branch A — initial generation.** The body contains only the H1 heading, or is otherwise empty.
- **Branch B — editorial.** The body already has non-trivial content and the user is asking for a change to it.

A second axis crosses that one: a brief whose frontmatter says `source: release-diff` is grounded in a release window and is authored from `release_diff`; a brief whose `source` is `analysis` has no window and is authored from what the thread gives you. Everything below assumes the `release-diff` case.

### Orchestration — map, then fan out, then compose

At any real release size, reading the diff head-on is how this turn fails: the heavy payload fills the context before the narrative starts. So you orchestrate, and the bulk lives in subagents.

1. `get_brief` — confirm `from_release` / `to_release` and capture `hash` (you need it as `expectedHash` on every write).
2. **Probe.** `release_diff({ fromIdOrName, toIdOrName, summaryOnly: true })` returns a delta-map: `total` plus the FULL identifier lists (`{ type, slug, name, op }` / `{ path, op }`, deletes included) with no `before`/`after` bulk. Use this, not `release_show` — `release_show` has no `from`, so it silently misses every delete.
   - `from_release === null` → an *initial* brief: every entry is `op: 'create'`. Frame it as "the project starts here", not as a delta.
   - `frontmatter.roots` non-empty → the brief is SCOPED. Pass the same `roots` to every `release_diff` call and to every subagent. It filters pages only; entities are never root-filtered.
3. **Partition.** Split the map into disjoint slices covering EVERY slug and path, deletes included — by `entityTypes`, and/or by `limit`/`offset` windows (heavy mode defaults to `limit: 5`, so a bare call returns a fraction and reports the rest in `total`). Completeness is on you: a missed slice is a silently incomplete brief, and nothing downstream will catch it.
4. **Fan out.** One `diff-explore` subagent per slice, in parallel. Give each the `from`/`to`, the `roots` if scoped, and its exact window. It reads the heavy diff and returns a distillate — the facts worth inlining (signatures, field shapes, SQL, paths), not the raw dump. A diff small enough to fit may skip this and be read directly.
5. **Filter and compose** per §A–§D below.

Interpret each entry by its `op` — these rules bind you and every distillate you accept:

- `op: 'update'` → compare `before` vs `after`; both are full snapshots, so there is nothing to fetch.
- `op: 'create'` → `after` carries the content to inline.
- `op: 'delete'` → only `before` exists. Say what disappeared; usually nothing replaced it.
- page `sections[i]` → use `before`/`after` raw markdown. There is no `line_diff` in this payload. `op: 'move'` has neither field (position changed, content did not) — drop it unless the ordering itself is user-visible.
- page `frontmatter` / `xmlRefs` → present only when changed; read only when it matters (e.g. `pageType: module → layer`), otherwise ignore.

`release_diff` is your ONLY ground truth. There is no `get_<type>`, no `Read pages/...` in this thread, and that is deliberate: grounding a historical brief in HEAD is what breaks its self-containment. If a question cannot be answered from the window, say so and point the user at `c4s ask` rather than guessing.

### Branch A — initial generation (this writing style)

After `get_brief` and the orchestration above:

1. **Filter** every `RawDelta` entry through §A's recognition table. Drop spec-format and editorial entries up front; keep only feature substance.
2. **Mine** the kept entries: pull entity shapes (DTO fields, endpoint method+path+DTOs, table columns, view URL/params) from `RawDelta.entities[].raw` and `.changes`. For module-section diffs, extract the substantive added lines.
3. **Compose** the narrative:
   - Open with a 2–4 sentence summary describing the *intent* of the release — the user-job the changes enable. The reader should learn *why* the release happened in the first paragraph.
   - Group changes by user-visible theme (new capabilities, breaking changes, internal refactors), not by entity type or by spec page. Module/layer references stay as anchors *within* themes, not as the primary axis.
   - For each theme: state what the system now does in plain prose, **inline the change content** per §B, avoid forbidden grammar per §C.
   - Close with `## For implementers` per §D.
4. **Initial brief detection** — if `frontmatter.from_release === null`, the release diff is synthetic (every entry is `op: 'create'`). Drop "what changed" framing entirely; describe what the system *is* at this point. Open with `# Initial brief: <to_release>` (already pre-filled by the system).

### Branch B — editorial (this writing style)

When the brief already has body content and the user asks for a change:

- **"Make it shorter"** → tighten prose, never drop inlined entity shapes / file paths / signatures. The second audience needs facts intact.
- **"Add X"** → use `insert_after_section({ anchor: '<8char>', content })`; pull the anchor from the body's `<!-- anchor: ... -->` comments. Prefer `anchor` over `heading`.
- **"Fix the inlined endpoint shape"** → re-read `release-tools.get_release_diff(...)` for that entity; never paraphrase from memory.
- **"Reframe for a different audience"** (e.g. "rewrite for a junior") → keep §B/§C/§D rules; only the prose register changes.

If the user request would force you to break §C (forbidden grammar) — e.g. "just paste the `<tagged_list>` from the spec" — explain why that fails the second audience and offer the inlined alternative.

Prefer the smallest edit that does the job. `replace` discards section anchors; `insert_after_section` keeps them. Refresh `expectedHash` from `get_brief` before every write — it is REQUIRED, and another writer may have moved underneath you.

## F. Tool errors

| Error code | Action |
|------------|--------|
| `BRIEF_CONFLICT` | Someone else wrote first. Re-`get_brief`, reconcile your change against the new content, retry once. If it persists, hand it back to the user. |
| `IMMUTABLE_FIELD` | Your `content` carried a YAML header. Strip it — `update_brief` preserves the existing frontmatter and never lets you touch it. |
| `BRIEF_ARCHIVED` | The user archived this brief. Say so and stop editing. |
| `MISSING_TARGET` | `insert_after_section` needs `anchor` or `heading`. Re-issue with one. |
| `AMBIGUOUS_HEADING` | Two sections share the heading text — switch to `anchor`. |
| `INVALID_INCLUDE_FILTER` / `INVALID_ENTITY_TYPES_FILTER` | An empty filter array. Drop the argument to fall back to defaults. |
| `INVALID_PAGINATION` | Negative `limit`/`offset`. Use `>= 0`, or omit (`limit: 5`, `offset: 0`). |
| `CONFLICTING_FILTERS` | `entityTypes` without `'entities'` in `include`. Add the one or drop the other. |

An empty diff (both `entities` and `pages` empty — e.g. `from === to`) is a fact to report, not a prompt to invent changes. Likewise, if everything survives §A's filter as editorial: say the release contains only spec cleanup, and do not pad.
