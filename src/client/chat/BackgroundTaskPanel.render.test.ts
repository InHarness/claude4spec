// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell) — the row of the "Background tasks" block
 * (`6uwqmrut`, render rules `00rsqebq`): the task type is an open union, the
 * status an opaque label with `running` as its only branch, the output file a
 * path that is never a link.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BackgroundTaskPanel } from './BackgroundTaskPanel.js';
import type { BackgroundTaskEntry } from './useChat.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
});

const entry = (over: Partial<BackgroundTaskEntry> = {}): BackgroundTaskEntry => ({
  taskId: 'bg1',
  taskType: 'shell',
  description: 'npm run build',
  status: 'completed',
  outputFile: null,
  summary: null,
  startedAt: null,
  ...over,
});

/** The panel's markup for one entry. */
function html(e: BackgroundTaskEntry): string {
  act(() => root.render(createElement(BackgroundTaskPanel, { entry: e })));
  return host.innerHTML;
}
/** The markup with the status text taken out, to compare everything else. */
const withoutStatus = (e: BackgroundTaskEntry) => html(e).split(`>${e.status}<`).join('><');
const iconClass = (e: BackgroundTaskEntry) => {
  html(e);
  return host.querySelector('svg')?.getAttribute('class') ?? '';
};

describe('background-task row: status', () => {
  it("[ac:ac-jedyna-wartoscia-status-na-ktorej-ren] `running` is the only status value the render branches on — a live task looks different from any other, and all other values look the same", () => {
    const settled = ['completed', 'failed', 'abandoned', 'stopped', 'something-new'].map((status) =>
      withoutStatus(entry({ status })),
    );
    expect(new Set(settled).size).toBe(1);
    expect(withoutStatus(entry({ status: 'running' }))).not.toBe(settled[0]);
    // The live one pulses; no settled one does.
    html(entry({ status: 'running' }));
    expect(host.querySelector('.dot-pulse')).not.toBeNull();
    html(entry({ status: 'failed' }));
    expect(host.querySelector('.dot-pulse')).toBeNull();
  });

  it('[ac:ac-pole-status-zdarzen-rodziny-backgroun] the `status` of a `background_task_*` event renders as an opaque text label — verbatim, with no logic branch and no success or failure colour', () => {
    for (const status of ['success', 'failed', 'killed']) {
      html(entry({ status }));
      const label = [...host.querySelectorAll('span')].find((s) => s.textContent === status);
      expect(label).toBeDefined();
      // Neutral chrome, the same for every value.
      expect(label!.getAttribute('style')).toContain('var(--c-muted)');
      expect(host.innerHTML).not.toMatch(/--c-(green|red)/);
    }
  });

  it('[ac:ac-wartosc-status-pochodzaca-z-kontraktu] a contract `status` value renders as an opaque label — no success/failure colour and no success/failure icon', () => {
    const ok = entry({ status: 'success' });
    const failed = entry({ status: 'failed' });
    // The icon follows the type, never the status.
    expect(iconClass(ok)).toBe(iconClass(failed));
    expect(iconClass(ok)).toContain('lucide-terminal');
    // Nothing else differs between "success" and "failed" but the text.
    expect(withoutStatus(ok)).toBe(withoutStatus(failed));
  });
});

describe('background-task row: task type', () => {
  it('[ac:ac-nieznana-wartosc-tasktype-unia-jest-o] an unknown `taskType` (the union is open) renders through the `default` branch under its own name and does not break the block render', () => {
    expect(() => html(entry({ taskType: 'quantum-batch' }))).not.toThrow();
    expect(host.textContent).toContain('background · quantum-batch');
    expect(iconClass(entry({ taskType: 'quantum-batch' }))).toContain('lucide-cog');
    // The known values keep their own icons.
    expect(iconClass(entry({ taskType: 'shell' }))).toContain('lucide-terminal');
    expect(iconClass(entry({ taskType: 'monitor' }))).toContain('lucide-activity');
    expect(iconClass(entry({ taskType: 'workflow' }))).toContain('lucide-workflow');
  });

  it('[ac:ac-nieznany-task-type-renderuje-sie-neut] an unknown `task_type` renders neutrally — under its own name, with a generic icon — and does not break the block', () => {
    const unknown = entry({ taskType: 'local_agentic_thing', description: 'crunching' });
    const markup = html(unknown);
    expect(host.textContent).toContain('background · local_agentic_thing');
    expect(host.textContent).toContain('crunching');
    expect(iconClass(unknown)).toContain('lucide-cog');
    // Same chrome as a known type: only the name and the icon differ.
    const known = html(entry({ taskType: 'shell', description: 'crunching' }));
    const strip = (m: string) => m.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/background · [a-z_]+/, '');
    expect(strip(markup)).toBe(strip(known));
  });
});

describe('background-task row: output file', () => {
  it('[ac:ac-pole-outputfile-renderuje-sie-jako-ni-2] the `outputFile` field renders as a non-clickable path', () => {
    html(entry({ outputFile: '/tmp/claude/tasks/bg1.output' }));
    const path = [...host.querySelectorAll('div')].find((d) => d.textContent === '/tmp/claude/tasks/bg1.output');
    expect(path).toBeDefined();
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('[role="button"], [role="link"], [href], [tabindex]')).toBeNull();
    expect(path!.getAttribute('onclick')).toBeNull();
  });
});
