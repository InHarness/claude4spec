// @vitest-environment happy-dom
/**
 * 2.1.77 — ui-view `onboarding-page` (M16 `czn353hw`, `r2q6o6vi`, `gipdzz10`;
 * M59 / M60 UI contributions): the onboarding WIZARD. One step per screen, a
 * header with the type's name and `Step <n> of <m>`, `[Skip]` on every step,
 * `[Back]` from the second, `[Next]` until the last, `[Continue]` on the last.
 * The step list comes from the type entry of the config's `projectType`.
 *
 * The hooks are replaced by fakes holding one config read, the writing-style
 * list, the type registry list and the two mutations; the final write and the
 * rename are recorded so the payload can be read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '../../lib/api-core.js';
import { SUPPORTED_LANGUAGES } from '../../../shared/languages.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fx = vi.hoisted(() => ({
  config: null as unknown as Record<string, unknown>,
  afterRename: null as unknown as Record<string, unknown> | null,
  styles: [] as Array<Record<string, unknown>>,
  patches: [] as unknown[],
  renames: [] as unknown[],
  navigations: [] as string[],
  toasts: [] as string[],
  patchImpl: null as null | ((body: unknown) => Promise<unknown>),
  renameImpl: null as null | ((input: unknown) => Promise<unknown>),
  patchPending: false,
  extraTypes: {} as Record<string, unknown>,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (opts: { to: string }) => {
    fx.navigations.push(opts.to);
  },
}));

vi.mock('../../hooks/useConfig.js', () => ({
  useConfig: () => ({
    data: fx.config,
    refetch: async () => ({ data: fx.afterRename ?? fx.config }),
  }),
  usePatchConfig: () => ({
    isPending: fx.patchPending,
    mutateAsync: async (body: unknown) => {
      fx.patches.push(body);
      return fx.patchImpl ? fx.patchImpl(body) : {};
    },
  }),
  useRenameRoot: () => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      fx.renames.push(input);
      return fx.renameImpl ? fx.renameImpl(input) : {};
    },
  }),
}));

vi.mock('../../hooks/useWritingStyles.js', () => ({
  useWritingStyles: () => ({ data: { available: fx.styles } }),
}));

vi.mock('../../hooks/useProjectTypes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useProjectTypes.js')>();
  return {
    ...actual,
    useProjectTypes: () => ({
      data: [
        { slug: 'spec', name: 'Specification', description: 'd' },
        { slug: 'skill', name: 'Skill', description: 'd' },
        { slug: 'writing-style', name: 'Writing Style', description: 'd' },
        { slug: 'replacing-type', name: 'Replacing Type', description: 'd' },
      ],
    }),
  };
});

/** A stand-in entry whose step REPLACES the common `Languages` step (the host has none). */
vi.mock('../../../shared/onboarding-steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/onboarding-steps.js')>();
  return {
    ...actual,
    PROJECT_TYPE_ONBOARDING: {
      ...actual.PROJECT_TYPE_ONBOARDING,
      'replacing-type': {
        typeKeys: ['skill.name', 'skill.description', 'language', 'agent.conversationalLanguage'],
        steps: [
          {
            title: 'Custom languages',
            component: 'skill-details',
            position: { relation: 'after', commonStep: 'Writing style' },
            writes: ['skill.name', 'skill.description', 'language', 'agent.conversationalLanguage'],
            replaces: 'Languages',
          },
        ],
      },
    },
  };
});

vi.mock('../../ui/events.js', () => ({
  openModal: async () => true,
  toast: {
    success: (m: string) => fx.toasts.push(`ok:${m}`),
    error: (m: string) => fx.toasts.push(`err:${m}`),
  },
}));

import { OnboardingPage } from './OnboardingPage.js';

const base = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
const adr = { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false };

