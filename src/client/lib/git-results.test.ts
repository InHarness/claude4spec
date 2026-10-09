/**
 * 2.1.10 (M28 8i5qf0xx "Okna" toast table, 846dmtbu "Stany") — the outcome of
 * every checkout / fetch / sync result in the header branch switcher.
 */
import { describe, expect, it } from 'vitest';
import {
  BUSY_HINT,
  DIRTY_CHECKOUT_HINT,
  checkoutOutcome,
  fetchOutcome,
  lastFetchedLine,
  syncCount,
  syncOutcome,
} from './git-results.js';

const sync = (over: Partial<Parameters<typeof syncOutcome>[0]>) =>
  syncOutcome({ status: 'up-to-date', paths: null, reason: null, message: null, ...over });
const fetchR = (over: Partial<Parameters<typeof fetchOutcome>[0]>) =>
  fetchOutcome({ status: 'fetched', ahead: 0, behind: 0, message: null, ...over });

describe('fetch results', () => {
  it('fetched with behind = 0 → "Already up to date"; behind > 0 → "{N} new commits on the remote"', () => {
    expect(fetchR({ behind: 0 }).toast).toEqual({ variant: 'success', message: 'Already up to date' });
    expect(fetchR({ behind: 4 }).toast).toEqual({ variant: 'success', message: '4 new commits on the remote' });
  });
  it('error → error toast with git\'s message; busy → entry hint, no toast', () => {
    expect(fetchR({ status: 'error', message: 'Could not resolve host' }).toast).toEqual({
      variant: 'error',
      message: 'Could not resolve host',
    });
    expect(fetchR({ status: 'busy', ahead: null, behind: null })).toEqual({ entryHint: BUSY_HINT });
  });
});

describe('sync results', () => {
  it('up-to-date → success toast, no reload', () => {
    expect(sync({})).toEqual({ toast: { variant: 'success', message: 'Already up to date' } });
  });
  it('fast-forwarded and merged → reload with "Updated from the remote"', () => {
    for (const status of ['fast-forwarded', 'merged'] as const) {
      expect(sync({ status })).toEqual({
        toast: { variant: 'success', message: 'Updated from the remote' },
        reload: true,
      });
    }
  });
  it('refusals are warning toasts with the spec texts', () => {
    expect(sync({ status: 'dirty-blocked', paths: ['a', 'b', 'c'] }).toast).toEqual({
      variant: 'warning',
      message: 'Commit your local changes to 3 files before syncing',
    });
    expect(sync({ status: 'diverged', reason: 'conflicts', paths: ['a', 'b'] }).toast).toEqual({
      variant: 'warning',
      message: 'Your branch and the remote have conflicting changes in 2 files — resolve them in a terminal',
    });
    expect(sync({ status: 'diverged', reason: 'releases-on-both-sides' }).toast).toEqual({
      variant: 'warning',
      message: 'New releases exist both locally and on the remote — sync in a terminal',
    });
  });
  it('error → error toast; busy → entry hint', () => {
    expect(sync({ status: 'error', message: 'fatal: boom' }).toast).toEqual({ variant: 'error', message: 'fatal: boom' });
    expect(sync({ status: 'busy' })).toEqual({ entryHint: BUSY_HINT });
  });
});

describe('checkout results', () => {
  it('dirty-blocked → hint in the list; busy → hint at the entry; not-found → "Branch no longer exists"', () => {
    expect(checkoutOutcome({ status: 'dirty-blocked', branch: null, message: 'x' })).toEqual({
      listHint: DIRTY_CHECKOUT_HINT,
    });
    expect(checkoutOutcome({ status: 'busy', branch: null, message: 'x' })).toEqual({ entryHint: BUSY_HINT });
    expect(checkoutOutcome({ status: 'not-found', branch: null, message: 'x' }).toast).toEqual({
      variant: 'warning',
      message: 'Branch no longer exists',
    });
    expect(checkoutOutcome({ status: 'switched', branch: 'dev', message: null })).toEqual({ reload: true });
  });
});

describe('entry helpers', () => {
  it('Sync ↓N only with an upstream and behind > 0', () => {
    expect(syncCount({ ahead: 0, behind: 2 })).toBe(2);
    expect(syncCount({ ahead: 1, behind: 0 })).toBeNull();
    expect(syncCount({ ahead: null, behind: null })).toBeNull();
  });
  it('"Last fetched …" only when lastFetchedAt is set', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    expect(lastFetchedLine(null, now)).toBeNull();
    expect(lastFetchedLine('2026-10-09T11:59:30Z', now)).toBe('Last fetched just now');
    expect(lastFetchedLine('2026-10-09T10:00:00Z', now)).toBe('Last fetched 2 hours ago');
  });
});
