# linkdrift audit — prioritized improvement plan

**date:** 2026-06-03
**scope:** full app audit, SEO as headline priority, transfer-readiness for a TrustMRR-style sale
**repo audited:** `StressTestor/byli` (cloned to `/Volumes/T7/byli-work`, HEAD `4383afe`)
**method:** read the actual code, ran the real toolchain (`next build`, `tsc --noEmit`, `vitest`), curled the live site as Googlebot, and queried the live Supabase project (`ppqpazvivjomjyetkacm`) directly. every finding tagged **Solid** (read/measured), **Directional** (partial evidence), or **Vibes** (guess — none shipped here; the guesses got killed or hedged).

> note on confidence: an 8-dimension multi-agent pass generated the raw findings, then a second adversarial pass re-checked every load-bearing one against the real code and downgraded the inflated ones. severities below are the post-verification calls, not the first draft. where i overrode an agent (the canonical strategy, specifically) i say so and why.

---

## TL;DR — read this part

four things are P0. two of them are live security holes on linkdrift.app right now, and one of those is **critical and trivially exploitable**:

1. **privilege escalation: any signed-up user can make themselves admin.** ✅ **FIXED 2026-06-03** (migration `lock_profiles_role` + `lock_profiles_role_column_grant` applied to prod; `authenticated`/`anon` can no longer UPDATE `profiles.role`, verified via `has_column_privilege` + a guard trigger; username/avatar self-edits still work). original detail below for the record. signup is open (a `user` profile was created during this audit window, so the front door works), the `profiles` row's `role` column is writable by the `authenticated` role, the RLS policy only checks row ownership (not the value), and no trigger guards it. one `PATCH /rest/v1/profiles?id=eq.<me>` with `{"role":"admin"}` using the public anon key = full write access to every article, author, and site setting. not theoretical — verified against the live DB. **no standing evidence of abuse** (only 1 admin, your original account from Mar 8) — but that can't be proven retroactively (a promote→damage→demote leaves no trace), and the door is open right now. fix is one line. this outranks every SEO item.

2. **stored XSS via JSON-LD.** article titles are dropped into a `<script type="application/ld+json">` with `JSON.stringify` + `dangerouslySetInnerHTML` and no `<`-escaping. a title containing `</script>...` breaks out and runs. titles come from twitterapi.io, so it's attacker-influenceable. the code comment literally claims it's safe; it isn't.

3. **canonical leak — your entire programmatic SEO surface is deindexing itself.** every author page, every category page, and the search page emit `<link rel="canonical" href="https://linkdrift.app">` (the homepage). verified live. ~157 SSR pages are telling Google "i'm a duplicate of the homepage, drop me." this nullifies the SSR-for-SEO work and the 437-URL sitemap. one missing line per route. **highest-leverage SEO fix in the whole audit.**

4. **schema/policy drift — the repo can't reproduce the running app.** prod has 16 tables, the `profiles.role` column, ~20 admin RLS policies, and 3 functions. the repo migration (`001_initial_schema.sql`) defines **11 tables and none of the admin policies or the role column.** a buyer who runs `supabase db reset` from source gets a broken *and* insecure instance. for a sale, the asset being sold doesn't match the asset running.

the good news: the SSR work on article/author/category pages is real and decent (JSON-LD, OG images, server-rendered content), RLS is on all 16 tables in prod, the ingest cron is properly gated, and there are no secrets in source. the bones are fine. the problems are mostly cheap to fix and concentrated.

---

## phase 0 — render + data-fetch map

