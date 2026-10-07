import { describe, it, expect } from 'vitest';
import { buildTitleMatcher, isBlockedTitle, filterBlockedTitles } from './title-filter';

describe('isBlockedTitle (default blocklist)', () => {
  it('matches the seeded term case-insensitively', () => {
    expect(isBlockedTitle('This take is retarded')).toBe(true);
    expect(isBlockedTitle('RETARDED take')).toBe(true);
    expect(isBlockedTitle('ReTaRdEd')).toBe(true);
  });

  it('matches next to punctuation', () => {
    expect(isBlockedTitle('"Retarded": a thread')).toBe(true);
    expect(isBlockedTitle('so retarded!')).toBe(true);
    expect(isBlockedTitle('retarded-ness')).toBe(true);
  });

  it('does not match inside a longer word', () => {
    expect(isBlockedTitle('retardedness')).toBe(false);
    expect(isBlockedTitle('unretarded')).toBe(false);
    expect(isBlockedTitle('retarded2')).toBe(false);
  });

  it('does not match variants that are not on the list', () => {
    expect(isBlockedTitle('retard')).toBe(false);
  });

  it('normalizes full-width characters before matching', () => {
    expect(isBlockedTitle('ｒｅｔａｒｄｅｄ')).toBe(true);
  });

  it('passes ordinary titles and empty input', () => {
    expect(isBlockedTitle('Why GPUs are the new oil')).toBe(false);
    expect(isBlockedTitle('')).toBe(false);
    expect(isBlockedTitle(null)).toBe(false);
    expect(isBlockedTitle(undefined)).toBe(false);
  });
});

describe('buildTitleMatcher', () => {
  it('returns null for an empty list so nothing is blocked', () => {
    expect(buildTitleMatcher([])).toBeNull();
    expect(buildTitleMatcher(['', '  '])).toBeNull();
    expect(isBlockedTitle('anything', null)).toBe(false);
  });

  it('escapes regex metacharacters in terms', () => {
    const m = buildTitleMatcher(['a.b', 'c+']);
    expect(isBlockedTitle('a.b here', m)).toBe(true);
    expect(isBlockedTitle('axb here', m)).toBe(false);
    expect(isBlockedTitle('c+ code', m)).toBe(true);
  });

  it('supports multi-word terms', () => {
    const m = buildTitleMatcher(['bad phrase']);
    expect(isBlockedTitle('A Bad Phrase appears', m)).toBe(true);
    expect(isBlockedTitle('bad phrases', m)).toBe(false);
  });

  it('is not stateful across calls', () => {
    const m = buildTitleMatcher(['foo']);
    expect(isBlockedTitle('foo', m)).toBe(true);
    expect(isBlockedTitle('foo', m)).toBe(true);
  });
});

describe('filterBlockedTitles', () => {
  it('drops whole items and leaves other titles untouched', () => {
    const items = [
      { id: 1, title: 'Fine title' },
      { id: 2, title: 'Retarded title' },
      { id: 3, title: null },
    ];
    expect(filterBlockedTitles(items)).toEqual([
      { id: 1, title: 'Fine title' },
      { id: 3, title: null },
    ]);
  });
});
