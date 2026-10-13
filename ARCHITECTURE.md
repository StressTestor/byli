# architecture

linkdrift.app: an aggregator for long-form X Articles. A daily cron pulls articles from seed accounts and a global search through twitterapi.io, classifies them, and serves them as a server-rendered feed, per-category and per-author pages, RSS/Atom/JSON feeds, and a private GraphQL API for the site's client components.

## stack

| layer | technology | notes |
|-------|-----------|-------|
| framework | Next.js 14.2.35 (app router) | server components for content pages, client components for auth/admin |
| language | TypeScript 5.9 | `tsc --noEmit` is clean and the build type-checks (no `ignoreBuildErrors`) |
| database / auth | Supabase (Postgres 17, Supabase Auth) | project `ppqpazvivjomjyetkacm`; GitHub, X and email auth |
| supabase clients | `@supabase/ssr` 0.5.2, `@supabase/supabase-js` 2.98.0 | pinned exactly; see gotchas before bumping ssr |
| API | Apollo Server 4 + `@as-integrations/next` | `/api/graphql`, private BFF for the site |
| ingestion source | twitterapi.io | paid per request; key in `TWITTERAPI_IO_KEY` |
| styling | Tailwind CSS 3.4, Geist font | design notes in `docs/refined-dark-design.md` |
| ads | Monetag | toggled by `NEXT_PUBLIC_MONETAG_ENABLED` |
| analytics | `@vercel/analytics` | |
| tests | Vitest 4 | `pnpm test` |
| package manager | pnpm 10.28.2 | `packageManager` in package.json; no npm/yarn lockfiles |
| hosting | Vercel (Hobby) | auto-deploys `main` |

## directory structure

```
byli-work/
├── src/
│   ├── app/                     # Next.js app router
│   │   ├── page.tsx             # home feed, server-rendered (lib/home-feed.ts)
│   │   ├── article/[id]/        # article page + per-article OG image
│   │   ├── author/[handle]/     # author page
│   │   ├── category/[slug]/     # category page
│   │   ├── search/              # search page
│   │   ├── feed/                # RSS/Atom/JSON: /feed, /feed/[slug], /feed/author/[handle]
│   │   ├── admin/               # admin dashboard (client, gated by role + RLS)
│   │   ├── auth/callback/       # OAuth code exchange, profile fill-in, admin promotion
│   │   ├── auth/confirm/        # "check your email" page
│   │   ├── login/ signup/ forgot/
│   │   ├── about/ privacy/ terms/
│   │   ├── sitemap.ts robots.ts opengraph-image.tsx
│   │   └── api/
│   │       ├── graphql/         # Apollo handler
│   │       ├── ingest/          # cron (GET) + manual single-tweet ingest (POST)
│   │       ├── admin/submissions/[id]/approve/   # approve a submission via ingest
│   │       └── seed-accounts/   # list approved seed accounts, submit a handle
│   ├── components/              # feed cards, header, admin sidebar, submit modal, ads, auth UI
│   ├── graphql/                 # schema.graphql, resolvers.ts, server.ts, depth-limit.ts, contract test
│   ├── hooks/                   # api.ts (client gql() helper + hooks), useAdminProfile
│   ├── lib/                     # supabase clients, ingest, feeds, helpers (see below)
│   ├── config/title-blocklist.ts   # titles hidden from feed, trending and RSS
│   ├── scripts/seed.ts          # `pnpm db:seed`
│   ├── types/
│   │   ├── supabase.ts          # GENERATED from the live schema; don't hand-edit
│   │   └── database.ts          # app-level aliases over the generated types
│   └── middleware.ts            # session refresh + redirects, allowlisted routes only
├── supabase/migrations/         # full history, one file per production version
├── docs/refined-dark-design.md  # design spec and SEO/indexing decisions
├── next.config.js               # CSP and security headers, image hosts
├── vercel.json                  # cron schedule
├── vitest.config.ts
└── package.json
```

`src/lib/` holds the shared server logic:

