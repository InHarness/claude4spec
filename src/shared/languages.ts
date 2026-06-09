/**
 * Curated list of supported languages (0.1.51).
 *
 * Both `config.language` (spec authoring) and `config.agent.conversationalLanguage`
 * (chat replies) accept ONLY a display name from this list. The constant is shared:
 * imported directly by the server-side `PATCH /api/config` validator AND by the
 * client dropdowns (onboarding M16, settings M26). Deliberately there is NO HTTP
 * endpoint for this list (unlike `writingStyle`, whose selectors fetch
 * `GET /api/writing-styles`) — the list is small and static, so importing the shared
 * constant is cheaper than an HTTP round-trip.
 *
 * Extensible: appending an entry requires NO config migration — it is purely a
 * widening of the accepted membership set.
 */
export const SUPPORTED_LANGUAGES = [
  'English',
  'Polski',
  'Deutsch',
  'Español',
  'Français',
  'Português',
  'Italiano',
  'Nederlands',
  '日本語',
  '中文',
] as const;

/** Type guard: `true` iff `v` is a display name in {@link SUPPORTED_LANGUAGES}. */
export function isSupportedLanguage(v: unknown): v is string {
  return typeof v === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}
