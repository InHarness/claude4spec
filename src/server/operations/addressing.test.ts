import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  EXPLICIT_ADDRESSING_RULE,
  OWNER_THREAD_ISOLATION,
  addressingParam,
  addressingParamShape,
  artifactAddressingShape,
  ownerDeclaresThreadIsolation,
} from './addressing.js';
import type { ChannelName } from './catalog.js';
import type { ArtifactKind } from '../services/artifact-registry.js';

/**
 * 2.1.13 — M43 `explicit-addressing` with its isolation exception (bpejzx03).
 * The rule decides the addressing parameter's shape per channel; the owner of
 * an artifact kind switches the exception on by declaring thread isolation.
 */

const EXTERNAL: ChannelName[] = ['cli', 'mcp', 'rest'];
const KINDS: ArtifactKind[] = ['brief', 'patch', 'plan'];

describe('M43 explicit-addressing — isolation exception (2.1.13)', () => {
  it('[section:bpejzx03] external channels always require the address, with or without an isolation declaration', () => {
    for (const channel of EXTERNAL) {
      expect(addressingParamShape(channel, false), channel).toBe('required');
      expect(addressingParamShape(channel, true), channel).toBe('required');
    }
  });

  it('[section:bpejzx03] internal channel: optional (not absent) by default, absent under the isolation exception', () => {
    expect(addressingParamShape('internal', false)).toBe('optional');
    expect(addressingParamShape('internal', true)).toBe('absent');
  });

  it('[section:bpejzx03] the exception fires only on an owner declaration: no declaration means an optional internal address', () => {
    const declared = { plan: 'M10 — the thread sees only the plan pinned to it' } as const;
    expect(ownerDeclaresThreadIsolation('plan', declared)).toBe(true);
    expect(artifactAddressingShape('plan', 'internal', declared)).toBe('absent');
    expect(artifactAddressingShape('plan', 'mcp', declared)).toBe('required');
    expect(artifactAddressingShape('plan', 'rest', declared)).toBe('required');
    // Undeclared kinds keep the default.
    expect(ownerDeclaresThreadIsolation('patch', declared)).toBe(false);
    expect(artifactAddressingShape('patch', 'internal', declared)).toBe('optional');
    expect(artifactAddressingShape('brief', 'internal', declared)).toBe('optional');
    // An empty citation is not a declaration.
    expect(ownerDeclaresThreadIsolation('plan', { plan: '' })).toBe(false);
    // In this release's process-wide table only M10 declares isolation (plans,
    // m10mcp00): the plan's internal address is absent, the other kinds keep the
    // default.
    expect(Object.keys(OWNER_THREAD_ISOLATION)).toEqual(['plan']);
    expect(artifactAddressingShape('plan', 'internal')).toBe('absent');
    expect(artifactAddressingShape('brief', 'internal')).toBe('optional');
    expect(artifactAddressingShape('patch', 'internal')).toBe('optional');
    for (const kind of KINDS) {
      for (const channel of EXTERNAL) expect(artifactAddressingShape(kind, channel), `${kind}/${channel}`).toBe('required');
    }
  });

  it('[section:bpejzx03] the rendering follows the shape: required keeps the param, optional makes it omittable, absent drops it from the schema', () => {
    const base = z.string();
    const required = z.object(addressingParam('path', 'required', base));
    expect(required.safeParse({}).success).toBe(false);
    expect(required.safeParse({ path: 'a.md' }).success).toBe(true);

    const optional = z.object(addressingParam('path', 'optional', base));
    expect(optional.safeParse({}).success).toBe(true);
    expect(optional.safeParse({ path: 'a.md' }).success).toBe(true);
    expect(Object.keys(optional.shape)).toEqual(['path']);

    const absent = addressingParam('path', 'absent', base);
    expect(absent).toEqual({});
    expect(Object.keys(z.object(absent).shape)).not.toContain('path');
  });

  it('[section:bpejzx03] the rule has one stable id that catalog rows cite', () => {
    expect(EXPLICIT_ADDRESSING_RULE).toBe('explicit-addressing');
  });
});
