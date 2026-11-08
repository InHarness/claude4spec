post-api-artifacts-kind-path-threads → src/server/routes/artifacts.ts (POST /:kind/*/threads; test src/server/routes/artifacts.test.ts "N threads per artifact, in both binding modes (2.1.74)")
artifact-thread-create-request → src/shared/entities.ts (ArtifactThreadCreateRequest) + src/server/routes/artifacts.ts (parseThreadCreateRequest); test src/server/routes/artifacts.test.ts
create-thread → src/server/operations/core-operations.ts (create_thread row) + src/server/routes/threads.ts (POST /); tests src/server/operations/catalog.test.ts, src/server/routes/threads.test.ts
