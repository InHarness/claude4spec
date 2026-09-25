import { describe, expect, it } from 'vitest';
import { entityRouteHref } from './entityRouteHref.js';

const PREFIXES = ['/endpoints', '/acs'];

describe('entityRouteHref', () => {
  it('recognises a project-relative entity route', () => {
    expect(entityRouteHref('/endpoints/get-users', PREFIXES, 'http://h')).toBe('/endpoints/get-users');
  });

  it('keeps query and hash, accepts a same-origin absolute URL', () => {
    expect(entityRouteHref('http://h/acs?tag=m05#x', PREFIXES, 'http://h')).toBe('/acs?tag=m05#x');
  });

  it('ignores other paths, prefix look-alikes and foreign origins', () => {
    expect(entityRouteHref('/settings', PREFIXES, 'http://h')).toBeNull();
    expect(entityRouteHref('/endpointsx/a', PREFIXES, 'http://h')).toBeNull();
    expect(entityRouteHref('https://example.com/endpoints/a', PREFIXES, 'http://h')).toBeNull();
    expect(entityRouteHref('mailto:a@b.c', PREFIXES, 'http://h')).toBeNull();
  });
});
