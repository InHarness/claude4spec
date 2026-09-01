import { describe, expect, it } from 'vitest';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import { subagentsFor } from '../../../services/chat-context.js';
import {
  NON_DELEGABLE_TOOLS,
  isMutatingMcpTool,
  resolvePluginSubagents,
} from '../../../services/plugin-subagents.js';
import { acPlugin } from '../plugin.js';
import { acAuditSubagent as sub } from './ac-audit.js';

/**
 * 0.2.58 — the envelope's second slot.
 *
 * What is asserted here is the ENVELOPE's half of the contract: that exactly one
 * subagent rides along, that it reaches only `chat` turns, and that every tool it
 * names survives the host sanitizer. What the auditor actually REPORTS is a model's
 * judgement over prose and is not assertable in vitest — those criteria carry
 * skiplist entries instead.
 */

/** A host whose pool contributes the given subagents; the entity half is inert here. */
const hostWith = (contributions: typeof acPlugin.contributes.subagents) =>
  ({
    listEntities: () => [],
    listSubagents: () => contributions ?? [],
  }) as unknown as ProjectPluginHost;

describe('c4s-plugin-ac — the ac-audit subagent it contributes', () => {
  it('[ac:ac-koperta-c4s-plugin-ac-wnosi-dokladnie] contributes exactly one subagent, named ac-audit', () => {
    // The envelope gained a second SLOT, not a second subagent. One definition is the
    // whole of `contributes.subagents`, and its name is the routing address.
    expect(acPlugin.contributes.subagents).toHaveLength(1);
    expect(acPlugin.contributes.subagents?.[0]).toBe(sub);
    expect(sub.name).toBe('ac-audit');
    // Registration has to be the manifest path: `registerEntityModule` knows the
    // entity slot alone, so a subagent registered that way would never exist.
    expect(acPlugin.contributes.entities?.map((e) => e.type)).toEqual(['ac']);
  });

  it('[ac:ac-subagentsfor-chat-zwraca-ac-audit-tur] is offered in chat turns and in no other', () => {
    expect(subagentsFor('chat', hostWith([sub])).map((s) => s.name)).toContain('ac-audit');
    // brief composes a release diff and patch/ask work a different entry point; an
    // auditor there costs a whole delegated turn to answer a question nobody asked.
    for (const ct of ['brief', 'patch', 'ask'] as const) {
      expect(subagentsFor(ct, hostWith([sub])).map((s) => s.name)).not.toContain('ac-audit');
    }
  });

  it('[ac:ac-tools-subagenta-ac-audit-po-sanitizac] keeps its six reads through the sanitizer and holds nothing mutating', () => {
    // Passing the REAL contribution through the REAL resolver is the point: a hand-read
    // of the array would not prove the sanitizer agrees with it.
    const [def] = resolvePluginSubagents({
      contextType: 'chat',
      contributions: [sub],
      hasSkillSlug: () => true,
      taken: new Set(['spec-explore']),
      warn: () => {},
    });
    expect(def.tools).toEqual(sub.tools);
    expect(def.tools).toHaveLength(6);
    // In particular the envelope's own tool: `analyze_ac_against_entities` is read-only
    // and must not be mistaken for a mutation on the strength of being a custom server.
    expect(def.tools).toContain('mcp__ac-tools__analyze_ac_against_entities');
    for (const tool of def.tools ?? []) {
      expect(NON_DELEGABLE_TOOLS).not.toContain(tool);
      expect(isMutatingMcpTool(tool)).toBe(false);
    }
  });

  it('lands inside the model, effort and turn bounds with no correction', () => {
    // `model` reaches the SDK verbatim, so an out-of-enum value would reject the whole
    // entry; `maxTurns` above 20 would be silently clamped. Neither happens here.
    const [def] = resolvePluginSubagents({
      contextType: 'chat',
      contributions: [sub],
      hasSkillSlug: () => true,
      taken: new Set(['spec-explore']),
      warn: () => {},
    });
    expect(def.model).toBe('sonnet');
    expect(def.effort).toBe('medium');
    expect(def.maxTurns).toBe(12);
    expect(sub.maxTurns).toBe(def.maxTurns);
    // No skills slot: four remit rules and three exclusions fit in the body, and a
    // skill file would be a second place for them to drift.
    expect(sub.attachInternalSkills).toBeUndefined();
    expect(def.skills).toBeUndefined();
  });

  it('carries the remit in its body and leaves the mechanics to the host frame', () => {
    // The four checks and the three exclusions are the orientation only this envelope
    // can supply.
    for (const marker of ['title', 'Sprzeczność AC ↔ AC', 'mNN-edge', 'verifies[]', 'M19']) {
      expect(sub.promptBody).toContain(marker);
    }
    // The cost contract — verdicts up, bulk stays here — is why the delegation pays.
    expect(sub.promptBody).toContain('analyze_ac_against_entities');
    // Mechanics the host frame owns. Restating them here is the failure mode.
    expect(sub.promptBody).not.toContain('truncated: true');
    expect(sub.promptBody).not.toContain('NEVER mutate');
    expect(sub.promptBody).not.toContain('Agent/Task');
  });

  it('routes on a description that also says when NOT to pick it', () => {
    // `description` is the whole routing surface and the host never rewrites it. The
    // neighbouring question — where the criteria ARE — belongs to a spec explorer.
    expect(sub.description).toContain('spec-explore');
    expect(sub.description.toLowerCase()).toContain('read-only');
    expect(['spec-explore', 'diff-explore']).not.toContain(sub.name);
  });
});
