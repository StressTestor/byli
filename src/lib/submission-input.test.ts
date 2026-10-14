import { describe, it, expect } from 'vitest';
import { safeSubmissionUrl, validSubmissionNotes } from './submission-input';

describe('submission input boundary', () => {
  it.each([
    'https://x.com/a/status/12345', 'https://twitter.com/i/article/123',
    'https://mobile.x.com/a/status/12345/photo/1?s=20#photo', 'https://www.twitter.com/a/statuses/12345',
  ])('preserves supported X links: %s', value => expect(safeSubmissionUrl(value)).toBe(value));
  it.each([
    'javascript:alert(1)//x.com', 'data:text/html,x.com', '//x.com/a', 'http://x.com/a',
    'https://x.com.evil.test/a', 'https://evil.test/?x.com', 'https://x.com@evil.test/a',
    'https://a@x.com/a', 'https://x.com:443/a', 'https://x.com\\@evil.test/a',
    'https://x.com/a\n', 'https://x.com/\u0000', 'https://x.com/a b', 'https://x.com/' + 'a'.repeat(2048),
  ])('rejects unsafe input: %s', value => expect(safeSubmissionUrl(value)).toBeNull());
  it('bounds the normalized URL before database insertion', () => {
    expect(safeSubmissionUrl('https://x.com/' + 'é'.repeat(400))).toBeNull();
    expect(safeSubmissionUrl('https://x.com/café')).toBe('https://x.com/caf%C3%A9');
  });
  it('bounds notes without rejecting optional notes', () => {
    for (const notes of [undefined, null, '', 'a'.repeat(2000)]) expect(validSubmissionNotes(notes)).toBe(true);
    expect(validSubmissionNotes('a'.repeat(2001))).toBe(false);
  });
});
