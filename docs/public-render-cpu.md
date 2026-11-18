# Low-risk public rendering CPU changes

This patch preserves layout, moderation behavior and authorization. No database migration or credential change is needed.

- The invariant site-wide Open Graph image renders once at build time on Node, rather than running the Edge image renderer on a cache miss. Its artwork and dimensions are unchanged. Warm CDN requests were already cached, so this primarily removes cold/build-invalidation rendering work; it is not a promise of large savings.
- Article and author metadata/page data use React's request-scoped cache to deduplicate matching reads within one server render. Author metadata and page previously used distinct SELECT projections, so they now share one author lookup. Article deduplication is explicit, although Next fetch memoization may already deduplicate some identical reads. No new cross-request content cache is introduced.

## Deliberately excluded

Article OG behavior is unchanged. An experimental source-keyed raster cache with a fresh visibility check passed local correctness tests, but its private/no-store responses would replace existing warm Vercel CDN hits with a function invocation and database read on every hit. That is a freshness/security tradeoff, not an established CPU saving, so it is not shipped in this CPU patch.

Whole-page article/author ISR is also excluded: direct browser moderation writes, agent writes and ingestion currently have no comprehensive cache invalidation. Enabling shared HTML caching could keep unpublished/deleted content visible. Author article lists remain unbounded; silently limiting them would change the product. These are the larger optimization opportunities, but need separate design and freshness guarantees.

## Verification and expected impact

Tests exercise Next14's actual compiled React cache with synthetic request dispatchers: within-request reuse, separate-request edits, publication transitions, deletion, failure recovery and sanitized preview fields. Existing rendering tests remain in place. Root OG is present in the production prerender manifest with no revalidation; the generated PNG matches the current production Edge output byte-for-byte.

Expected savings are modest: avoid duplicate per-render lookup/processing and remove invariant-image cold rendering. No traffic-weighted CPU or billing percentage has been measured. Compare usage at similar traffic volume after rollout, rather than claiming the billing warning is resolved by this patch.

Before rollout: full tests, TypeScript/build, independent review and exact-head preview. No production content mutations are needed for validation. Rollback is the previous application deployment; no schema rollback is involved.
