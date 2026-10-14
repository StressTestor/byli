# Conservative source-content refresh

## Scope

The scheduled ingestion path previously returned immediately for any stored tweet URL or ID. It now allows an eligible **first content refresh** from a timeline/search response the run already fetched. This is not ongoing synchronization or a repair of a specific production record.

Eligibility requires all of:

- Published, unfeatured `twitterapi` article.
- Non-null, valid, exactly equal `indexed_at` and `updated_at` timestamps.
- Same stored tweet ID and URL, a safe X/Twitter status URL, and matching source author ID.
- Nonempty substantive article contents, valid title and preview, bounded response sizes, no obvious trailing truncation marker, and no reduction in stored body-preview length or estimated reading time.
- Changed content, with no more than 20 eligible update attempts per run, shared across concurrent workers and duplicate responses.

Only `title`, `excerpt`, `body_preview`, and `read_time_min` are updated. Identity, URLs, author, publication date, moderation status, featured state, categories, images, and engagement are untouched. The update repeats identity/status/source/featured/timestamp predicates atomically, so an intervening article edit causes a no-op. A failed refresh is counted as an error, never retried as an insert. `refreshed_articles` is reported separately from new articles and skipped duplicates.

Dedup queries retrieve the required fields; no new upstream API requests, timeline pages, budgets, cron schedules, or ingestion triggers are added. Existing single-article submission/approval ingestion continues returning duplicates without an upstream request.

## Limits and rollout

Repository schema defaults both timestamps to PostgreSQL `now()` and updates `updated_at` on every article update. Equality is a conservative heuristic, **not proof of unedited provenance**: an insert and manual edit within the same transaction can share a timestamp, and privileged direct writes could reset it. Rows with missing timestamps, previous edits, uncertain identity, or manual source remain skipped. A provenance snapshot/version column would be needed for reliable ongoing synchronization while preserving editorial overrides.

Upstream responses do not provide a reliable completeness/version contract. Unmarked partial bodies can still be indistinguishable from complete source content despite these conservative guards. No claim is made that the reported stored title mismatch was caused by stale ingestion or will be repaired by deployment. A separate read-only investigation and an explicitly authorized targeted repair remain appropriate.

The first successful content update advances `updated_at`, making the row ineligible for later automatic refreshes. Unchanged and rejected payloads do not consume that eligibility. The cap bounds writes per run, not across overlapping runs; row predicates prevent competing first updates from both succeeding. Existing ISR/cache timing still applies to public pages.

No schema migration, settings change, or live test is required by this application patch. All SQL proposals from the preceding audit remain outside migration discovery. Layout, styles and labels are unchanged. The existing “more from” section now lists only published articles by its named author, and can contain fewer cards when that author has fewer articles.

## Verification

`node supabase/tests/run-source-refresh.mjs` replays repository migrations into ephemeral PGlite PostgreSQL and checks timestamp defaults, trigger behavior, stale-worker compare-and-set, intervening moderation/content edits, nullable timestamps and engagement preservation. This is synthetic PostgreSQL18 testing, not live PostgreSQL17 or PostgREST verification.

Vitest covers payload eligibility, unsafe identities, incomplete responses, errors, unchanged content, concurrent-worker bounds, duplicate responses, and unchanged network-call counts. Related-article tests cover mixed authors, unpublished rows, current-article exclusion, limits/order, lookup failures and page wiring. Browser/vendor behavior is not newly tested by this patch.
