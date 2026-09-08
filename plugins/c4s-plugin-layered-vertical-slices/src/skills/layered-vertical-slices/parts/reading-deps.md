## Cross-cutting reading protocol 2 — tracing a module's dependencies

The sweep answers "what is each module for?". This one answers "what is this module wired to?", and it takes **four steps** rather than two because the edges are directed and only one direction is reachable by tag.

1. **Identify the modules by substance, not by name.** Start from the purpose sweep — the `Cel` texts are the altitude at which "which modules is this about?" is decided. A module's slug is a label, not evidence.

2. **Read the OUTGOING edges by tag.** A dependency record carries the tag of the module that requires, so the records tagged `mNN` are exactly what `mNN` depends on:

   ```
   list_entities({ type: "module-dependency", tags: ["mNN"] })
   ```

3. **Read the INCOMING edges by filter — never by tag.** The records naming `mNN` as the far side carry the *other* module's tag, so no tag query reaches them; the `module-dependency` type's own block gives the filter call. **Step 3 is not optional and it is not a refinement of step 2.** It is the half of the graph step 2 structurally cannot see. Skipping it does not give you a smaller answer — it gives you a directed answer while looking like an undirected one, which is the more dangerous of the two. This is also why retiring a module takes **two** deletions (rule 3a): a leftover incoming edge dangles silently.

   Mind the spelling: `tags` are lower-case (`m19`), while the field holds what the author wrote (`M19`). The filter matches the field, not the tag.

   **Reachability.** Filtering on a field is an argument of the entity tools, and a thread that mounts only the read-only reader has no way to issue it. In that thread the incoming half is unreachable: say so, rather than issuing a call that will not validate, and let the caller decide whether the outgoing half is enough.

4. **Pull the modules on the far side.** Each record names a module, not an entity — there is nothing to resolve a link through. Map the identifiers back to module files and read their `Cel` sections; that is what turns a list of edges into a picture.

**What this protocol cannot tell you.** A record whose reason names a module in prose rather than by its fields reads as a dependency on something it is not wired to. The type's own rules exist to keep that out of the corpus, but reading is where you will meet the ones that got in.