| route | render mode | content in initial HTML? | data fetch | notes |
|---|---|---|---|---|
| `/` | **client-only (`'use client'`)** | **no — empty shell** | `useFeed` → POST `/api/graphql` from browser | static shell prerendered (`○`), 157 kB first-load JS. 0 `<article>`/0 `<h2>` live. |
| `/article/[id]` | dynamic SSR (`ƒ`) | yes (h1, NewsArticle JSON-LD, self-canonical) | `supabaseAdmin` (service-role), no `revalidate` | ~2.6 s TTFB live. UUID URL. |
| `/author/[handle]` | dynamic SSR (`ƒ`) | yes | `supabaseAdmin`, no `revalidate` | **canonical → homepage (bug)** |
| `/category/[slug]` | dynamic SSR (`ƒ`) | yes | `supabaseAdmin`, no `revalidate`, loads ALL articles unbounded | **canonical → homepage (bug)** |
| `/search` | dynamic SSR (`ƒ`) | partial | client | correctly `noindex` |
| `/admin` | client-only | no | client hook + anon client | server-redirects unauth (middleware), but indexable + inherits `index,follow` |
| `/login` `/signup` `/forgot` `/auth/confirm` | client-only | no | client | **indexable (should be `noindex`)** |
| `/about` `/privacy` `/terms` | static (`○`) | yes | none | fine |
| `/sitemap.xml` | **static (`○`) — build-frozen** | n/a | `supabaseAdmin` at build | lastmod stuck at last deploy (2026-05-22) |
| `/robots.txt` | static | n/a | none | allow `/`, disallow `/api/` `/_next/` |
| `/api/graphql` | dynamic | n/a | resolvers (service-role) | **public, introspection on, no limits, linked as "API"** |
| `/api/ingest` | dynamic | n/a | twitterapi.io → DB | cron-gated (`Bearer CRON_SECRET`) ✓ |
| `/feed`, `/feed/[slug]`, `/feed/author/[handle]` | dynamic | n/a | DB | RSS/Atom, excluded from middleware |

---

## P0 — blocks indexing or is a security/data risk

