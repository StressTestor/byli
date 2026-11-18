import { expect, it, vi } from 'vitest';
vi.mock('next/og', () => ({ ImageResponse: class { constructor(public tree: unknown, public options: unknown) {} } }));
import Image, { runtime, dynamic, size, contentType } from './opengraph-image';
it('pre-renders the unchanged invariant site artwork instead of using an edge function', async () => {
  expect(runtime).toBe('nodejs');
  expect(dynamic).toBe('force-static');
  expect(contentType).toBe('image/png');
  expect(size).toEqual({width:1200,height:630});
  const rendered = await Image() as any;
  expect(rendered.options).toEqual(size);
  const text=JSON.stringify(rendered.tree);
  expect(text).toContain('where X Articles surface');
  expect(text).toContain('linkdrift.app');
});
