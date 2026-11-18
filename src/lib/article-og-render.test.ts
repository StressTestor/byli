import { expect, it } from 'vitest';
import { renderArticleOg } from './article-og';
it('renders a real 1200x630 PNG below the conservative data-cache budget', async () => {
  const bytes = await renderArticleOg({ title: 'A practical guide to building reliable systems', authorName: 'Example Author', authorHandle: 'example', categoryLabel: 'Technology' });
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.length).toBeLessThan(1024 * 1024);
}, 15000);
