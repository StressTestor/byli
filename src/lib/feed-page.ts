import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  decodeFeedCursor, encodeLegacyFeedCursor, encodeRankedFeedCursor, feedPageSize,
  FEED_UNAVAILABLE_MESSAGE, type FeedSort,
} from '@/lib/feed-pagination';
import type { Database, Json } from '@/types/supabase';

type FeedRow = Database['public']['Functions']['get_feed']['Returns'][number] & {
  // Returned as text by v2 so numeric score precision survives the JSON roundtrip.
  cursor_rank?: string;
};

export interface RawFeedPage {
  rows: FeedRow[];
  hasNextPage: boolean;
  endCursor: string | null;
  cursorFor: (row: FeedRow) => string;
}

export async function getFeedPage(options: {
  sort: FeedSort;
  category?: string | null;
  after?: string | null;
  first?: number;
}): Promise<RawFeedPage> {
  const category = options.category || null;
  const limit = feedPageSize(options.first);
  const cursor = decodeFeedCursor(options.after, { sort: options.sort, category });
  // The SQL migration is deliberately additive. Only enable new first pages
  // after it has been approved/applied. Existing cursors retain their backend
  // through a rolling deploy or flag rollback; never silently restart a feed.
  const ranked = cursor?.version === 2 || (!cursor && process.env.FEED_PAGINATION_V2 === 'true');
  const asOf = cursor?.version === 2 ? cursor.asOf : new Date().toISOString();
  let result: { data: FeedRow[] | null; error: unknown };
  if (ranked) {
    // Generated schema describes the live DB, where v2 is not installed yet.
    // Regenerate it after migration approval; keep this staged cast local.
    const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
      name: 'get_feed_page', args: Record<string, Json | undefined>,
    ) => PromiseLike<{ data: FeedRow[] | null; error: unknown }>;
    result = await rpc('get_feed_page', {
      p_category_slug: category ?? undefined,
      p_sort: options.sort,
      p_as_of: asOf,
      p_cursor: cursor?.version === 2 ? {
        rank: cursor.rank, published_at: cursor.publishedAt, id: cursor.id,
      } : undefined,
      p_limit: limit + 1,
    });
  } else {
    result = await supabaseAdmin.rpc('get_feed', {
      p_category_slug: category ?? undefined,
      p_sort: options.sort,
      p_cursor: cursor?.version === 1 ? cursor.publishedAt : undefined,
      p_limit: limit + 1,
    });
  }
  if (result.error || !Array.isArray(result.data)) throw new Error(FEED_UNAVAILABLE_MESSAGE);
  const rows = result.data.slice(0, limit);
  const cursorFor = (row: FeedRow): string => {
    if (!ranked) return encodeLegacyFeedCursor(row.published_at) ?? '';
    if (typeof row.cursor_rank !== 'string') throw new Error(FEED_UNAVAILABLE_MESSAGE);
    return encodeRankedFeedCursor({
      version: 2, sort: options.sort, category, asOf, rank: row.cursor_rank,
      publishedAt: row.published_at ?? null, id: row.id,
    });
  };
  const lastRow = rows[rows.length - 1];
  const endCursor = lastRow ? cursorFor(lastRow) || null : null;
  return {
    rows, cursorFor, endCursor,
    // A legacy NULL timestamp cannot advance. V2 explicitly handles NULL dates.
    hasNextPage: result.data.length > limit && endCursor !== null,
  };
}
