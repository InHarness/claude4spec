import { describe, expect, it } from 'vitest';
import { sectionDeepLink } from './widget.js';

describe('sectionDeepLink — the "copy link" action at a heading', () => {
  it('keeps the project basepath, so the link does not land on the server redirect', () => {
    expect(sectionDeepLink('http://localhost:4508', 'abc123def456', '/space/pages/modules/auth.md', 'q3v8n1zt')).toBe(
      'http://localhost:4508/p/abc123def456/space/pages/modules/auth.md#anchor-q3v8n1zt',
    );
  });

  it('addresses a plan by its own route, not as a page', () => {
    expect(sectionDeepLink('http://h', 'abc123def456', '/plans/2026-09-17-x.md', 'b5h2w9rc')).toBe(
      'http://h/p/abc123def456/plans/2026-09-17-x.md#anchor-b5h2w9rc',
    );
  });

  it('has no basepath outside a project', () => {
    expect(sectionDeepLink('http://h', '', '/pages/a.md', 'x7k2m9p4')).toBe('http://h/pages/a.md#anchor-x7k2m9p4');
  });
});
