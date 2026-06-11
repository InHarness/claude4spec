import { describe, expect, it } from 'vitest';
import { CliError } from './errors.js';

describe('CliError', () => {
  it('exposes name, code and message', () => {
    const err = new CliError('ENTITY_NOT_FOUND', 'entity not found');
    expect(err.name).toBe('CliError');
    expect(err.code).toBe('ENTITY_NOT_FOUND');
    expect(err.message).toBe('entity not found');
    expect(err.hint).toBeUndefined();
  });

  it('carries an optional hint', () => {
    const err = new CliError('INVALID_ARGS', 'bad args', 'try --help');
    expect(err.hint).toBe('try --help');
  });

  it('is an instance of Error and CliError', () => {
    const err = new CliError('TIMEOUT', 'took too long');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CliError);
  });
});
