import { afterEach } from 'vitest';
import '../src/shared/xml-markup/host-tags.js';
import {
  restoreXmlTagsForTests,
  snapshotXmlTagsForTests,
} from '../src/shared/xml-markup/registry.js';

// M51 — the XML tag registry is process-global and has no unregistration.
// The host tags are registered once (import above); a test that registers a
// scratch tag must not leak it into the next one, so every case ends with the
// registry restored to the host-only state.
const hostTags = snapshotXmlTagsForTests();
afterEach(() => {
  restoreXmlTagsForTests(hostTags);
});
