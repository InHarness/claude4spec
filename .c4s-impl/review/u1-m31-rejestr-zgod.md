## u1-m31-rejestr-zgod — review round 1 (non-blocking)

- **rev-0001** `src/server/workspace/registry.ts:846`: `setProjectTrust` ignores the result of `setTrustFlag` and emits consent-changed even when nothing was written. `setSkillUsesConfirmation` gates it. Harmless extra invalidation, but the two consent writers are inconsistent. Suggested fix: `if (this.setTrustFlag(...)) this.emitConsentChanged(ws, id);`.
- rev-0001 fixed after the wave-1 gate (user: fix and continue).
