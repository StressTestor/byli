import { describe, it, expect } from 'vitest';
import { safeEqual } from './timing-safe-equal';

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('Bearer secret123', 'Bearer secret123')).toBe(true);
  });

  it('returns false for different same-length strings', () => {
    expect(safeEqual('Bearer secret123', 'Bearer secret124')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(safeEqual('Bearer secret', 'Bearer secret123')).toBe(false);
  });

  it('treats null/undefined as empty (no throw)', () => {
    expect(safeEqual(null, 'Bearer x')).toBe(false);
    expect(safeEqual(undefined, 'Bearer x')).toBe(false);
    expect(safeEqual('Bearer x', null)).toBe(false);
    expect(safeEqual(null, null)).toBe(true);
    expect(safeEqual('', '')).toBe(true);
  });

  it('handles multibyte utf8 by byte length', () => {
    // "é" is 2 bytes in utf8, "ab" is 2 bytes — equal byte length, different content
    expect(safeEqual('é', 'ab')).toBe(false);
    expect(safeEqual('café', 'café')).toBe(true);
  });
});
