# Review — m31-registry-edge-cases (non-blocking)

- **rev-0001** `src/server/workspace/registry.ts:461`: the per-record shape check runs before the `$schemaVersion` guard, so a registry written by a newer claude4spec reads as "damaged" instead of "upgrade claude4spec". Fix: move it below the guard.
- **rev-0002** `src/client/state/persisted.project-scope.render.test.ts:6`: a client (happy-dom) test that imports server registry/spa-route modules and node `fs`, which blurs the client/server test boundary.
- (verifier note) The release of the MCP factories on a partial-build failure (`project-context.ts:421`) has no test; only the release on dispose is asserted.
