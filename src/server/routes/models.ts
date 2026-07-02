/**
 * Leaf module z autorytatywna lista modeli agenta. Wydzielone z `agent-turn.ts`,
 * by inne moduly (np. `mcp/c4s-tools.ts`) mogly uzyc `ALLOWED_MODELS` bez cyklu
 * importow (`agent-turn` importuje `c4s-tools`, wiec import w druga strone tworzylby
 * cykl). `agent-turn.ts` re-eksportuje stad dla zgodnosci istniejacych importerow.
 */
export const ALLOWED_MODELS = ['fable-5', 'sonnet-4.6', 'opus-4.8', 'haiku-4.5'] as const;
export type Model = (typeof ALLOWED_MODELS)[number];
