/**
 * M51 — browser-side half of the host modules' tags: each owner binds the
 * render (and the popover fields) of the tags it registered. Imported by the
 * browser entry, the editor registrations and the chat renderer — module
 * evaluation runs it once.
 */
import '../../shared/xml-markup/host-tags.js';
import './tags/references/index.js';
import './tags/sections.js';
import './tags/todos.js';
