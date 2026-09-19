# Read workflow (what the spec says today)

Every thread on an existing spec starts here — a question, an idea, a requested edit, a plan to execute. Before anything else, establish what the specification says about the topic **today**. A question ends with this workflow; a change goes on to `workflows/plan.md` or `workflows/apply.md` with this picture in hand.

This file loads once per thread. Read the specification again when the topic changes or after something was saved: the picture is what the tools returned, and it is only as current as the calls that returned it.

You write nothing here, and you do not yet ask the user what they want — that is planning's first step. You do not read modules yourself either: a module can run to hundreds of thousands of characters, and a few of them would fill your context before the question is answered. You dispatch and you assemble. The output is an account of the current state, with addresses.

## Step 1 — Scout

Delegate to the `layered-spec-scout` subagent with the topic in the user's own words. It translates them into the specification's vocabulary, searches pages and entities, and returns the **involved** modules (each with a reason, its layers, its entities and the anchors of its hits), the **periphery**, a **glossary** from the user's words to the specification's, and any open question from `<index>` that bears on the topic.

Skip the scout only when the user named one module and the topic sits in it plainly — then that module is the list.

## Step 2 — Readers

Delegate to the `layered-slice-reader` subagent **once per involved module, in parallel**, in a single turn. Hand each one its module, the topic, the glossary, and the anchors the scout found in that module. A reader reads the module by topic against its layers' schemas and follows the dependency edges one step out; it reports facts with addresses, schema gaps, edges and what it did not read.

A periphery module gets no reader unless a reader's report points back at it as carrying the topic. A reader that names a neighbour as a second home of the topic is asking for another reader — dispatch it.

## Step 3 — Synthesis

Put the reports together. Addresses first, then what they say: which module owns the behaviour, which layer sections carry it, which entities and dependency records back it, what leans on it.

- **Contradictions between reports are a result**, not noise to smooth over: two modules saying different things about one behaviour is exactly what the user needs to see. Name both addresses.
- **The periphery stays separate** — listed, one line each, not merged into the picture.
- **What the specification does not cover** — the scout's thin coverage, the readers' gaps — is a finding, not a failure. Say it.
- A reader that reports **"not read"** left part of its module unread; say which part rather than presenting the picture as whole.

## Step 4 — Beyond this specification

When the scout reports few or no hits, or `<workspace_projects>` shows another project whose subject the topic plainly belongs to, the topic may live in a different specification. In a `chat` or `patch` thread you may consult that project with `ask` — your call, not a step to run by default. In an `ask` thread there is no such channel: say that the topic may be covered elsewhere, and name the project if one is apparent.

## Step 5 — Hand over

- **A question** → the answer in the user's words, the addresses beneath it, and stop.
- **A change** → the picture (addresses, then what they say) → `workflows/plan.md` when it still has to be placed, `workflows/apply.md` when there is an approved plan or the edit's place is already stated.