| file | what |
|---|---|
| `supabase-admin.ts` | service-role client (server only, bypasses RLS) |
| `supabase-server.ts` / `supabase-browser.ts` | cookie-based SSR clients typed as `SupabaseClient<Database>` |
| `ingest.ts`, `ingest-utils.ts` | twitterapi.io fetch (typed `TwitterApiError`), classification, dedup, article writes, `ingest_runs` records |
| `concurrency.ts` | bounded-concurrency runner for the timeline phase |
| `home-feed.ts`, `feed.ts` | `get_feed` callers for the home page and RSS/Atom/JSON |
| `title-filter.ts` | applies `config/title-blocklist.ts` |
| `tweet-id.ts` | extracts a tweet id from an x.com status URL |
| `health-check.ts` | runs `run_db_health_check()` and loads that run's rows |
| `auth-callback.ts` | `safeNextPath`, admin GitHub identity match, OAuth username |

## key patterns

### data flow

```
vercel cron 00:00 UTC ──GET /api/ingest (Bearer CRON_SECRET)──> lib/ingest.ts
   ingest_runs row ('running')
   seed_accounts timelines, oldest last_checked_at first, 3 at a time, 35s budget
   + global "x.com/i/article" search, 50s budget            (twitterapi.io)
   -> dedup on x_url / x_article_id -> classify -> articles, authors,
      article_categories, article_stats (service role)
   ingest_runs row -> 'ok' | 'failed'; 401/402/403/429 upstream -> HTTP 502

reader ──> app/page.tsx (server) ──> lib/home-feed.ts ──rpc get_feed──> Postgres
       ──> client components ──POST /api/graphql──> resolvers.ts ──> Postgres
       ──> /feed* routes ──> lib/feed.ts ──rpc get_feed──> RSS/Atom/JSON

user submits URL ──> submissions (pending) ──admin approve──> /api/admin/submissions/[id]/approve
   -> extract tweet id -> ingestSingleArticle -> link article, mark approved
```

### auth

- providers: GitHub OAuth, X OAuth, email + password
- session management: `@supabase/ssr` cookies. `middleware.ts` refreshes the session only on its allowlisted routes (`/admin`, `/bookmarks`, `/settings`, `/submit`, `/api-keys`, `/login`, `/signup`).
- role model: `profiles.role` in `user | moderator | admin`. Clients can't write `role`: there's no column grant, and the `prevent_profile_role_change` trigger blocks INSERT and UPDATE from non-admins.
- admin elevation: on GitHub sign-in, `auth/callback` promotes the account whose GitHub identity id equals `ADMIN_GITHUB_ID` (`ADMIN_GITHUB_USERNAME` is the fallback while the id is unset). There's no role UI; other role changes are SQL.
- protected surfaces: admin pages check the role client-side, and RLS admin policies enforce it. `/api/admin/*` calls `is_admin()` as the signed-in user.
- profile creation: the `handle_new_user()` trigger on `auth.users` creates the profile, taking a validated username from signup metadata.

### state management

Content pages are server components that read through the service-role client, with ISR or `force-dynamic` per route. Interactive pieces (likes, bookmarks, ratings, submit, admin) are client components using `hooks/api.ts` against `/api/graphql` or the browser Supabase client under RLS. There's no global client store.

### API design

- style: GraphQL (Apollo Server 4), schema in `src/graphql/schema.graphql`; `src/graphql/server.ts` builds the server for both the route and the tests
- base path: `POST /api/graphql` (GET returns 405)
- consumers: the site only (`hooks/api.ts`, `components/feed/home-feed.tsx`). It isn't a public product API.
- auth: Supabase session cookie, resolved in resolvers via `createSupabaseServer()`
- limits: query depth 7 (`depth-limit.ts`). There's no breadth/alias cap and no rate limit yet.
- introspection: off in production
- pagination: Relay-style connections. The feed pages by `published_at` cursor; search and trending page by offset cursor, counted before the title blocklist filter.
- contract: `src/graphql/contract.test.ts` runs every schema field and the site's exact operation strings (`src/graphql/test-fixtures/frontend-operations.ts`) against a mocked data layer that rejects unknown tables, columns and RPC args. Update the fixtures when a frontend query changes.

## database

### tables

