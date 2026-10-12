System verification, env-runner `impl-2-1-15-to-2-1-16` @ d8fdc3e6, `npm test` (npm ci from lockfile, uid 1000): 5518/5518 tests passed, but 1 suite failed at collection:
src/client/xml-markup/tags/references/ElementList.render.test.ts — `[vitest] No "registerEntity" export is defined on the "../../../entities/registry.js" mock. Did you forget to return it from "vi.mock"? If you need to partially mock a module, you can use "importOriginal" helper inside`.
So the test carrying [ac:ac-slug-usunietej-encji-w-element-list-n] and [section:m19broken] never ran.
