-- Etap: agent-chat 0.1.1 — `contextSize` jako oddzielna metryka od `usage` (billing).
-- `usage` (last_usage_json / usage_json) sumuje się przez tury — nie nadaje się na
-- pasek "X / 200k" (przekraczał 100% w dłuższych rozmowach). `contextSize` to
-- okno kontekstu po tej turze (last-turn, NIE sumować). Wire-event `result`
-- z agent-adapters niesie je obok `usage`; tu trzymamy je per-tura i thread-level.
--
-- Backward-compat: stare wątki mają NULL — klient liczy fallback z usage.

ALTER TABLE chat_thread  ADD COLUMN last_context_size INTEGER;
ALTER TABLE chat_message ADD COLUMN context_size INTEGER;
