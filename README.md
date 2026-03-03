# Byline

**The discovery layer for X Articles.**

Byline indexes, categorizes, and surfaces X Articles — a long-form content format with no native discovery mechanism. The website is the demo. The API and dataset are the product.

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase`)
- A [Supabase project](https://supabase.com/dashboard)
- A [Netrows API key](https://netrows.com) ($49/mo)

### 2. Clone & Install

```bash
git clone https://github.com/YOUR_USER/byline.git
cd byline
npm install
```

### 3. Environment

```bash
cp .env.example .env.local
# Fill in your Supabase URL, keys, and Netrows API key
```

### 4. Database

```bash
# Link to your Supabase project
supabase link --project-ref YOUR_PROJECT_REF

# Run the migration
supabase db push

# Seed with demo data
npm run db:seed
```

### 5. Run

```bash
npm run dev
# Open http://localhost:3000
```

---

## Architecture

```
Netrows API ──→ Ingestion Worker ──→ PostgreSQL (Supabase)
                                          │
Community Submissions ──────────────────→ │
                                          ↓
                                    GraphQL API (Apollo)
                                          │
                                    ┌─────┴─────┐
                                    │            │
                              Next.js App   Public API
                              (Frontend)    (Developers)
```

See `Byline-Architecture-Spec-v1.docx` for the complete technical specification.

## Project Structure

```
byline/
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql    # PostgreSQL schema (the asset)
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── graphql/route.ts      # GraphQL endpoint
│   │       └── ingest/route.ts       # Cron ingestion worker
│   ├── graphql/
│   │   ├── schema.graphql            # GraphQL SDL
│   │   └── resolvers.ts             # Query/mutation logic
│   ├── hooks/
│   │   └── api.ts                    # React hooks (useFeed, useAuth, etc.)
│   ├── lib/
│   │   └── supabase.ts              # Supabase client (browser/server/admin)
│   ├── types/
│   │   └── database.ts              # TypeScript types
│   └── scripts/
│       └── seed.ts                   # Database seeder
├── .env.example
├── package.json
├── vercel.json                       # Cron config
├── next.config.js
└── tsconfig.json
```

## Key Files

| File | What It Is |
|------|-----------|
| `001_initial_schema.sql` | 10 tables, 16 indexes, 8 triggers, RLS policies, feed scoring function. This is the core asset. |
| `schema.graphql` | Public API contract. Relay-style pagination, rate limit tiers, viewer-aware fields. |
| `resolvers.ts` | All query/mutation logic. Auth-gated mutations, cursor pagination, search. |
| `route.ts` (ingest) | Cron worker pulling from Netrows, auto-categorizing, deduplicating. |
| `api.ts` (hooks) | Frontend data layer. `useFeed`, `useArticle`, `useEngagement`, `useAuth`. |
| `supabase.ts` | Three client variants: browser (RLS), server (cookie-based), admin (service role). |

## API

GraphQL endpoint: `POST /api/graphql`

```graphql
# Browse the feed
query {
  articles(first: 20, sort: FOR_YOU, category: "tech") {
    edges {
      node { id title author { handle } stats { likeCount } }
      cursor
    }
    pageInfo { hasNextPage endCursor }
  }
}

# Single article
query {
  article(id: "uuid-here") {
    title bodyPreview xUrl
    author { handle displayName verified }
    stats { likeCount bookmarkCount avgRating }
  }
}

# Engagement (requires auth)
mutation {
  likeArticle(articleId: "uuid-here") {
    id stats { likeCount } viewerHasLiked
  }
}
```

### Rate Limits

| Tier | Requests/min | Cost |
|------|-------------|------|
| Public | 30 | Free |
| Developer | 300 | Free (key required) |
| Pro | 3,000 | $29/mo |
| Enterprise | Custom | Custom |

## Deploy

```bash
# Deploy to Vercel
vercel --prod

# The cron job (/api/ingest every 15 min) activates automatically via vercel.json
```

## Roadmap

- [x] Database schema with triggers and RLS
- [x] GraphQL API with auth-gated mutations
- [x] Ingestion pipeline (Netrows)
- [x] Frontend hooks
- [ ] Next.js pages (port from MVP React component)
- [ ] Auth UI (login/signup/X OAuth)
- [ ] Author claiming flow
- [ ] Developer portal + API key management
- [ ] Recommendation engine v2 (collaborative filtering)
- [ ] Analytics dashboard for claimed authors

---

**© 2026 Byline**