function configOf(projectType: string, over: Record<string, unknown> = {}) {
  return {
    name: 'My Project',
    projectType,
    roots: [base, adr],
    configHash: 'hash-1',
    writingStyle: null,
    language: null,
    agent: { conversationalLanguage: null },
    onboarding: { completed: false },
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  fx.config = configOf('spec');
  fx.afterRename = null;
  fx.styles = [
    { slug: 'concise', title: 'Concise', description: 'Short.', source: 'builtin' },
    { slug: 'formal', title: 'Formal', description: 'Formal.', source: 'builtin' },
  ];
  fx.patches = [];
  fx.renames = [];
  fx.navigations = [];
  fx.toasts = [];
  fx.patchImpl = null;
  fx.renameImpl = null;
  fx.patchPending = false;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(projectType = 'spec', over: Record<string, unknown> = {}) {
  fx.config = configOf(projectType, over);
  await act(async () => {
    root.render(createElement(OnboardingPage));
  });
  await flush();
}

const text = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
const stepTitle = () => text('onboarding-step-title');
const progress = () => text('onboarding-progress');
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;
const stepEl = () => host.querySelector('[data-testid="onboarding-step"]')!;
const field = <T extends Element = HTMLInputElement>(name: string) => stepEl().querySelector<T & Element>(`[name="${name}"]`);

async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

async function type(el: Element | null, value: string) {
  expect(el).not.toBeNull();
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  await flush();
}

const styleCard = (title: string) =>
  Array.from(stepEl().querySelectorAll('label')).find((l) => l.textContent?.includes(title)) ?? null;

/** Walks the wizard to the end, recording every step title on the way. */
async function walk(): Promise<string[]> {
  const titles = [stepTitle()];
  for (let guard = 0; guard < 10 && button('Next'); guard++) {
    if (stepTitle() === 'Writing style') await click(styleCard('Concise'));
    // Any step built on the detail-step component (incl. the stand-in replacing step).
    if (field('skill.description')) await type(field<HTMLTextAreaElement>('skill.description'), 'A description.');
    await click(button('Next'));
    titles.push(stepTitle());
  }
  return titles;
}

describe('onboarding wizard — composition by project type (M16 / L19)', () => {
  it('[ac:ac-w-projekcie-typu-spec-kreator-onboard] a spec project shows only the four common steps, in order', async () => {
    await render('spec');
    expect(await walk()).toEqual(['Project name', 'Writing style', 'Languages', 'Pages directory']);
    expect(button('Continue')).not.toBeNull();
  });

  it('[ac:ac-onboarding-projektu-typu-specyfikacja] onboarding of a Specification project shows the common steps only', async () => {
    await render('spec');
    const titles = await walk();
    expect(titles).toHaveLength(4);
    expect(titles).not.toContain('Skill details');
    expect(titles).not.toContain('Style details');
  });

  it('[ac:ac-w-projekcie-typu-skill-kreator-onboar] a skill project shows Skill details directly after Project name', async () => {
    await render('skill');
    const titles = await walk();
    expect(titles.slice(0, 2)).toEqual(['Project name', 'Skill details']);
    expect(titles).toEqual(['Project name', 'Skill details', 'Writing style', 'Languages', 'Pages directory']);
  });

  it('[ac:ac-onboarding-projektu-typu-skill-pokazu] onboarding of a Skill project shows Skill details with the skill name and description fields', async () => {
    await render('skill');
    await click(button('Next'));
    expect(stepTitle()).toBe('Skill details');
    expect(stepEl().textContent).toContain('Other projects of this workspace will see this skill by its name and description.');
    expect(stepEl().textContent).toContain('Skill name');
    expect(stepEl().textContent).toContain('Skill description');
    // The name is pre-filled with the project name in kebab-case; the description is a textarea.
    expect(field('skill.name')!.value).toBe('my-project');
    expect(field('skill.description')!.tagName).toBe('TEXTAREA');
  });

  it('[ac:ac-w-projekcie-typu-writing-style-kreato] a writing-style project shows Style details directly after Project name', async () => {
    await render('writing-style');
    const titles = await walk();
    expect(titles.slice(0, 2)).toEqual(['Project name', 'Style details']);
  });

  it('[ac:ac-onboarding-projektu-typu-writing-styl] onboarding of a Writing Style project shows Style details with the style name and description fields', async () => {
    await render('writing-style');
    await click(button('Next'));
    expect(stepTitle()).toBe('Style details');
    expect(stepEl().textContent).toContain('Other projects of this workspace will pick this style by its name and description.');
    expect(stepEl().textContent).toContain('Style name');
    expect(stepEl().textContent).toContain('Style description');
    expect(field('skill.name')!.value).toBe('my-project');
    expect(field('skill.description')!.tagName).toBe('TEXTAREA');
  });

  it('[ac:ac-krok-typu-ktory-we-wpisie-typu-deklar] a type step declaring the replacement of a common step stands in its place and the common step is not shown', async () => {
    await render('replacing-type');
    const titles = await walk();
    expect(titles).toEqual(['Project name', 'Writing style', 'Custom languages', 'Pages directory']);
    expect(titles).not.toContain('Languages');
  });

  it('[ac:ac-naglowek-kreatora-onboardingu-pokazuj] the wizard header shows the name of the current project type from its registry entry', async () => {
    await render('skill');
    expect(text('onboarding-type-name')).toBe('Skill');
    act(() => root.unmount());
    root = createRoot(host);
    await render('writing-style');
    expect(text('onboarding-type-name')).toBe('Writing Style');
  });

  it('[ac:ac-wskaznik-postepu-kreatora-onboardingu] the progress indicator shows the current step number and the count of all steps, type steps included', async () => {
    await render('skill');
    expect(progress()).toBe('Step 1 of 5');
    await click(button('Next'));
    expect(progress()).toBe('Step 2 of 5');
    act(() => root.unmount());
    root = createRoot(host);
    await render('spec');
    expect(progress()).toBe('Step 1 of 4');
  });
});

describe('onboarding wizard — step validation and navigation (M16)', () => {
  it('[ac:ac-krok-skill-details-nie-pozwala-przejs] Skill details does not let the user go on with a skill name outside kebab-case', async () => {
    await render('skill');
    await click(button('Next'));
    await type(field<HTMLTextAreaElement>('skill.description'), 'Does things.');
    expect(button('Next')!.disabled).toBe(false);
    await type(field('skill.name'), 'Not Kebab');
    expect(stepEl().textContent).toContain('Use lowercase letters, digits and hyphens.');
    expect(button('Next')!.disabled).toBe(true);
    await click(button('Next'));
    expect(stepTitle()).toBe('Skill details');
  });

  it('[ac:ac-krok-style-details-nie-pozwala-przejs] Style details does not let the user go on with an empty style description', async () => {
    await render('writing-style');
    await click(button('Next'));
    expect(field<HTMLTextAreaElement>('skill.description')!.value).toBe('');
    expect(stepEl().textContent).toContain('Add a description so authors know what this style is for.');
    expect(button('Next')!.disabled).toBe(true);
    await type(field<HTMLTextAreaElement>('skill.description'), '   ');
    expect(button('Next')!.disabled).toBe(true);
    await type(field<HTMLTextAreaElement>('skill.description'), 'Plain words.');
    expect(button('Next')!.disabled).toBe(false);
  });

  it('[ac:ac-stan-startowy-formularza-onboardingu] at the start of the Writing style step no style card is selected and [Next] is disabled', async () => {
    await render('spec');
    await click(button('Next'));
    expect(stepTitle()).toBe('Writing style');
    const radios = Array.from(stepEl().querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.length).toBe(3); // two styles + "None — I'll choose later"
    expect(radios.some((r) => r.checked)).toBe(false);
    expect(button('Next')!.disabled).toBe(true);
  });

  it('[ac:ac-klikniecie-karty-stylu-zaznacza-ja-ra] clicking a style card selects it radio-style and enables [Next] of the Writing style step', async () => {
    await render('spec');
    await click(button('Next'));
    await click(styleCard('Concise'));
    const checked = () =>
      Array.from(stepEl().querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.checked).map((r) => r.value);
    expect(checked()).toEqual(['concise']);
    expect(button('Next')!.disabled).toBe(false);
    await click(styleCard('Formal'));
    expect(checked()).toEqual(['formal']);
  });

  it('[ac:ac-oba-dropdowny-jezykowe-renderuja-supp] both Languages dropdowns render SUPPORTED_LANGUAGES plus None (default null) and left on None do not block [Next]', async () => {
    await render('spec');
    await click(button('Next'));
    await click(styleCard('Concise'));
    await click(button('Next'));
    expect(stepTitle()).toBe('Languages');
    const selects = Array.from(stepEl().querySelectorAll('select'));
    expect(selects).toHaveLength(2);
    for (const s of selects) {
      const options = Array.from(s.options).map((o) => o.textContent);
      expect(options).toEqual(['None', ...SUPPORTED_LANGUAGES]);
      expect(s.value).toBe('');
    }
    expect(button('Next')!.disabled).toBe(false);
  });

  it('[ac:ac-przejscie-back-na-wczesniejszy-krok-k] [Back] to an earlier step and [Next] again keeps the values typed in both steps', async () => {
    await render('skill');
    await type(field('name'), 'Renamed Project');
    await click(button('Next'));
    await type(field('skill.name'), 'custom-skill');
    await type(field<HTMLTextAreaElement>('skill.description'), 'Kept description.');
    await click(button('Back'));
    expect(stepTitle()).toBe('Project name');
    expect(field('name')!.value).toBe('Renamed Project');
    await click(button('Next'));
    expect(stepTitle()).toBe('Skill details');
    expect(field('skill.name')!.value).toBe('custom-skill');
    expect(field<HTMLTextAreaElement>('skill.description')!.value).toBe('Kept description.');
  });

  it('[ac:ac-zwijana-sekcja-advanced-directory-ren] the Pages directory step renders exactly two fields — the base root dir and id, both pre-filled — and no user-root or artefact-dir field', async () => {
    await render('spec', { roots: [{ ...base, id: 'docs', dir: 'spec-pages' }, adr] });
    await walk();
    expect(stepTitle()).toBe('Pages directory');
    const inputs = Array.from(stepEl().querySelectorAll('input, select, textarea'));
    expect(inputs.map((i) => i.getAttribute('name'))).toEqual(['pagesDir', 'rootId']);
    expect(field('pagesDir')!.value).toBe('spec-pages');
    expect(field('rootId')!.value).toBe('docs');
    expect(stepEl().textContent).toContain('Keep the defaults unless you have a reason to change them.');
    // The one-screen form's collapsible "Advanced" section is gone.
    expect(host.querySelector('details')).toBeNull();
    expect(host.textContent).not.toContain('Advanced');
  });

  it('[ui:onboarding-page] [Skip] is on every step and [Back] only from the second step', async () => {
    await render('skill');
    expect(button('Back')).toBeNull();
    for (let i = 0; i < 5; i++) {
      expect(button('Skip')).not.toBeNull();
      if (i > 0) expect(button('Back')).not.toBeNull();
      if (!button('Next')) break;
      if (stepTitle() === 'Writing style') await click(styleCard('Concise'));
      if (stepTitle() === 'Skill details') await type(field<HTMLTextAreaElement>('skill.description'), 'x');
      await click(button('Next'));
    }
    expect(button('Continue')).not.toBeNull();
    expect(button('Next')).toBeNull();
  });
});

describe('onboarding wizard — final write (M16 r2q6o6vi)', () => {
  it('[ac:ac-continue-z-waznym-formularzem-wysyla] [Continue] on the last step sends one atomic request with name, writingStyle, language, agent.conversationalLanguage and onboardingCompleted, then redirects to /', async () => {
    await render('spec');
    await walk();
    await click(button('Continue'));
    expect(fx.patches).toEqual([
      {
        name: 'My Project',
        writingStyle: 'concise',
        language: null,
        agent: { conversationalLanguage: null },
        onboardingCompleted: true,
      },
    ]);
    expect(fx.navigations).toEqual(['/']);
  });

  it('[ac:ac-wartosci-skill-name-i-skill-descripti] skill.name and skill.description typed in the type step ride the same single PATCH as the common values', async () => {
    await render('skill');
    await walk();
    await click(button('Continue'));
    expect(fx.patches).toHaveLength(1);
    expect(fx.patches[0]).toEqual({
      name: 'My Project',
      writingStyle: 'concise',
      language: null,
      agent: { conversationalLanguage: null },
      skill: { name: 'my-project', description: 'A description.' },
      onboardingCompleted: true,
    });
  });

  it('[ac:ac-w-sekcji-advanced-onboardingu-mozna-z] in the Pages directory step only the base root id can be changed, leaving its directory unchanged', async () => {
    fx.afterRename = configOf('spec', { roots: [{ ...base, id: 'docs' }, adr], configHash: 'hash-2' });
    await render('spec');
    await walk();
    await type(field('rootId'), 'docs');
    await click(button('Continue'));
    expect(fx.renames).toEqual([{ rootId: 'pages', newId: 'docs', expectedConfigHash: 'hash-1' }]);
    expect(fx.patches).toHaveLength(1);
    expect('roots' in (fx.patches[0] as object)).toBe(false);
  });

  it('[ac:ac-continue-ze-zmienionym-dir-builtin-ro] a changed base-root directory sends the full roots[] with only the builtin entry swapped; untouched fields omit roots', async () => {
    await render('spec');
    await walk();
    await type(field('pagesDir'), 'spec');
    await click(button('Continue'));
    expect((fx.patches[0] as { roots: unknown }).roots).toEqual([{ ...base, dir: 'spec' }, adr]);
  });

  it('[ac:ac-odmowa-przemianowania-na-continue-zos] a refused rename leaves onboardingCompleted unchanged and the wizard on Pages directory with the message under the identifier field', async () => {
    fx.renameImpl = async () => {
      throw new Error("identifier 'adr' is already used by the root 'ADRs'");
    };
    await render('spec');
    await walk();
    await type(field('rootId'), 'adr');
    await click(button('Continue'));
    expect(fx.patches).toEqual([]);
    expect(fx.navigations).toEqual([]);
    expect(stepTitle()).toBe('Pages directory');
    const idField = field('rootId')!.closest('div')!;
    expect(idField.textContent).toContain("identifier 'adr' is already used by the root 'ADRs'");
  });

  it('[ac:ac-odmowa-koncowego-zapisu-wskazujaca-kl] a refusal of the final write naming a Languages key moves the wizard to Languages with the message under that field', async () => {
    fx.patchImpl = async () => {
      throw new ApiError('VALIDATION', 'agent.conversationalLanguage must be a supported language', 400, {
        code: 'VALIDATION',
        message: 'agent.conversationalLanguage must be a supported language',
        details: { field: 'agent.conversationalLanguage' },
      });
    };
    await render('spec');
    await walk();
    expect(stepTitle()).toBe('Pages directory');
    await click(button('Continue'));
    expect(stepTitle()).toBe('Languages');
    const selects = Array.from(stepEl().querySelectorAll('select'));
    // The message sits under the conversation-language dropdown (the second), not under the first.
    expect(selects[1]!.parentElement!.textContent).toContain('agent.conversationalLanguage must be a supported language');
    expect(selects[0]!.parentElement!.textContent).not.toContain('must be a supported language');
    expect(fx.navigations).toEqual([]);
  });

  it('[ac:ac-odmowa-koncowego-zapisu-wskazujaca-sk] a refusal of the final write naming skill.name moves the wizard to Skill details with the message under Skill name', async () => {
    fx.patchImpl = async () => {
      throw new ApiError('VALIDATION', 'skill.name "x" is taken', 400, {
        code: 'VALIDATION',
        message: 'skill.name "x" is taken',
        details: { field: 'skill.name' },
      });
    };
    await render('skill');
    await walk();
    await click(button('Continue'));
    expect(stepTitle()).toBe('Skill details');
    expect(field('skill.name')!.parentElement!.textContent).toContain('skill.name "x" is taken');
    expect(field<HTMLTextAreaElement>('skill.description')!.parentElement!.textContent).not.toContain('is taken');
    // The other steps keep their values.
    expect(field<HTMLTextAreaElement>('skill.description')!.value).toBe('A description.');
    expect(fx.navigations).toEqual([]);
  });
});

describe('onboarding-page states', () => {
  it('[ui:onboarding-page#saving] while the final write is in flight [Continue] shows Saving... and is disabled; [Back] and [Skip] are disabled', async () => {
    await render('spec');
    await walk();
    fx.patchPending = true;
    await act(async () => {
      root.render(createElement(OnboardingPage));
    });
    await flush();
    expect(button('Saving...')).not.toBeNull();
    expect(button('Saving...')!.disabled).toBe(true);
    expect(button('Back')!.disabled).toBe(true);
    expect(button('Skip')!.disabled).toBe(true);
  });

  it('[ui:onboarding-page#no-styles] with no selectable styles the Writing style step shows only the None card with its note, and saving without a style works', async () => {
    fx.styles = [];
    await render('spec');
    await click(button('Next'));
    expect(stepEl().querySelectorAll('input[type="radio"]').length).toBe(1);
    expect(stepEl().textContent).toContain("None — I'll choose later");
    expect(stepEl().textContent).toContain('No writing styles available in this build.');
    await click(styleCard('None'));
    await click(button('Next'));
    await click(button('Next'));
    await click(button('Continue'));
    expect((fx.patches[0] as { writingStyle: unknown }).writingStyle).toBeNull();
  });

  it('[ui:onboarding-page#save-error] a refusal for a key leaves the wizard on the step collecting it, values of other steps kept, onboarding not closed', async () => {
    fx.patchImpl = async () => {
      throw new ApiError('VALIDATION', 'Project name must be 1–80 characters', 400, {
        code: 'VALIDATION',
        message: 'Project name must be 1–80 characters',
        details: { field: 'name' },
      });
    };
    await render('spec');
    await walk();
    await click(button('Continue'));
    expect(stepTitle()).toBe('Project name');
    expect(stepEl().textContent).toContain('Project name must be 1–80 characters');
    expect(fx.navigations).toEqual([]);
    await click(button('Next'));
    // The style picked before the refusal is still selected.
    const checked = Array.from(stepEl().querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.checked);
    expect(checked.map((r) => r.value)).toEqual(['concise']);
  });
});
