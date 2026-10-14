import { describe, expect, it } from 'vitest';
import { sourceRefreshPatch, type RefreshableArticle } from './article-source-refresh';

const timestamp = '2026-10-01T00:00:00.123456+00:00';
const row: RefreshableArticle = {
  id: 'article-1', x_article_id: '2110162929957953604', x_url: 'https://x.com/writer/status/2110162929957953604',
  author_id: 'author-1', author: { x_user_id: 'u1' }, source: 'twitterapi',
  status: 'published', featured: false, indexed_at: timestamp, updated_at: timestamp,
  title: 'Old title', excerpt: 'Old preview', body_preview: 'Old body', read_time_min: 1,
};
const input = {
  tweetId: '2110162929957953604', tweetUrl: row.x_url, authorId: 'u1',
  article: { title: 'Updated substantive article', preview_text: 'Updated preview', contents: [{ text: 'Complete source paragraph with useful information. '.repeat(20) }] },
};

describe('conservative first source refresh', () => {
  it('only produces a content patch, preserving identity, moderation, categories and engagement', () => {
    expect(sourceRefreshPatch(row, input)).toEqual({
      title: input.article.title, excerpt: 'Updated preview',
      body_preview: input.article.contents[0].text.trim().slice(0, 500), read_time_min: 2,
    });
  });
  it.each([
    { source: 'manual' }, { status: 'hidden' }, { status: 'archived' }, { status: 'pending' }, { status: 'rejected' },
    { featured: true }, { updated_at: '2026-10-01T00:00:00.123457+00:00' },
    { indexed_at: null }, { updated_at: null }, { indexed_at: 'bad', updated_at: 'bad' },
    { x_article_id: '43' }, { x_url: 'https://x.com/writer/status/43' },
    { x_url: 'javascript:alert(1)' }, { author: { x_user_id: 'other' } }, { author: null },
  ])('rejects unsafe or previously edited row %j', changes => {
    expect(sourceRefreshPatch({ ...row, ...changes }, input)).toBeNull();
  });
  it('refuses changed URL aliases rather than rewriting stored identity', () => {
    expect(sourceRefreshPatch(row, { ...input, tweetUrl: 'https://twitter.com/writer/status/2110162929957953604' })).toBeNull();
  });
  it.each([
    { title: '' }, { title: 'Unavailable' }, { title: 'Error retrieving article' },
    { title: 'Cut off…' }, { title: 'a'.repeat(1001) }, { preview_text: 'a'.repeat(10001) },
    { contents: [] }, { contents: [{ text: '' }] }, { contents: [{ text: 'short' }] },
    { contents: [{ text: 'a'.repeat(100) + '...' }] },
    { contents: [{ text: '<p> </p>' }] }, { contents: [{ text: 'a'.repeat(1_000_001) }] },
    { contents: [{ text: null }] }, { contents: null }, { preview_text: null },
  ])('rejects incomplete or invalid response %j', changes => {
    expect(sourceRefreshPatch(row, { ...input, article: { ...input.article, ...changes } as any })).toBeNull();
  });
  it('does not downgrade a longer stored body preview', () => {
    expect(sourceRefreshPatch({ ...row, body_preview: 'x'.repeat(500) }, {
      ...input, article: { ...input.article, contents: [{ text: 'x'.repeat(100) }] },
    })).toBeNull();
  });
  it('rejects an unmarked partial body that would reduce the stored reading time', () => {
    expect(sourceRefreshPatch({ ...row, body_preview: 'x'.repeat(500), read_time_min: 10 }, {
      ...input, article: { ...input.article, contents: [{ text: 'Complete sentence. '.repeat(40) }] },
    })).toBeNull();
  });
  it('uses body text instead of a whitespace-only preview', () => {
    expect(sourceRefreshPatch(row, { ...input, article: { ...input.article, preview_text: '  ' } })?.excerpt)
      .toBe(input.article.contents[0].text.slice(0, 300));
  });
  it('does not consume first-update eligibility for an unchanged result', () => {
    const patch = sourceRefreshPatch(row, input)!;
    expect(sourceRefreshPatch({ ...row, ...patch }, input)).toBeNull();
  });
  it('derives a plain-text preview when the upstream preview is empty', () => {
    const patch = sourceRefreshPatch(row, { ...input, article: { ...input.article, preview_text: '' } })!;
    expect(patch.excerpt).toBe(input.article.contents[0].text.slice(0, 300));
  });
});
