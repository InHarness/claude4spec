import { describe, expect, it } from 'vitest';
import type { ConfigPatch, ConfigResponse } from '../../lib/api.js';
import { needsOnboarding, skipOnboarding, submitOnboarding, type OnboardingForm } from './onboardingFlow.js';

/**
 * M16 — the onboarding submits, driven through fakes of the effects they are
 * wired to in `OnboardingPage` (rename route, config re-read, PATCH, router).
 */

const base = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
const adr = { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false };

function config(over: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    name: 'demo',
    roots: [base, adr],
    configHash: 'hash-1',
    writingStyle: null,
    language: null,
    onboarding: { completed: false },
    ...over,
  } as unknown as ConfigResponse;
}

const form = (over: Partial<OnboardingForm> = {}): OnboardingForm => ({
  name: '  My spec ',
  writingStyle: 'concise',
  language: 'English',
  conversationalLanguage: 'Polski',
  pagesDir: 'pages',
  rootId: 'pages',
  ...over,
});

function harness(cfg: ConfigResponse, opts: { renameFails?: string; afterRename?: ConfigResponse } = {}) {
  const calls = {
    renames: [] as Array<{ rootId: string; newId: string; expectedConfigHash: string }>,
    patches: [] as ConfigPatch[],
    navigations: [] as string[],
    refetches: 0,
  };
  const deps = {
    config: cfg,
    renameRoot: async (input: { rootId: string; newId: string; expectedConfigHash: string }) => {
      calls.renames.push(input);
      if (opts.renameFails) throw new Error(opts.renameFails);
      return {};
    },
    refetchConfig: async () => {
      calls.refetches++;
      return opts.afterRename ?? cfg;
    },
    patchConfig: async (body: ConfigPatch) => {
      calls.patches.push(body);
      return {};
    },
    navigate: (to: '/') => {
      calls.navigations.push(to);
    },
  };
  return { deps, calls };
}

describe('onboarding [Continue] (M16)', () => {
  it('[ac:ac-continue-z-waznym-formularzem-wysyla] sends ONE request with name, writingStyle, language, agent.conversationalLanguage and onboardingCompleted, then redirects to /', async () => {
    const { deps, calls } = harness(config());
    const result = await submitOnboarding(form(), deps);

    expect(result).toEqual({ ok: true });
    expect(calls.patches).toHaveLength(1);
    expect(calls.patches[0]).toEqual({
      name: 'My spec',
      writingStyle: 'concise',
      language: 'English',
      agent: { conversationalLanguage: 'Polski' },
      onboardingCompleted: true,
    });
    expect(calls.renames).toEqual([]);
    expect(calls.navigations).toEqual(['/']);

    // `roots` is the optional member: it rides in the SAME body when the directory changed.
    const changed = harness(config());
    await submitOnboarding(form({ pagesDir: 'spec' }), changed.deps);
    expect(changed.calls.patches).toHaveLength(1);
    expect(changed.calls.patches[0]).toMatchObject({ onboardingCompleted: true, name: 'My spec', roots: expect.any(Array) });
  });

  it('[ac:ac-continue-ze-zmienionym-dir-builtin-ro] a changed base-root dir sends the full roots[] with only the builtin entry swapped; an untouched section omits roots', async () => {
    const changed = harness(config());
    await submitOnboarding(form({ pagesDir: ' spec ' }), changed.deps);
    expect(changed.calls.patches[0]!.roots).toEqual([{ ...base, dir: 'spec' }, adr]);

    const untouched = harness(config());
    await submitOnboarding(form(), untouched.deps);
    expect('roots' in untouched.calls.patches[0]!).toBe(false);
  });

  it('[ac:ac-w-sekcji-advanced-onboardingu-mozna-z] "Advanced" can change only the base root id — a rename with the read token, and no roots in the PATCH, so the dir stays', async () => {
    const renamed = config({ roots: [{ ...base, id: 'docs' }, adr], configHash: 'hash-2' } as Partial<ConfigResponse>);
    const { deps, calls } = harness(config(), { afterRename: renamed });
    const result = await submitOnboarding(form({ rootId: 'docs' }), deps);

    expect(result).toEqual({ ok: true });
    expect(calls.renames).toEqual([{ rootId: 'pages', newId: 'docs', expectedConfigHash: 'hash-1' }]);
    // The PATCH is composed from the re-read config: the dir did not change, so no `roots`.
    expect(calls.refetches).toBe(1);
    expect(calls.patches).toHaveLength(1);
    expect('roots' in calls.patches[0]!).toBe(false);
  });

  it('[ac:ac-odmowa-przemianowania-na-continue-zos] a refused rename sends no onboardingCompleted and keeps the user on the form, the message under Root ID', async () => {
    const { deps, calls } = harness(config(), { renameFails: "identifier 'adr' is already used by the root 'ADRs'" });
    const result = await submitOnboarding(form({ rootId: 'adr' }), deps);

    expect(result).toEqual({ ok: false, rootIdError: "identifier 'adr' is already used by the root 'ADRs'" });
    expect(calls.patches).toEqual([]);
    expect(calls.navigations).toEqual([]);
  });
});

describe('onboarding [Skip] (M16)', () => {
  it('[ac:ac-skip-otwiera-confirmmodal-a-po-potwie] asks the ConfirmModal first, then sends only onboardingCompleted and redirects to /', async () => {
    const patches: ConfigPatch[] = [];
    const navigations: string[] = [];
    let asked = 0;
    const deps = (answer: boolean) => ({
      confirm: async () => {
        asked++;
        return answer;
      },
      patchConfig: async (body: ConfigPatch) => {
        patches.push(body);
      },
      navigate: (to: '/') => {
        navigations.push(to);
      },
    });

    // Cancelled: nothing is sent.
    expect(await skipOnboarding(deps(false))).toBe(false);
    expect(asked).toBe(1);
    expect(patches).toEqual([]);

    expect(await skipOnboarding(deps(true))).toBe(true);
    expect(patches).toEqual([{ onboardingCompleted: true }]);
    for (const k of ['name', 'writingStyle', 'language', 'agent']) expect(k in patches[0]!).toBe(false);
    expect(navigations).toEqual(['/']);
  });

  it('[ac:ac-skip-nie-wysyla-roots-dir-builtin-roo] sends neither roots nor a rename', async () => {
    const patches: ConfigPatch[] = [];
    await skipOnboarding({
      confirm: async () => true,
      patchConfig: async (body) => {
        patches.push(body);
      },
      navigate: () => {},
    });
    // The only request Skip makes is this PATCH — there is no rename dependency to call at all.
    expect(patches).toHaveLength(1);
    expect('roots' in patches[0]!).toBe(false);
  });
});

describe('onboarding gate (M16)', () => {
  it('[ac:ac-po-domknieciu-onboardingu-odczyt-konf] once onboarding.completed is true the shell renders instead of redirecting to /onboarding', () => {
    expect(needsOnboarding({ onboarding: { completed: false } })).toBe(true);
    expect(needsOnboarding({ onboarding: { completed: true } })).toBe(false);
  });

  it('[ac:ac-projekt-sprzed-m16-ktorego-config-nie] the config of a project without onboardingCompleted (served as completed: true) does not redirect', () => {
    // The server derives `completed: true` from the absent key (config.route.test.ts);
    // the gate keys on that derived flag alone.
    expect(needsOnboarding(config({ onboarding: { completed: true } }))).toBe(false);
  });
});
