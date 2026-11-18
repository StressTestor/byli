import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cache: new Map<string, string>(), renders: 0, bytes: 32, mode: '', keys: [] as string[] }));
vi.mock('next/og', () => ({ ImageResponse: class extends Response {
  constructor() { state.renders++; if (state.mode === 'render-error') throw new Error('render failed'); super(new Uint8Array(state.bytes).fill(42)); }
} }));
vi.mock('next/cache', () => ({ unstable_cache: (callback: (...args: any[]) => Promise<string>, keys: string[]) => async (...args: any[]) => {
  const key = JSON.stringify([keys, args]); state.keys.push(key);
  if (state.mode === 'read-error') throw new Error('cache read failed');
  if (state.cache.has(key)) return state.cache.get(key);
  const value = await callback(...args);
  if (state.mode === 'write-error') throw new Error('cache write failed');
  state.cache.set(key, value); return value;
} }));
import { getArticleOgBytes } from './article-og';
const source = { title: 'Title', authorName: 'Author', authorHandle: 'handle', categoryLabel: 'Topic' };
beforeEach(() => { state.cache.clear(); state.renders = 0; state.bytes = 32; state.mode = ''; state.keys = []; });
describe('render-only OG cache', () => {
  it('reuses identical displayed fields across calls', async () => {
    expect(await getArticleOgBytes(source)).toEqual(await getArticleOgBytes({ ...source }));
    expect(state.renders).toBe(1);
    expect(state.keys[0]).toContain('article-og-node-next14.2.35-v1');
  });
  it.each(['title', 'authorName', 'authorHandle', 'categoryLabel'])('invalidates when %s changes', async field => {
    await getArticleOgBytes(source); await getArticleOgBytes({ ...source, [field]: 'changed' });
    expect(state.renders).toBe(2);
  });
  it('renders once when cache reads fail', async () => {
    state.mode = 'read-error'; expect((await getArticleOgBytes(source)).byteLength).toBe(32); expect(state.renders).toBe(1);
  });
  it('reuses already-rendered bytes when cache writes fail', async () => {
    state.mode = 'write-error'; expect((await getArticleOgBytes(source)).byteLength).toBe(32); expect(state.renders).toBe(1);
  });
  it('does not cache oversized images or render them twice', async () => {
    state.bytes = 1024 * 1024 + 1;
    expect((await getArticleOgBytes(source)).byteLength).toBe(state.bytes);
    expect(state.renders).toBe(1); expect(state.cache.size).toBe(0);
  });
  it('propagates renderer failures without repeatedly rendering', async () => {
    state.mode = 'render-error'; await expect(getArticleOgBytes(source)).rejects.toThrow('render failed'); expect(state.renders).toBe(1);
  });
});
