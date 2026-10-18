# Article body quality at ingestion

Timeline and global-search responses identify X Articles, but the importer did
not require usable article blocks before saving `body_preview`. If `contents`
was missing, it copied the sharing tweet's text, which can be only a `t.co`
link. A `contents` array containing just that link was saved too. This explains
the observed storage path; the raw provider responses for the affected imports
were not retained, so their exact shape and cause are unconfirmed.

The importer now saves a body preview and reading time only when its article
blocks contain substantial prose, have at least as much text as the provider
teaser, and lack an obvious trailing truncation marker. Missing/short-link
bodies are stored as null. The title and provider teaser still allow discovery
and the existing link to the full article on X. The excerpt keeps its existing
provider-preview preference and 300-character body fallback; the body display
cap stays 500 characters. The first-source-refresh path shares this body check.
No additional upstream requests, scheduled runs, or visual changes are added.

The provider's [Get Article documentation](https://docs.twitterapi.io/api-reference/endpoint/get_article)
describes full content blocks, including media blocks without text, and a
100-credit request charge. We did not call it or trigger ingestion. The
timeline/search documentation does not establish that their embedded article
field always includes those full blocks. A sufficiently long but incomplete
upstream body can still pass the heuristic.

## Existing affected rows

This patch does not rewrite existing records. For the reported article IDs
`aa44baf3-0b38-4b78-aa4a-677c7c205b1d`,
`6d73f191-9877-442a-9727-f7fa1de3ba89`,
`043fca8c-c8da-42f7-87f3-24f5206a50d1`, and
`06926aa9-09f2-4c37-9f8b-4ffe254f3179`, first confirm title, source URL,
author, current excerpt/body, and edit timestamps with read-only queries.
Compare the public X source and the intended provider teaser. A later natural
import can apply the existing guarded first refresh if it receives better
article blocks. Otherwise prepare a per-row correction for review, using an
exact ID, source identity, and old-value predicates so any concurrent edit
causes a no-op. Do not bulk replace content or infer the full article body
from the short link.

Until a row receives a verified repair, article-page rendering and GraphQL
read normalization omit a `body_preview` made entirely of URL tokens. The
stored value, timestamps, reading time, provider teaser, and source link are
unchanged, so the conservative first-refresh conditions remain available.
Short prose and prose containing a link remain visible. This is a display
guard for known link-only records, not a claim that other promotional or
incomplete text is a complete article body.
