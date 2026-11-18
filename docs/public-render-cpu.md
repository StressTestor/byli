# Public rendering CPU reduction

This patch preserves public page layout and owner/admin authorization. It does not add whole-page ISR for article/author routes: browser moderation still writes directly to Supabase, so adding shared HTML caches without complete invalidation could keep unpublished content visible.

## Changes

- The invariant site-wide Open Graph image renders at build time on Node, rather than at request time on Edge. Artwork and dimensions are unchanged.
- Article and author metadata/page data use React's request-scoped cache to deduplicate matching reads within one server render. No new cross-request article/author data cache is introduced. Existing route/fetch caching semantics are not otherwise changed.
- Article Open Graph requests perform a fresh, published-only database lookup through a dedicated no-store fetch client. Only raster bytes are cached, keyed by every displayed field and an explicit renderer-version key. Publication state is never read from that cache. Title, author and category changes naturally select different bytes.
- Article PNG responses are private/no-store, overriding ImageResponse's public immutable default. The live visibility gate remains necessary even for warm raster-cache hits. Existing social-network image copies are outside our control; this cannot erase already fetched previews.

## Safety and tradeoffs

- Missing, unpublished, deleted, or failed-query articles produce the fixed fallback image, never a cached formerly visible article.
- The PNG cache stores base64 only; outputs exceeding1MiB skip storage to stay safely below Next14's serialized cache-entry size cap. Cache service failure falls back to a single uncached render. Renderer failures propagate rather than recursively retrying.
- Cold concurrent cache misses can duplicate a render; no unbounded in-process coalescing map was added.
- Each article image still requires a database read. This trades some cache storage/read overhead for reduced repeated rasterization. It does not prove a specific CPU or billing reduction; compare equivalent live traffic windows after rollout.
- Request-local memoization does not eliminate whole-page author rendering. Author article lists remain unbounded as before; pagination would be a separate visible product change.
- There are no new credential, role, DB schema, moderation, or mutation paths.

## Verification

Unit tests use Next14's actual compiled React cache with synthetic request dispatchers for request boundaries; they test edits, publication transitions, deletion and failure recovery. Raster tests cover source-field keys, storage/read failures, oversized payloads and real PNG dimensions. A synthetic local production-mode Next server must also verify that the actual metadata-route wrapper preserves private headers, a warm image reuses a data-cache entry, every request checks the database, and hide/delete/edit changes take effect after warming.

Before rollout: full tests, TypeScript/build, independent review, exact-head preview, and visual parity check. No production content mutations are needed for validation. Preserve the prior deployment for rollback; no migration is involved.
