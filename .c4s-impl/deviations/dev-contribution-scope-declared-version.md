## What I found

M13 irsmg4jn (2.1.88) scopes a plugin skill by the ContextType set of "the Host API version the plugin declared in its manifest", frozen there. A manifest does not declare a version, it declares a semver RANGE (`hostApiVersion: "^2.0.0"`). The spec does not say which version of the range is "the declared one", nor where each version's set is recorded.

Slugs: m33-requires-m13

## Suggestion

State in M13 (or in M33's Host API versioning section) that the declared version is the lowest version the range admits, that its set is that of the latest Host API release at or below it, and that every release of the Host API release registry records its ContextType set. Until then the code follows this reading: ASSUMPTION:contribution-scope-declared-version: declared version = minVersion(hostApiVersion range); its set = the set of the latest release at or below it (HOST_API_RELEASES[].contextTypes).
