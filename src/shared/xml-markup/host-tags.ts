/**
 * M51 — host startup registrations. Each host module that contributes a tag
 * declares it in its own file; this barrel only makes sure every one of them
 * has run before the first parse. Imported once by the server bootstrap, the
 * browser entry and the test setup — ES module evaluation runs each file once
 * per process, so the registry's hard duplicate error never fires on a replay.
 */
import './tags/references.js';
import './tags/sections.js';
import './tags/todos.js';
