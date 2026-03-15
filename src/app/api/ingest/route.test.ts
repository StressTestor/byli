import { describe, it, expect } from 'vitest';
import { classifyArticle, stripHtml, estimateReadTime, isEnglishLike } from './utils';

// ─── stripHtml ──────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtml('A &amp; B &lt; C &gt; D')).toBe('A & B < C > D');
    expect(stripHtml('&quot;quoted&quot; &amp; &#39;apos&#39;')).toBe('"quoted" & \'apos\'');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('  hello   world  \n\n  foo  ')).toBe('hello world foo');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });

  it('handles plain text (no HTML)', () => {
    expect(stripHtml('just plain text')).toBe('just plain text');
  });

  it('handles nested tags', () => {
    expect(stripHtml('<div><p><span>deep</span></p></div>')).toBe('deep');
  });
});

// ─── estimateReadTime ───────────────────────────────────────────────

describe('estimateReadTime', () => {
  it('returns minimum of 2 minutes for short text', () => {
    expect(estimateReadTime('hello world')).toBe(2);
    expect(estimateReadTime('')).toBe(2);
  });

  it('calculates correctly for 250 words (1 min rounds to 2 min minimum)', () => {
    const words = Array(250).fill('word').join(' ');
    expect(estimateReadTime(words)).toBe(2);
  });

  it('calculates correctly for 500 words', () => {
    const words = Array(500).fill('word').join(' ');
    expect(estimateReadTime(words)).toBe(2);
  });

  it('calculates correctly for 750 words', () => {
    const words = Array(750).fill('word').join(' ');
    expect(estimateReadTime(words)).toBe(3);
  });

  it('calculates correctly for 2000 words', () => {
    const words = Array(2000).fill('word').join(' ');
    expect(estimateReadTime(words)).toBe(8);
  });

  it('rounds up fractional minutes', () => {
    // 501 words = 2.004 minutes -> ceil = 3, but max(3, 2) = 3
    const words = Array(501).fill('word').join(' ');
    expect(estimateReadTime(words)).toBe(3);
  });
});

// ─── classifyArticle ────────────────────────────────────────────────

describe('classifyArticle', () => {
  it('classifies crypto/blockchain content as tech', () => {
    const cats = classifyArticle(
      'The Post-Chain Era',
      'blockchain crypto decentralized protocol'
    );
    expect(cats).toContain('tech');
  });

  it('classifies business content', () => {
    const cats = classifyArticle(
      'Market Analysis Q4',
      'revenue growth investor funding vc startup'
    );
    expect(cats).toContain('business');
  });

  it('classifies political content', () => {
    const cats = classifyArticle(
      'Election Day',
      'congress senate vote campaign democracy'
    );
    expect(cats).toContain('politics');
  });

  it('classifies science content', () => {
    const cats = classifyArticle(
      'New CRISPR Discovery',
      'research study genome biology experiment'
    );
    expect(cats).toContain('science');
  });

  it('returns at most 2 categories', () => {
    // Text that hits multiple categories
    const cats = classifyArticle(
      'AI Startup Election Science',
      'ai software startup funding election congress research study'
    );
    expect(cats.length).toBeLessThanOrEqual(2);
  });

  it('returns categories sorted by relevance (highest score first)', () => {
    // tech-heavy text with one business word
    const cats = classifyArticle(
      'AI Machine Learning',
      'ai software developer code algorithm neural llm model compute data'
    );
    expect(cats[0]).toBe('tech');
  });

  it('returns empty array for text with no category matches', () => {
    const cats = classifyArticle(
      'Random Title',
      'this text has no category keywords whatsoever'
    );
    expect(cats).toEqual([]);
  });

  it('handles empty inputs', () => {
    const cats = classifyArticle('', '');
    expect(cats).toEqual([]);
  });

  it('is case-insensitive', () => {
    const cats = classifyArticle('AI BLOCKCHAIN CRYPTO', 'SOFTWARE DEVELOPER');
    expect(cats).toContain('tech');
  });
});

// ─── isEnglishLike ──────────────────────────────────────────────────

describe('isEnglishLike', () => {
  it('accepts English titles', () => {
    expect(isEnglishLike('The Future of AI')).toBe(true);
    expect(isEnglishLike('How to Start Investing in Web3')).toBe(true);
    expect(isEnglishLike('11 Books You Can Finish In One Sitting')).toBe(true);
  });

  it('rejects Japanese titles', () => {
    expect(isEnglishLike('フリーランスが3年で消える理由はスキルじゃない')).toBe(false);
    expect(isEnglishLike('子育てに学ぶコミュニケーションデザイン')).toBe(false);
  });

  it('rejects Chinese titles', () => {
    expect(isEnglishLike('走过的路很长很长')).toBe(false);
    expect(isEnglishLike('宠物文化西方左翼雌化文化渗透的结果')).toBe(false);
  });

  it('rejects Arabic titles', () => {
    expect(isEnglishLike('مقال عن الذكاء الاصطناعي')).toBe(false);
  });

  it('accepts titles with some numbers and punctuation', () => {
    expect(isEnglishLike('The 21-Mile Corridor')).toBe(true);
    expect(isEnglishLike("Please Don't Do This To Yourself")).toBe(true);
  });

  it('accepts mixed Latin with a few non-Latin chars', () => {
    // Mostly English with an accent or two
    expect(isEnglishLike('Café Culture in Modern Cities')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isEnglishLike('')).toBe(false);
  });

  it('rejects strings with only numbers/punctuation', () => {
    expect(isEnglishLike('123 456!')).toBe(false);
  });
});
