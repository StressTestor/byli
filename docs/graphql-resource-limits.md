# GraphQL request bounds

The private site API at `/api/graphql` applies these bounds before database
resolvers run:

- POST JSON only, one object per request; HTTP batching is disabled.
- 64 KiB maximum body, counted while reading the stream even without a correct
  Content-Length. Oversized requests return 413; invalid JSON returns 400.
- 3,000 parser tokens, one operation per document, depth 7.
- At most 8 query root fields, 1 mutation root field, 30 aliases, and 250
  fragment-expanded field selections.
- Page sizes 1–50. The execution budget allows 10,000 estimated result-field
  units and 1,000 estimated data-work units. Nested lists multiply their child
  costs; pagination reads count even if the client selects only totalCount.

The budget uses GraphQL-coerced variables and defaults on every request,
including validated-document cache hits. Named/inline fragments are included;
fragment summaries are memoized and arithmetic saturates at the thresholds.
Conditional selections are charged conservatively even when skipped. Normal
GraphQL validation still rejects cyclic fragments and invalid operations.
Schema introspection is disabled in production; development introspection
does not consume the database-work budget.

Category and submission lists are capped at 50 (submissions newest first).
Category article counts are lazy exact HEAD counts, cached by category ID for
the request, rather than downloading the full article/category junction table.
The existing category_id index supports these counts. Viewer reads are batched
by table and authenticated user; auth, viewer values, and category values live
only in the current request. The single-mutation bound avoids cached viewer
state becoming stale across serial writes in one operation.

These are per-request amplification controls, not a distributed rate limiter
or an exact upper bound on SQL execution time. Repeated valid requests, search
and exact-count cost still need infrastructure-level abuse controls and normal
database monitoring. Adding schema list fields or changing resolver page caps
requires updating the estimator and its synthetic tests together.

Verification: GraphQL contract/resource/body/route tests use synthetic data and
mocked Supabase. They do not issue live load tests or validate production query
plans, and no database migration is required for these request bounds.
