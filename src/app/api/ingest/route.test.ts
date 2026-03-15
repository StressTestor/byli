import { describe, it, expect } from 'vitest';
import { classifyArticle, stripHtml, estimateReadTime } from './utils';

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
