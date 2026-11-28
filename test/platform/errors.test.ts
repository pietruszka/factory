import { describe, expect, test } from 'vitest';

import { FactoryError, internal, refused } from '../../src/platform/errors.js';

describe('error factories', () => {
  test('refused sets exit code 2 and keeps the fields', () => {
    const error = refused({
      code: 'example_refused',
      message: 'refused message',
      where: 'where',
      next: 'next step',
    });

    expect(error).toBeInstanceOf(FactoryError);
    expect(error.exitCode).toBe(2);
    expect(error.code).toBe('example_refused');
    expect(error.message).toBe('refused message');
    expect(error.where).toBe('where');
    expect(error.next).toBe('next step');
    expect(error.nextCommand).toBeUndefined();
  });

  test('internal sets exit code 4 and keeps the fields', () => {
    const error = internal({
      code: 'example_internal',
      message: 'internal message',
      where: 'where',
      next: 'next step',
    });

    expect(error).toBeInstanceOf(FactoryError);
    expect(error.exitCode).toBe(4);
    expect(error.code).toBe('example_internal');
  });
});
