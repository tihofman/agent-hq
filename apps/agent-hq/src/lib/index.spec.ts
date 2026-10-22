import { describe, expect, it } from 'vitest';
import { getAppTitle } from './index';

describe('getAppTitle', () => {
  it('returns Agent-HQ', () => {
    expect(getAppTitle()).toBe('Agent-HQ');
  });
});