| table | purpose | RLS |
|---|---|---|
| `articles` | indexed X Articles (`status` enum, `featured`, `quality_score`) | yes: public reads published, admins all |
| `authors` | X accounts that wrote articles; claimable via X login | yes |
| `categories` | topic taxonomy (seeded) | yes, public read |
| `article_categories` | article ↔ category join | yes |
| `article_stats` | like/bookmark/comment/share/rating counters (trigger-maintained) | yes, public read |
| `profiles` | one row per auth user; `role`, `username` | yes: public read, self update (no `role`) |
| `likes`, `bookmarks`, `ratings` | per-user engagement | yes, own rows only |
| `submissions` | user-submitted article URLs, reviewed by admins | yes: own rows, admins all |
| `seed_accounts` | X handles the ingest cron scans | yes: approved public, admins all |
| `api_keys` | per-user keys (schema only; no public API) | yes, own rows |
| `admin_logs` | admin action audit trail | yes, admins |
| `health_checks` | rows written by `run_db_health_check()` | yes, admins |
| `site_settings` | admin-editable key/value flags | yes: public read, admin update |
| `ingest_runs` | one row per cron run: `running` → `ok` / `failed`, stats, error | yes, admins read; service role writes |
| `trending_topics` | legacy; its writer was removed and nothing reads it | yes, public read |

Functions: `get_feed`, `search_articles`, `feed_score` (feed ranking), `is_admin()`, and `run_db_health_check()` (admin-gated, SECURITY DEFINER). Trigger functions: `handle_new_user`, `prevent_profile_role_change`, and the `fn_*` counters.

### key relationships

- `articles.author_id -> authors.id`; `article_stats.article_id` is 1:1 with articles (row created by trigger on insert)
- `article_categories` joins articles and categories
- `profiles.id = auth.users.id`; likes, bookmarks, ratings, submissions and api_keys reference `auth.users`
- `submissions.article_id` is set when an admin approves

### migrations

- location: `supabase/migrations/<version>_<name>.sql`, one file per version in production's `supabase_migrations.schema_migrations`. Each file is byte-identical to production's stored statement, except `20260303181614` and `20260303182333`. Those two were edited so the history replays on a fresh project (see gotchas). Production already ran those versions, so the edits never run there.
- applying: changes have gone through the Supabase MCP `apply_migration` (or `supabase db push`). After applying, name the repo file with the version production recorded, so history stays 1:1.
- types: regenerate `src/types/supabase.ts` after any schema change.
- ordering: apply additive migrations (new tables) before merging the code that uses them. Merge code before applying migrations that remove things it depends on.
- replay: verified 2026-10-13. `supabase start` on an empty local stack applies all 28 migrations, and the resulting catalog (tables, functions with security mode and search_path, policies, triggers, indexes, `profiles` column grants, function EXECUTE grants, extension schemas) md5-matches production. The CLI in `devDependencies` (1.226) only supports Postgres 15 locally; production runs 17.

## environment variables

| variable | scope | purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | server | service-role client for ingest, feeds, admin routes |
| `TWITTERAPI_IO_KEY` | server | twitterapi.io API key |
| `CRON_SECRET` | server | bearer token Vercel cron sends to `/api/ingest` |
| `ADMIN_GITHUB_ID` | server | GitHub numeric id auto-promoted to admin |
| `ADMIN_GITHUB_USERNAME` | server | fallback admin match while `ADMIN_GITHUB_ID` is unset |
| `NEXT_PUBLIC_MONETAG_ENABLED` | public | ads on/off |
| `NEXT_PUBLIC_MONETAG_SITE_ID`, `_NATIVE_ZONE`, `_BANNER_ZONE`, `_INTERSTITIAL_ZONE` | public | Monetag zones |
| `NEXT_PUBLIC_FEED_AD_INTERVAL` | public | cards between feed ads |

`.env.example` lists them with where to get each value.

## deployment

### hosting

- platform: Vercel, Hobby plan
- project: `byli` (`prj_SeX5UuiTwlpH8pRLmuBeFhBj2eip`)
- team: `joes-projects-65e9bd31` (`team_8K4kARV01wT1oIHu0EZ7iUWP`)
- domains: `linkdrift.app`, `www.linkdrift.app`

### CI/CD

- push to `main` deploys production; every branch gets a preview deploy
- previews are behind Vercel deployment protection. Use a share link (`_vercel_share`) to hit them from scripts.
- the build is `next build`, which type-checks. There's no separate CI workflow; `pnpm test` runs locally.

### cron jobs

| schedule | route/handler | what it does |
|---|---|---|
| `0 0 * * *` (UTC, Hobby: within the hour) | `GET /api/ingest` | scan seed timelines + global article search, ingest new articles; returns 502 on twitterapi.io auth/quota errors, so Vercel marks the run failed; `maxDuration` 60s |

