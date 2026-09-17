import type Database from 'better-sqlite3';
import { DomainError } from './tags.js';
import { encrypt, decrypt } from './agent-credential-crypto.js';
import type { AgentCredentialResponse } from '../../shared/agent-credential.js';
import { AgentTurnError } from '../../shared/agent-turn.js';

interface AgentCredentialRow {
  id: number;
  provider: string;
  api_key_ciphertext: string;
  key_last4: string;
  created_at: string;
  updated_at: string;
}

const PROVIDER = 'anthropic';

/**
 * M05 — owns the single-row `agent_credential` store: the user's own ANTHROPIC API
 * key, encrypted at-rest. Mirrors the `remote_session` precedent: write is an
 * atomic upsert (delete-then-insert), clear is a delete, and the single-row
 * discipline lives here (not in a SQL constraint). The plaintext key never leaves
 * the server — only `getDecrypted()` (server-side, at architectureConfig assembly)
 * exposes it; the public API surface returns only `{ isSet, last4 }`.
 */
export class AgentCredentialService {
  constructor(private db: Database.Database) {}

  /** Read-only status for the Settings → Agent section. Never returns the key. */
  getStatus(): AgentCredentialResponse {
    const row = this.read();
    return row ? { isSet: true, last4: row.key_last4 } : { isSet: false, last4: null };
  }

  /**
   * Validate + encrypt + upsert. Throws `DomainError('VALIDATION')` on empty input
   * or a missing `sk-ant-` prefix (route surfaces it as 400, inline under the field).
   */
  set(rawKey: string): AgentCredentialResponse {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) {
      throw new DomainError('VALIDATION', 'API key is required');
    }
    if (!key.startsWith('sk-ant-')) {
      throw new DomainError('VALIDATION', 'API key should start with "sk-ant-"');
    }
    const ciphertext = encrypt(key);
    const last4 = key.slice(-4);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_credential').run();
      this.db
        .prepare(
          `INSERT INTO agent_credential (provider, api_key_ciphertext, key_last4)
           VALUES (?, ?, ?)`,
        )
        .run(PROVIDER, ciphertext, last4);
    });
    tx();
    return { isSet: true, last4 };
  }

  /** Delete the credential → back to the local Claude Code login. Idempotent. */
  clear(): AgentCredentialResponse {
    this.db.prepare('DELETE FROM agent_credential').run();
    return { isSet: false, last4: null };
  }

  /**
   * Server-side only — used when assembling `architectureConfig.custom_env`.
   * Returns the decrypted key, or `null` when no credential is stored (the agent
   * then falls back to the local Claude Code login).
   */
  getDecrypted(): { apiKey: string } | null {
    const row = this.read();
    if (!row) return null;
    try {
      return { apiKey: decrypt(row.api_key_ciphertext) };
    } catch (err) {
      // 0.2.87: a deleted or corrupted keyring with a stored ciphertext means the
      // server cannot serve the turn with the credential the user configured — the
      // turn fails `AGENT_UNAVAILABLE` (503), not a generic 500, and never silently
      // falls back to the local login.
      const detail = err instanceof Error ? err.message : String(err);
      throw new AgentTurnError(
        'AGENT_UNAVAILABLE',
        `Stored Anthropic API key cannot be decrypted (${detail}). Re-enter it in Settings → Agent, or clear it to use the local Claude Code login.`,
      );
    }
  }

  // --- internals ----------------------------------------------------------

  private read(): AgentCredentialRow | null {
    return (
      (this.db.prepare('SELECT * FROM agent_credential LIMIT 1').get() as
        | AgentCredentialRow
        | undefined) ?? null
    );
  }
}
