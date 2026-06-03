import { describe, it, expect, vi } from 'vitest';

// supabase-admin.ts calls createClient(url!, key!) at import time, so we mock
// the whole module — both to control the returned data and to avoid the
// env-dependent client construction.
vi.mock('@/lib/supabase-admin', () => {
  const single = vi.fn().mockResolvedValue({
    data: { label: 'Tech', slug: 'tech' },
  });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return { supabaseAdmin: { from: vi.fn(() => ({ select })) } };
});

import { generateMetadata } from './page';

describe('category generateMetadata', () => {
  it('returns a self-canonical to /category/<slug>', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'tech' }),
    });

    expect(meta.alternates?.canonical).toBe('/category/tech');
  });

  it('sets og:url to the canonical path', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'tech' }),
    });

    expect(meta.openGraph?.url).toBe('/category/tech');
  });
});
