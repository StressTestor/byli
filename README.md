# linkdrift

long-form X Articles have no discovery on X. linkdrift finds them, sorts them by topic, and puts them on one feed: [linkdrift.app](https://linkdrift.app).

a cron at 00:00 UTC pulls articles from 9 seed accounts plus a global search through [twitterapi.io](https://twitterapi.io), classifies them, and stores a teaser (title, X's own preview text, author, link back to x.com). no article bodies get republished. 799 articles indexed as of 2026-10-13.

what's there:

- server-rendered home feed with for you / latest / popular sorts
- category and author pages, search
- RSS, Atom and JSON feeds (`/feed`, `/feed/<category>`, `/feed/author/<handle>`)
- accounts via GitHub, X or email: likes, bookmarks, ratings, article submissions
- X authors can claim their author page by signing in with X
- admin dashboard: submission queue, article moderation, seed accounts, health checks

architecture, schema, env vars and the gotchas list live in [ARCHITECTURE.md](ARCHITECTURE.md).

## stack

| | |
|---|---|
| app | Next.js 14 (app router), TypeScript, Tailwind |
| data + auth | Supabase (Postgres, RLS on every table) |
| api | GraphQL (Apollo) at `/api/graphql`, used by the site's client components |
| ingestion | twitterapi.io, Vercel cron |
| hosting | Vercel |

## run it

needs node 20+, pnpm, and a Supabase project.

```bash
pnpm install
cp .env.example .env.local   # fill in supabase + twitterapi.io keys
pnpm dev
```

database: `supabase/migrations/` is the full production history, one file per version. on a fresh project:

```bash
supabase link --project-ref <your-ref>
pnpm db:push
pnpm db:seed
```

then turn on GitHub (and optionally X) in Supabase Auth with `https://<your-domain>/auth/callback` as the redirect, and set `ADMIN_GITHUB_ID` to your GitHub numeric id so your first GitHub login becomes admin.

## checks

```bash
pnpm test           # vitest
pnpm tsc --noEmit   # 0 errors, and the build type-checks
pnpm build
```

## deploy

push to `main`. Vercel builds it and the cron in `vercel.json` runs `/api/ingest` once a day (Hobby plan). to run it by hand: Vercel → project → settings → cron jobs → run.

## costs

twitterapi.io is pay as you go; the ingest code budgets $0.003 per request. with 9 seed accounts and 3 pages of global search a run comes to roughly $0.04, so about $1.10 a month at one run a day. hosting is Vercel Hobby plus one Supabase project.
