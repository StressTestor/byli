# Feed pagination rollout

## What ships safely before a database migration

With `FEED_PAGINATION_V2` unset or `false` (the default), the application continues to call the existing `get_feed` RPC. There is no schema probe, fallback retry, whole-feed fetch, or new production read amplification. Each request asks for at most 51 rows (50 cards plus one lookahead).

The shared SSR/GraphQL cursor codec accepts both cached plain timestamps and old base64 timestamps. New SSR cursors are base64-encoded like GraphQL. Load-more failures preserve existing cards and the current cursor, show a generic recoverable error, and offer retry. Repeated clicks are guarded, stale responses cannot overwrite newer filters, and overlapping article IDs are deduplicated.

This compatibility path does **not** repair the existing timestamp-only ranked pagination algorithm. Popular and For You can still omit articles until v2 is enabled. Keep that limitation explicit in release notes; the complete ranking fix is gated on the approved database rollout below.

## Approval and deployment order

Do not apply the SQL to a live database without explicit approval. Both candidates are stored in `supabase/proposed/`, outside automatic migration discovery. Promote approved SQL into `supabase/migrations/` only in a dedicated release after live approval and preflight.

1. Review and approve `supabase/proposed/20261014012000_add_ranked_feed_pagination.sql` together with any other pending migrations. The migration adds `get_feed_page` as SECURITY INVOKER, restricts its execution to `service_role`, and bounds both new and legacy feed functions to 51 returned rows. The existing function name and parameter signature are retained for compatibility.
2. Apply the approved migration through the normal database release process. Confirm the service role can read `get_feed_page`, that anon/authenticated cannot execute it, and that the deployed database function caps oversized `p_limit` requests. Regenerate `src/types/supabase.ts` from the approved live schema afterward and replace the small staged RPC cast in `feed-page.ts` with the generated type.
3. Deploy the application with `FEED_PAGINATION_V2=true` only after the function exists. Enabling the flag first will cause fresh feed requests to fail safely; the application deliberately does not hide a bad rollout by falling back to an incorrect ordering.
4. Verify a first page and multiple Load more requests for Popular, Latest, and a category. New cursors carry version 2, sort/category scope, one score-reference timestamp, and the exact rank/published timestamp/article UUID tuple. Check no existing cards disappear on a recoverable failure.
5. Refresh/revalidate the homepage ISR cache (normally 15 minutes). Old cached HTML and already-open tabs can carry v1 cursors; those sessions deliberately keep their legacy backend until a filter refresh or reload starts a new v2 feed.

Rollback: set the flag to `false` and redeploy. Keep the additive `get_feed_page` function in place so already-issued v2 cursors remain valid. Do not drop it during an application-only rollback. Fresh requests return to the legacy backend and its documented ranking limitations.

## Ordering and consistency guarantees

V2 orders by rank descending, published timestamp descending with nulls last, then UUID descending. Latest uses a constant rank; Popular uses like count; For You uses the existing recency/engagement/featured weights. The keyset predicate uses the same complete tuple as ORDER BY. Category matching uses EXISTS so articles in several categories appear once. Cursors advance using the unfiltered database page, including blocked titles, so an empty visible page can still advance.

For You recency is evaluated at the cursor's fixed `asOf` value, and articles indexed later are excluded from that pagination session. Numeric ranks travel as text to preserve PostgreSQL precision; published timestamps preserve microseconds. Null dates have an explicit cursor representation and sort last.

This is a live feed, not an immutable database snapshot. Changes to likes, bookmarks, comments, featured status, publication status, timestamps, or category membership can still move articles across a page boundary between requests. The client deduplicates overlaps, but an article moving above an already-consumed boundary can be omitted until refresh. A strict immutable engagement snapshot would require persisted ranking snapshots or history and is outside this migration.

The 51-row cap bounds returned rows, not the number of database rows examined while ranking/filtering. It does not claim to eliminate sort cost. No fetch-all or expanding batch loop is used.

## Legacy caller inventory

- `src/lib/feed-page.ts`: SSR homepage and GraphQL feed, at most 51 rows including lookahead.
- `src/lib/feed.ts`: RSS/Atom/JSON latest and category exports default to 50 rows.
- `src/app/feed/route.ts`: uses the default 50-row latest feed.
- `src/app/feed/[slug]/route.ts`: uses the default 50-row category feed.

No current repository caller requests more than 51 legacy feed rows. The cap does not truncate the site's RSS/Atom/JSON contract.

## Local validation

- `src/lib/feed-pagination.test.ts`: cursor roundtrips, validation, SSR-to-GraphQL handoff, raw cached timestamps, feature-flag transitions, filtered-page advancement, and sanitized database failures.
- `src/lib/feed-pagination.sql.test.ts`: executes the actual migration with PostgreSQL via PGlite, using 137 synthetic articles. Traverses Popular, Latest, For You, and category pages with tied ranks/timestamps and null timestamps; asserts exact order, no duplicates/omissions for unchanged data, SQL row caps, and execution grants.
- `src/components/feed/home-feed.test.tsx`: real React renderer interaction tests for preserving 19 SSR cards after load failure, retry, overlap deduplication, repeated clicks, stale filters, and in-flight old pages.
- `src/hooks/api.feed.test.tsx`: hook pagination/refetch recovery, category races, deduplication, and safe transport errors.
- `node supabase/tests/run-client-security.mjs`: replays historical migrations plus the staged feed migration in isolated PostgreSQL alongside the security migration checks.

All fixtures are local. These checks neither read nor mutate production data.
