# Crypto-airdrop publication policy

The shared conservative classifier rejects crypto airdrop claim/farming promotions,
free-token claims and holder-allocation crate promotions. It preserves incidental
mentions, defensive/news/analysis headlines, Apple AirDrop and ordinary rewards.
This is a lexical policy, not an assurance that every semantic or multilingual
promotion is recognized. Full upstream article text is checked during ingest and
source refresh; database enforcement can inspect only stored title/excerpt/preview.
A neutral title with truncated evidence can still require human moderation.

## Enforcement

- Shared ingestion blocks before article/author writes; manual approval cannot
  link a blocked dedup result. Source refresh validates upstream and merged content.
- Agent republish checks content before updating; the DB trigger is authoritative
  for browser/admin/API writes and concurrent content changes.
- The DB checks published INSERTs, publication/content changes and new featuring.
  Archive, unfeature and deletion remain possible. Existing rows are not backfilled.
- Exact admin article selection: `/admin?articleIds=<comma-separated UUIDs>`, then
  the existing Articles tab. Maximum 50; malformed/repeated filters fail closed.
  With no parameter the original newest-50 behavior is unchanged. Existing auth,
  controls and appearance remain unchanged. Status/feature success requires one
  returned matching row before audit logging.

## Rollout and rollback

1. Verify live migration history ends at the expected prior migration and that the
   new functions/trigger are absent. Review the exact migration SQL.
2. Apply the additive publication guard as one transactional migration before the
   app release. No article UPDATE/DELETE/backfill or key changes are included.
3. If the managed migration tool assigns its own version, read back migration
   history and rename the local file to that recorded version. Never rerun the SQL
   merely to reconcile filenames.
4. Deploy the reviewed app head. Read-only verify migration and deployment state;
   use local synthetic fixtures rather than production test publications.
5. Archive confirmed backlog separately through ordinary authorized moderation.
   Public cached pages/RSS/sitemap and existing rendered OG images may lag; no broad
   public-cache policy change is included here.

Prefer rolling back the app while retaining the DB guard. If a confirmed guard
regression requires rollback, explicitly remove only the new trigger and its two
functions in a reviewed migration. This removes future enforcement, not archives;
archived content must not be republished automatically. Coordinate with the owner.

## Verification

Synthetic fixtures exercise JS/Postgres parity, UTF8 normalization, defensive and
Apple exceptions, body-only direct claims, database authenticated/service-role
publication rejection, legacy featuring, archive/unfeature/delete, and classifier
privileges. UI tests cover bounded filters, stale requests, errors and zero-row
updates. Ingest/refresh/approval/agent tests cover application integration. No real
spam destinations or account identifiers belong in these fixtures.
