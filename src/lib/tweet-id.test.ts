import { describe, it, expect } from 'vitest';
import { extractTweetId } from './tweet-id';

describe('extractTweetId', () => {
  it('reads x.com and twitter.com status links', () => {
    expect(extractTweetId('https://x.com/sierracatalina/status/2027172169336476151')).toBe('2027172169336476151');
    expect(extractTweetId('https://twitter.com/a/status/1972831521078640733?s=20')).toBe('1972831521078640733');
    expect(extractTweetId('https://mobile.x.com/a/status/1972831521078640733/photo/1')).toBe('1972831521078640733');
  });

  it('rejects non-status and non-X URLs', () => {
    expect(extractTweetId('https://x.com/i/article/1972831521078640733')).toBeNull();
    expect(extractTweetId('https://evil.com/a/status/1972831521078640733')).toBeNull();
    expect(extractTweetId('https://x.com.evil.com/a/status/1972831521078640733')).toBeNull();
    expect(extractTweetId('not a url')).toBeNull();
  });
});
