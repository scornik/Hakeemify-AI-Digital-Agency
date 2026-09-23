import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('library package', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE_NAME).toBe('@ada/library');
  });
});
