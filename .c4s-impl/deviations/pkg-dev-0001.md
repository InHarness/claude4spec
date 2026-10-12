## What I found

At 2.1.14 the c4s-plugin-ac manifest section (`fsu38c8q`) shows the agent's `narrativeBlock` as a Polish text that also spells out the LVS tagging convention (`mNN`, `entity-X`, project-level tags) and, in the changed lines, says the module is set by tag `mNN` and the layer by tag `lNN`. The code's narrativeBlock has been English since 0.2.50 and deliberately carries no project-specific tag tokens: they describe one project's module numbering (Layered Vertical Slices), not a property of the `ac` type, and the active writing style carries them. Assumed: the 2.1.14 change is rendered as its rule, in English, without the tokens — `verifies` is filled only when the criterion's subject is a specific entity (endpoint, DTO, UI view, table, MCP tool), reference integrity is then checked; a criterion about behaviour described in a module's prose leaves `verifies` empty, its title is the contract and its tags place it (the module, and the layer when there is one).

Slugs: fsu38c8q

## Suggestion

either state in the section that the narrative's wording and tag vocabulary are the plugin's own, or drop the tag tokens from it.