Config lives in `vercel.json`. Run it on demand from Vercel → byli → Settings → Cron Jobs → Run.

## external services

| service | purpose | auth method |
|---|---|---|
| Supabase | Postgres, auth, RLS | anon key / service-role key |
| twitterapi.io | timelines, search, article bodies | `X-API-Key` header |
| Vercel | hosting, cron, analytics | git integration |
| GitHub / X | OAuth providers (configured in Supabase Auth) | OAuth apps |
| Monetag | ads | site and zone ids |
| Google Search Console | indexing, sitemap at `/sitemap.xml` | site verification |

## gotchas

- **`/feed` returned 500 for months** -> `normalizeFeedRow` read column names from a hand-written schema that production never ran -> repo migrations are now production's real history; test feeds against a captured live row (`src/lib/feed-rss.test.ts`).
- **GraphQL search errored with `similarity(text, text) does not exist`** -> `search_articles` had `search_path` set to the single quoted schema `"public, extensions"` -> `ALTER FUNCTION ... SET search_path = public, extensions` (no quotes around the list).
- **`get_feed` silently ignored lowercase sort keys** -> the function matches `'LATEST'`, `'POPULAR'` and `'FOR_YOU'` exactly and falls back to score order -> always pass a member of `FEED_SORTS` (`lib/home-feed.ts`).
- **ingestion died for weeks with no alert (2026-09-23)** -> twitterapi.io non-2xx responses were treated as empty timelines and the cron always returned 200 -> upstream auth/quota errors now fail the run with 502, and every run lands in `ingest_runs`. Check `select * from ingest_runs order by started_at desc limit 5` and the newest `articles.indexed_at`.
- **table writes typed as `never` on SSR clients** -> `@supabase/ssr` 0.5 passes generics in an order `supabase-js` 2.98 doesn't use -> the client factories declare `SupabaseClient<Database>`. Moving to ssr 0.12 needs supabase-js ≥ 2.114 and a real OAuth login test.
- **browser client must be `createBrowserClient` from `@supabase/ssr`** -> the vanilla supabase-js client keeps the PKCE verifier in localStorage and the callback can't read it -> use `lib/supabase-browser.ts`.
- **supabase-js doesn't throw on RPC or query errors** -> `try/catch` around `.rpc()` never fires -> check `error` on every result.
- **a column-level `REVOKE` is a no-op while a table-level grant exists** -> revoke the table grant, then grant specific columns.
- **fresh-project replay failed at `ALTER EXTENSION pg_trgm SET SCHEMA extensions`** -> on current Supabase stacks privileged extensions are created by `supabase_admin`, so `postgres` can't move them -> `20260303181614` creates pg_trgm in `extensions` directly and `20260303182333` only moves it when needed.
- **`pnpm install` skipped the Supabase CLI download** -> pnpm 10 blocks dependency build scripts by default -> `pnpm.onlyBuiltDependencies: ["supabase"]` in package.json.
- **trigger functions don't need caller EXECUTE** -> Postgres checks EXECUTE on a trigger function when the trigger is created, not when it fires -> revoking EXECUTE on `handle_new_user()` from every client role is safe; signup as `supabase_auth_admin` still creates the profile (verified on the local replay).
- **user_metadata is user-editable** (`auth.updateUser`) -> never use it for authorization -> read `user.identities` (provider-set). `UserIdentity.id` is the provider's id; `identity_id` is the auth row UUID.
- **local `.env.local` points at a placeholder Supabase URL** -> local runs can't reach production data -> smoke against a preview deploy instead.
- **zsh and dynamic route paths** -> quote them in git commands: `git add 'src/app/feed/[slug]/route.ts'`.

## commands

```bash
# dev
pnpm install
pnpm dev

# build (type-checks)
pnpm build

# test
pnpm test
pnpm tsc --noEmit

# database
pnpm db:push        # supabase db push
pnpm db:reset       # supabase db reset (local)
pnpm db:seed        # tsx src/scripts/seed.ts

# trigger ingest by hand (production secret required)
curl -H "Authorization: Bearer $CRON_SECRET" https://linkdrift.app/api/ingest
```

---

*last updated: 2026-10-13 by claude*
*this file is maintained per the architecture-doc skill. update on every structural change.*
