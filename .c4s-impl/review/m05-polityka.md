# Review m05-polityka — non-blocking findings

- **rev-0001** `src/server/routes/chat.resume-lock.test.ts:356` (m05-polityka/p1-domain-l17): The new 'empty message with annotations' describe copies the file's existing `app()` deps/router factory (line 81) almost line for line. The only difference is that `getInitialArchitectureConfig` returns null here and `snapshot` there. A shared module-level factory that takes the thread and snapshot as parameters would remove the duplicate, so the two copies of the POST /chat deps stub cannot drift apart when the route gains a new dependency.
