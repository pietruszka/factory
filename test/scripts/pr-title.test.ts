import { describe, expect, test } from 'vitest';

import { prTitleError } from '../../scripts/check-pr-title.js';

describe('PR titles match type(FAC-N): summary', () => {
  test('feat(FAC-12): add x passes', () => {
    expect(prTitleError('feat(FAC-12): add x')).toBeUndefined();
  });

  test('FAC-12: add x and update stuff fail with the expected format', () => {
    for (const title of ['FAC-12: add x', 'update stuff']) {
      const error = prTitleError(title);
      expect(error, title).toBeDefined();
      expect(error, title).toContain('feat(FAC-12): add x');
      expect(error, title).toContain('type(FAC-N): summary');
    }
  });
});