| # | finding | conf | file / route | why it matters | concrete fix | load-bearing |
|---|---|---|---|---|---|---|
| P0-1 ✅ FIXED | **Privilege escalation: any user can self-promote to admin.** `authenticated` held `UPDATE` on `profiles.role` (via a table-level grant); RLS `profiles` UPDATE policy is `USING/WITH CHECK (auth.uid()=id)` only (no value guard); the only trigger (`trg_profiles_updated`) just sets `updated_at`. role default is `'user'`, `is_admin()` gates on `role='admin'`, and admin RLS policies grant full write to articles/authors/submissions/site_settings/etc. | **Solid** (live DB verified) | live: `public.profiles` policies + column grants; migration `supabase/migrations/002_lock_profiles_role.sql` | a free signup + one anon-key PATCH = total content-platform compromise (deface/delete all articles, change site settings). anon key is public (`NEXT_PUBLIC_`). | **DONE:** revoked table-level UPDATE, re-granted UPDATE on every column except `role`, added a `BEFORE UPDATE` guard trigger (allows `service_role` + existing admins). verified `has_column_privilege(authenticated, role, UPDATE)=false`. **residual follow-up:** the admin "change another user's role" UI (`admin-sidebar.tsx:289`, `admin/page.tsx:430`) was already non-functional (RLS restricts to own row) and is now also grant-blocked — it needs a proper service-role API route gated on `is_admin()`. | **yes** |
| P0-2 | **Stored XSS via unescaped JSON-LD.** `JSON.stringify(jsonLd)` → `dangerouslySetInnerHTML` with no `<`/`</script>` escaping; values include `article.title` (from twitterapi.io). | **Solid** | `src/app/article/[id]/page.tsx:238,242-245`; same pattern `src/app/json-ld.tsx:21` (static data, lower risk) | a crafted article/post title `</script><script>…` executes in every visitor's browser on that article page. | escape before injecting: replace `<` with `<` (and `>`,`&`) in the serialized string, or render JSON-LD via a hardened serializer. delete the false "JSON.stringify escapes them" comment. | **yes** |
| P0-3 | **Canonical leak — author/category/search pages canonicalize to the homepage.** their `generateMetadata` sets OG/Twitter but not `alternates.canonical`, so they inherit the root layout's `alternates:{canonical:'/'}`. | **Solid** (live curl: `/category/tech`, `/author/cnfinancewatch` both emit `canonical=https://linkdrift.app`) | `src/app/layout.tsx:38-40`; `src/app/category/[slug]/page.tsx:44-56`; `src/app/author/[handle]/page.tsx` (generateMetadata) | tells Google ~157 SSR programmatic pages are duplicates of home → consolidates them out of the index. directly kills the scalable SEO surface and the value of the sitemap. | set a self-referential `alternates.canonical` in each `generateMetadata` (`/category/${slug}`, `/author/${handle}`). remove the hardcoded `canonical:'/'` from the root layout (or make it self-resolve per route). see canonical strategy section. | **yes** |
| P0-4 | **Schema/RLS/policy drift: prod ≠ repo.** prod = 16 tables + `profiles.role` + ~20 admin write policies + `is_admin()`/`run_db_health_check()`/`handle_new_user()`. migration `001` = 11 tables, SELECT/user-scoped policies only, no role column, no admin policies. 5 tables (`seed_accounts`, `admin_logs`, `health_checks`, `site_settings`, `trending_topics`) are queried in code but absent from migration *and* `database.ts`. | **Solid** (live `list_tables`/`pg_policies` vs migration file) | `supabase/migrations/001_initial_schema.sql`; `src/types/database.ts`; consumers in `src/app/api/trends/route.ts`, `admin/*`, `seed-accounts` | `supabase db reset` from source produces a DB with no `role` column (admin checks error), no admin policies (admin can't operate, or worse), and missing tables. for a sale this is the core transfer-readiness defect: the codebase can't rebuild the product, and the security model lives only in prod. | dump prod schema (`supabase db pull` / `pg_dump --schema-only`) into versioned migrations, regenerate `database.ts`, verify a clean `db reset` reproduces prod incl. all RLS. this is also the home for the P0-1 fix. | **yes** |

---

## P1 — high SEO / traffic leverage, or significant security / quality

| # | finding | conf | file / route | why it matters | concrete fix | load-bearing |
|---|---|---|---|---|---|---|
| P1-1 | **Homepage is a client-only shell.** the feed (your #1 entry point, sitemap priority 1.0) is fetched client-side via GraphQL; initial HTML has zero articles, zero `<h2>`, zero internal links into the content cluster. | **Solid** (live: 0 `<article>`) | `src/app/page.tsx:5,381-408`; `src/hooks/api.ts` | Google renders JS but defers it to a second wave (slow, budget-limited); every non-Google crawler/unfurler sees nothing; the homepage passes ~no internal PageRank to deep pages. suppresses (doesn't hard-block) indexing — that's why it's P1 not P0. | convert `page.tsx` to a server component that renders the first ~20 articles server-side (mirror the category page's `supabaseAdmin` select); keep Header/tabs/Load-more/TrendingSidebar as client islands; add `export const revalidate = 900`. | **yes** |
| P1-2 | **Feed cards link OUT to x.com; internal article pages are orphaned + cards aren't even anchors.** `<article onClick={()=>onNavigate(article.xUrl)}>` → `window.open(xUrl)`. category tabs are `<button onClick>` not links. only TrendingSidebar (7 client links) points internally. | **Solid** | `src/app/page.tsx:201-205,121,402-408`; `src/components/ads/monetag.tsx:257-271` | the feed hard-bounces every click off-site instead of funneling users *through* your own pages (worse dwell, no on-site journey, and crawlers never traverse the internal cluster). even with article pages noindexed, they should be the link target that routes crawl + users on to the rankable curation pages; also the keyboard-accessibility bug (P1-12) has the same root cause. | wrap each card in `<Link href={`/article/${id}`}>`; move the "read on X" + ad interstitial to the article detail page (it already has the CTA). pairs with P1-1 so links exist in initial HTML. | **yes** |
| P1-3 | **Sitemap is build-frozen.** `sitemap.ts` queries the DB but declares no `revalidate`/`dynamic`, so Next generates it once at build. lastmod stuck at 2026-05-22. | **Solid** (live + build shows `○` static) | `src/app/sitemap.ts:10-93` | every article ingested since the last deploy is missing from the sitemap → no discovery path for new UUID-only URLs (which have ~no inlinks otherwise). caps indexed inventory at deploy cadence. | add `export const revalidate = 3600` to `sitemap.ts`. when volume grows past a few thousand URLs, split into a sitemap index + per-type child sitemaps. | **yes** |
| P1-4 | **Article pages are genuinely thin AND must stay that way (IP boundary).** title + ~300-char `excerpt` + ~500-char `body_preview` + "read on X". both `excerpt` and `body_preview` are reproduced post text from a third-party scraper. | **Solid** | `src/app/article/[id]/page.tsx:384-398` | thin mirror pages rank poorly *and* — per your legal boundary — rendering post body text on an indexable page is the exact thing to avoid. the SEO value has to move off these pages. | per canonical strategy: **`noindex,follow` the article pages** (the reliable way to enforce the boundary — see below), trim `body_preview`/long `excerpt` to a short attributed teaser, and make the curation pages (home/topic/author/category) the rankable surface built on LinkDrift's *own* text. | **yes** |
| P1-5 | **No programmatic hub surface beyond 7 fixed categories, and that surface is thin + homepage-orphaned.** no topic/tag pages, no time archives, no trending hub. categories carry no original copy. | **Solid** | `src/app/category/[slug]/page.tsx`; `src/app/page.tsx`; `src/app/sitemap.ts` | this is the scalable, rankable inventory for an aggregator and it barely exists. combined with P0-3 (the bit that does exist is deindexing itself). | build out original-curation hubs (see value-add section): topic pages, author hubs with bios, trending/"this week in X", time archives. each self-canonical, internally linked, with LinkDrift editorial copy. | **yes** |
| P1-6 | **Article/author/category pages are dynamic SSR with no caching; ~2.6 s article TTFB.** no `revalidate`/`generateStaticParams`/`cache()` anywhere. service-role fetch + sequential related-article queries. | **Solid** (live 2.6 s; grep confirms no ISR) | `src/app/article/[id]/page.tsx:17-86`; `category/[slug]/page.tsx`; `author/[handle]/page.tsx` | LCP is gated by a slow origin render on every crawl/visit, no CDN cache. CWV is an explicit SEO priority. *(adversarial verifiers leaned P2 here since crawl isn't blocked; i keep P1 — the fix is cheap and the LCP win is large.)* | add `export const revalidate = 900` to all three; wrap the article fetch in React `cache()`; collapse `getRelatedArticles`' two queries into one. | **yes** |
| P1-7 | **N+1 viewer-field resolvers on the feed — confirmed live.** the `Feed` query selects `viewerHasLiked`+`viewerHasBookmarked` per node (`api.ts:91-92`); `formatFeedConnection` doesn't set them, and an explicit Apollo field resolver overrides the parent regardless, so `Article.viewerHasLiked/Bookmarked` each fire `getAuthUser()` + a DB query per node → ~20 nodes × 2 fields = up to 40 auth calls + 40 queries per feed load. | **Solid** (read the gql document) | `src/hooks/api.ts:80-92`; `src/graphql/resolvers.ts:363-397,490-519` | feed latency scales with page size; redundant `auth.getUser()` fan-out on the most-loaded query. | batch viewer state in one query keyed by article IDs; resolve `getAuthUser()` once per request (DataLoader or context memo). | yes |
| P1-8 | **Public GraphQL endpoint: introspection hardcoded on, no depth/complexity/cost limit, no rate limit, advertised as "API" in the footer.** all resolvers run on the service-role client (RLS bypassed; authz hand-rolled). | **Solid** | `src/app/api/graphql/route.ts:17`; `src/graphql/resolvers.ts`; footer link `src/app/page.tsx:470` | full schema disclosure + an un-throttled nested-query DoS/scrape surface, publicly linked. one missing `.eq('user_id', …)` in any resolver = data exposure (the service-role key has no backstop). | gate introspection behind `NODE_ENV!=='production'`; add depth + cost limiting (`graphql-armor`/`graphql-depth-limit`); add rate limiting; either remove the footer "API" link or ship a real documented, authed API. | yes |
| P1-9 | **Submission flow has no server-side validation on the live path, and the submitted URL is rendered as an admin-facing href.** the modal's Article tab does a direct anon→PostgREST `insert` into `submissions` (bypassing the validated `submitArticle` resolver, which is dead code); URL is unvalidated; admin review renders it as `<a href={url}>`. | **Solid** | `src/components/submit-modal.tsx:51-60`; `src/graphql/resolvers.ts:276-299` (unused); `src/app/admin/page.tsx` (renders submission URLs) | junk/`javascript:`/`data:` URLs reach the moderation queue; an admin clicking a malicious submitted URL = phishing/XSS against the privileged account. client also controls `status` on insert. | route submissions through the server (the existing resolver or an API route) with real validation (zod + strict `x.com/i/article` URL check); sanitize/scheme-allowlist URLs before rendering in admin; add per-user rate limiting + a `(submitted_by,url)` unique constraint. | yes |
| P1-10 | **64 TypeScript errors masked by `ignoreBuildErrors:true`** (+ ~38 `as any`). root cause: the Supabase clients aren't parameterized with the generated `Database` types, so every insert/upsert is `never`. | **Solid** (ran `tsc --noEmit` → 64 errors across 12 files) | `next.config.js:3-5`; `src/lib/supabase-*.ts`; `src/app/api/*`, `resolvers.ts`, `sitemap.ts`, etc. | a buyer's first clean `tsc` lights up red; type-broken code ships to prod; real bugs (e.g. the broken submission→author FK) hide behind the flag. | type the clients (`createClient<Database>()`), fix the surfaced errors, then flip `ignoreBuildErrors` to `false` so regressions fail the build. | yes |
| P1-11 | **README is inaccurate as a sale runbook.** wrong data vendor, wrong package manager, wrong brand/roadmap, references missing/renamed files. no `ARCHITECTURE.md`. | **Solid** | `README.md`; (missing `ARCHITECTURE.md`) | the runbook is the first thing a buyer reads; inaccuracies erode trust and raise transfer risk/price. | rewrite README to match reality (twitterapi.io, pnpm, linkdrift, current scripts/files); generate `ARCHITECTURE.md` (stack, schema, RLS model, ingest flow, env, deploy). | yes |
| P1-12 | **Homepage article cards are keyboard-inaccessible.** `<article onClick>` with no `role`, `tabIndex`, or `onKeyDown`. | **Solid** | `src/app/page.tsx:201-205` | unusable without a mouse (WCAG 2.1.1) and an SEO-adjacent quality signal. same root cause as P1-2. | fix via P1-2 — make the card a real `<a>`/`<Link>`, which gives keyboard + focus for free. | yes |

---

## P2 — polish / nice-to-have

| # | finding | conf | file / route | why | fix |
|---|---|---|---|---|---|
| P2-1 | login/signup/forgot/auth-confirm/admin inherit `index,follow` — thin utility pages indexable | Solid | each page (client) + `layout.tsx:62-72` | crawl-budget noise, empty shells in the index | add `robots:{index:false,follow:true}` via a per-route server `layout.tsx` (mirror `/search`) |
| P2-2 | article URLs are opaque UUIDs, no slug | Solid | `src/app/article/[id]` | zero keyword signal in the URL | add a `slug` column; route `/article/[id]/[slug]` or `/article/[slug]`; 301 old → new (needs redirect infra, P2-3) |
| P2-3 | no redirect infrastructure | Directional | n/a | a later slug switch would 404 every existing UUID URL + break backlinks/sitemap | add a redirect map / middleware rewrite before changing URL shapes |
| P2-4 | global JSON-LD is `WebApplication` only — no `WebSite`+`SearchAction`, no `Organization` | Solid | `src/app/json-ld.tsx` | no sitelinks search box; weaker brand entity | add `WebSite`+`SearchAction` (point at `/search?q=`) and an `Organization` node |
| P2-5 | article JSON-LD: `NewsArticle` is the wrong type (aggregated posts, not journalism); `datePublished` can be null; no publisher `logo`; headline not capped at 110 | Solid | `src/app/article/[id]/page.tsx:194-237` | risk of Google ignoring the markup; mislabels content provenance | switch to a `reference`/`CreativeWork`-style type consistent with "links to source"; guard nulls; add logo; cap headline. do **not** add `articleBody` (IP boundary) |
| P2-6 | no `BreadcrumbList` on article/category/author; no `ItemList` on feeds | Solid | all SSR pages | missing hierarchy + rich-result signals (cheap once curation pages exist) | add visible breadcrumbs + matching `BreadcrumbList`; `ItemList` on category/author listings |
| P2-7 | middleware runs `supabase.auth.getUser()` (network call) on every public page incl. crawlers | Solid | `src/middleware.ts:42,71` | adds latency to the exact pages you want crawled fast (verifier: impact modest) | narrow the matcher to exclude public content routes, or short-circuit the auth refresh when no auth cookie is present |
| P2-8 | category page loads ALL articles in the category unbounded (no limit/pagination) | Solid | `src/app/category/[slug]/page.tsx:79-109` | DOM bloat + slow render at scale; no crawlable pagination | paginate (crawlable `?page=` or `/page/N`) with `rel=prev/next` semantics |
| P2-9 | feed/category pagination is GraphQL cursor + "Load more" — not crawlable | Solid | `src/app/page.tsx:450-458`; resolvers | deep articles only reachable via sitemap, not via crawl path | provide crawlable paginated URLs on the SSR listing pages |
| P2-10 | raw `<img>` everywhere (5×), no width/height, no `next/image` | Solid | `article/[id]`, `category/[slug]`, `page.tsx` | CLS + unoptimized images despite `remotePatterns` already configured | use `next/image` with explicit sizes for cover/avatar images |
| P2-11 | CSP allows `'unsafe-inline'` + `'unsafe-eval'` on script-src (+ monetag domains); `font-src` allows dead `fonts.gstatic.com` | Solid | `next.config.js` | weakens XSS defense-in-depth (compounds P0-2); INP tax from ad scripts | tighten script-src (nonces/hashes where feasible); drop the dead font allowance |
| P2-12 | `CRON_SECRET` bearer check is a non-constant-time string compare | Solid | `src/app/api/ingest/route.ts:544,557`; `trends/route.ts` | timing side channel (low practical risk given entropy) | use `crypto.timingSafeEqual` |
| P2-13 | OAuth callback admin auto-promotion trusts the OAuth-provided username string | Directional | `src/app/auth/callback/route.ts` | given P0-1, every admin-granting path deserves scrutiny | gate admin promotion on an allowlist of stable user IDs, not a mutable username |
| P2-14 | `profiles` SELECT is `USING (true)` — all profiles world-readable | Solid | live `profiles_select`; migration `:358` | fine today (id/role/username/avatar only); becomes a leak if PII is ever added | scope SELECT or keep PII out of `profiles` |
| P2-15 | dead code `src/lib/supabase.ts` exports the exact OAuth-breaking vanilla-client pattern CLAUDE.md bans | Solid | `src/lib/supabase.ts:15-17` | a future dev importing it reintroduces the cookie/PKCE bug | delete the file |
| P2-16 | CI (`pr-steward.yml`) runs no `tsc`/`vitest`/`build` | Solid | `.github/workflows/pr-steward.yml` | nothing catches the regressions `ignoreBuildErrors` permits | add a CI job: `tsc --noEmit`, `vitest run`, `next build`, `next lint` |
| P2-17 | broken npm scripts (`ingest` → missing file, `codegen` → no binary); ESLint not in `package.json`; dual lockfiles (`package-lock.json` + `pnpm-lock.yaml`) | Solid | `package.json` | buyer friction; `next lint` is non-functional | fix/remove scripts; add eslint deps or drop the script; delete `package-lock.json` (pnpm-only per CLAUDE.md) |
| P2-18 | `author.bio` and `avg_rating`/`rating_count` are stored but rendered on zero pages | Solid | `src/types/database.ts`; author/article pages | **free original content + a unique ranking signal left unused** — gold for the IP-safe value-add | render bios on author pages; surface ratings as a "LinkDrift score" on listings (see value-add) |
| P2-19 | no `not-found.tsx`/`loading.tsx`/`error.tsx`; RSS feeds not advertised via `<link rel=alternate>` | Solid | `src/app/*` | bare 404 dead-ends (no inlinks/metadata); feed discovery missed | add custom not-found with internal links + loading skeletons; advertise feeds in `<head>` |
| P2-20 | leftover `console.log` in ingest + auth-callback; trends cron not wired in `vercel.json`; text contrast (`zinc-600/500` on `zinc-950`) fails WCAG AA | Solid | `api/ingest`, `auth/callback`, `vercel.json`, global | housekeeping + a11y polish | strip logs; wire/remove the trends refresh; bump muted-text contrast |

---

## canonical strategy (driven by your IP boundary)

> **i overrode the audit workflow here.** its canonical agent concluded "x.com canonical is a non-starter; self-canonical is the only viable strategy" — that optimizes for capturing ranking value and **contradicts your legal boundary.** your constraint wins: pages that mirror a single source post must not become a rankable substitute for the post; LinkDrift self-canonical is reserved for pages built from LinkDrift's own original curation.

**the one real decision: how to keep article pages out of the index.** there are two mechanisms and they're mutually exclusive (Google's own guidance says don't combine `noindex` with a canonical pointing elsewhere — contradictory signals). pick one for `/article/[id]`:

| option | what it does | catch |
|---|---|---|
| **`noindex,follow` (recommended)** | hard-excludes article pages from the index, still lets crawl flow through their internal links to your curation pages | forfeits any ranking on article URLs (which is the point, given the boundary) |
| `rel=canonical → x_url` | signals "x.com is the source" | cross-domain canonical is a **hint Google routinely ignores** when the pages aren't near-duplicates — and your article page (LinkDrift chrome + teaser + outbound link) is NOT a duplicate of the X post, so Google may index it anyway. weaker enforcement of the boundary |

**DECISION (made 2026-06-03, per Joe's "whichever doesn't get me C&D'd"): `noindex,follow` on article pages.** it's the only option that *enforces* the IP boundary — canonical→x.com is a hint Google ignores for non-duplicate pages, which is exactly how an article page ends up indexed and earns the C&D. provenance is already carried by the visible "Read full article on X" link, so nothing is lost. this is locked; the implementation (a `noindex` robots directive on `/article/[id]`) is part of P1-4, to wire when the SEO work is greenlit.

| page type | mirrors a single post? | directive | justification |
|---|---|---|---|
| `/article/[id]` | yes | **`noindex,follow`** (decided) | exists to point at one scraped post; must not be a rankable substitute. stays a thin, fast, attributed click-through (good for UX + the ad interstitial) and a crawl conduit to curation pages. |
| `/` (home/feed) | no — curated list | self-canonical, indexable | LinkDrift's own ranked/curated index, not a copy of any one post. rankable text = LinkDrift curation + short attributed teasers linking out. |
| `/category/[slug]`, future `/topic/*`, `/tag/*` | no — original curation | self-canonical, indexable | original editorial framing + ordering is LinkDrift's. fix the P0-3 leak by setting self-canonical here. |
| `/author/[handle]` | no — LinkDrift-authored index + bio | self-canonical, indexable | the author *hub* (bio, stats, their LinkDrift index) is original; individual posts still link out. |
| `/search` | no | self-canonical + `noindex` | utility page; already noindexed. |

**guardrails baked in (applies to every indexable page, not just article detail):** the home and category/topic listings currently render `article.excerpt` — that's post-derived text too, same boundary as `body_preview`. keep any post snippet on an indexable page to headline/teaser length with `@handle` attribution + an outbound link to x.com; no full post text, no rehosted post images served from the LinkDrift domain; no "summary" so complete it substitutes for reading the original.

---

## original value-add surface (IP-safe — LinkDrift's own material only)

the rankable inventory moves onto curation pages whose text is **LinkDrift's**, not the posts'. cheap wins first:

- **author hubs** — render the already-stored `author.bio`, a one-line LinkDrift "what they write about" blurb, follower/article counts, and a ranked index of their pieces (titles as teasers, links out). self-canonical, internally linked from every article. (uses P2-18.)
- **"LinkDrift score" / ranking context** — `avg_rating`/`rating_count` are stored and unused. surface them as an original ranking signal on listings ("ranked by reader signal"). that ordering + the score is your editorial layer, not post content.
- **topic / tag pages** — cluster articles into topics with a short original intro paragraph per topic ("the best long-form X writing on stablecoins, updated weekly"). pure programmatic surface, all original copy + attributed teasers.
- **time archives + trending hubs** — "/this-week", "/2026/05" with a one-line original editorial recap and a ranked list. fresh, crawlable, original-framed.
- **"why it matters" one-liners** — short original editorial notes LinkDrift writes per featured article (not a summary of the post — your take on why it's worth the click). this is the line to walk carefully: keep it your commentary, not the post's content.
- **related/clustering context** — the existing related-articles module is the one real value-add today; expand it (cross-author topic clusters) and fix its sequential queries.

net: article pages become attributed launchpads (canonical → x.com), curation pages become the indexable, original-content inventory (canonical → self). that's both the IP-safe and the stronger-SEO architecture.

---

## recommended execution order

**fix today (live security, cheap, high-stakes):**
1. ~~**P0-1** privilege escalation~~ ✅ **DONE 2026-06-03** (migration applied to prod + verified).
2. **P0-2** JSON-LD XSS escaping.
3. **P0-3** canonical leak — add self-canonical to author/category metadata. (one-line-per-route, recovers ~157 pages.)

**this week (transfer + SEO foundation):**
4. **P0-4** capture prod schema/policies into versioned migrations + regen types (also lands P0-1's migration). unblocks everything sale-related.
5. **P1-1 + P1-2 + P1-12** server-render the homepage feed with internal `<Link>`s (one change fixes the shell, the orphaning, and the a11y bug).
6. **P1-3 + P1-6** add `revalidate` to sitemap + article/author/category (ISR; fixes staleness + TTFB together).
7. **P1-4 + canonical strategy** set article pages `noindex,follow` (decided — enforces the IP boundary), trim `body_preview`/long `excerpt` to attributed teasers, confirm curation pages self-canonical.

**next (leverage + hardening):**
8. **P1-5** build the programmatic curation surface (author hubs first — cheapest, reuses stored bio/ratings).
9. **P1-8 + P1-9** lock down GraphQL (introspection/limits) + submission validation.
10. **P1-10 + P1-11 + P2-16** type the Supabase clients, flip `ignoreBuildErrors:false`, rewrite README + `ARCHITECTURE.md`, add a real CI gate.

**then:** work the P2 list (noindex utility pages, slugs+redirects, structured-data completeness, images, CSP, housekeeping).

rationale: security first because it's live; canonical leak next because it's the single highest SEO ROI (trivial fix, recovers your whole programmatic surface); schema drift early because every sale/transfer item depends on a faithful repo; then the homepage SSR + ISR cluster which is the bulk of the organic-traffic upside; programmatic surface last among the big rocks because it's the most build-heavy and benefits from the foundation being fixed first.

---

## couldn't verify / caveats

- **CWV field numbers (LCP/CLS/INP).** i have build bundle sizes (home 157 kB first-load JS, article 93.9 kB, middleware 74.6 kB) and a live article TTFB (~2.6 s, single sample, possibly cold-start), but no Lighthouse/CrUX run — no field LCP/CLS/INP. the perf findings are architectural (Solid on the causes) but the magnitudes are Directional until you run Lighthouse against prod.
- **the 2.6 s article TTFB is one sample.** dynamic SSR + middleware auth + service-role fetch all plausibly contribute; could be partly cold start. re-measure warm before quoting it as a fixed number.
- **P1-7 N+1 is now confirmed** (read `api.ts` — the `Feed` query selects `viewerHasLiked`/`viewerHasBookmarked`, and Apollo field resolvers override the parent, so it fires on the main feed). the exact per-load multiplier still depends on logged-in vs anon (anon short-circuits to `false` after one `getAuthUser()`), but the N+1 pattern itself is Solid.
- **prod RLS was read, not pen-tested.** i read every policy + column grant + trigger for the privilege-escalation path and it's conclusive on paper (Solid). i did **not** execute an actual self-promotion against prod (that would be a destructive change to your live data). if you want, i can run a read-only proof in a throwaway Supabase branch.
- **admin role-management path.** the `profiles` UPDATE policy is `auth.uid()=id` only, so an admin changing *another* user's role from the browser anon client would be RLS-denied — meaning that specific admin action is either broken in prod or routed differently. didn't fully trace it.
- **a second recent signup exists** (one `role='user'` profile created today 2026-06-03 08:47 UTC). not an admin, not a sign of exploitation — flagging only because it's a real account created during the audit window.
- this audit read the repo at HEAD `4383afe` on a fresh clone (your `/Volumes/onn/byli-work` wasn't mounted). if the onn clone has uncommitted work, re-check against it.

---

*generated 2026-06-03. audit only — nothing was changed in the repo or the database. pick what to action and i'll implement.*
