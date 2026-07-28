import { describe, expect, it } from 'vitest';
import { releasesService } from './releases-service.js';
import { PLUGIN_RUNTIME_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';

describe('releasesService / useReleases (M17/L11)', () => {
  it('[ac:ac-hook-usereleases-re-eksportowany-z] exposes releasesService + useReleases on the plugin runtime surface', () => {
    expect(PLUGIN_RUNTIME_EXPORT_NAMES).toContain('releasesService');
    expect(PLUGIN_RUNTIME_EXPORT_NAMES).toContain('useReleases');
  });

  it('is strictly read-only — no create / update / assign path reaches plugins', () => {
    expect(Object.keys(releasesService)).toEqual(['listReleases']);
    for (const forbidden of ['create', 'createRelease', 'update', 'updateRelease', 'restore', 'assign']) {
      expect(releasesService).not.toHaveProperty(forbidden);
    }
  });
});
