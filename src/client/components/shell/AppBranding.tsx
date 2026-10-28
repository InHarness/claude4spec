import { C4sLogoIcon } from '../C4sLogoIcon.js';

/**
 * M50 — the application branding, a shell element of the header on both route
 * kinds: the first strip of the project sidebar (`8h2a734u`) and the bar of
 * the workspace route frame (`1bd92aq2`).
 */
export function AppBranding() {
  return (
    <a
      href="https://claude4spec.inharness.ai"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center"
      style={{ width: 22, height: 22, flexShrink: 0 }}
      title="claude4spec.inharness.ai"
    >
      <C4sLogoIcon size={22} />
    </a>
  );
}
