# Client-write security migration: review and rollout

## State

Prepared, tested locally, and **not applied to any shared or live database**. The security migration is `supabase/proposed/20261014010000_lock_client_submission_columns.sql`. Applying it changes database grants, policies, and validation triggers and needs separate action-time approval. Routine application deployment approval does not cover that step. Both candidate SQL files live in `supabase/proposed/`, outside automatic migration discovery. After exact live approval and preflight, promote only the approved SQL into `supabase/migrations/` in a dedicated migration release. Do not run `db:push` to apply unapproved changes.

The isolated tests use synthetic identities and an ephemeral in-memory PostgreSQL instance. They do not load `.env`, accept a database URL, connect to Supabase, access production credentials, spend API credits, or mutate any external database.

## What changes

- `seed_accounts` and `api_keys`: remove client INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER privileges for PUBLIC, anon, and authenticated. Remove write RLS policies as a second barrier. Existing read policies and service-role grants remain.
- `submissions`: allow authenticated INSERT only on `submitted_by`, `url`, `category_id`, and `notes`. Require the user's own ID, pending status, and empty moderation fields. Split the existing permissive admin `FOR ALL` policy into SELECT, UPDATE, and DELETE policies so it cannot bypass INSERT checks.
- New submission content: require a HTTPS URL on exactly x.com or twitter.com, optionally www/mobile, with a slash after the host. Reject userinfo, explicit ports, controls, whitespace, backslashes, and URLs longer than 2048 characters. Preserve ordinary paths, query strings, and fragments, including `/i/article/...`. The separate approval endpoint still requires a status URL it can ingest.
- Notes: maximum 2000 PostgreSQL characters. JavaScript's UTF-16 length check may reject a supplementary Unicode character string slightly earlier; both stay within the server's character ceiling.
- New or changed profile usernames: allow null or 2–39 ASCII letters, digits, underscores, and hyphens. This mirrors signup and profile validation while protecting the direct-client path.

No historical content is rewritten. Validation uses invoker triggers with an empty search path, not `SECURITY DEFINER`. The trigger functions cannot be called directly by anon/authenticated. Service-role writes also obey the content rules.

A `CHECK ... NOT VALID` constraint would still reject every update to an invalid old row. The triggers instead check a field on INSERT or when that field changes. An admin can reject an unchanged old malformed submission and can repair its URL and notes separately. Old invalid usernames likewise do not prevent avatar changes. Unsafe old URLs must still render as plain text in the admin UI.

## Verified callers and compatibility

| Operation | Current caller | Impact |
| --- | --- | --- |
| Submit seed handle | `src/app/api/seed-accounts/route.ts`, `supabaseAdmin` | Preserved; server supplies pending status |
| Scan/update seed progress | `src/lib/ingest.ts`, `supabaseAdmin` | Preserved |
| Create/revoke API key | `src/graphql/resolvers.ts`, `supabaseAdmin` | Preserved; ownership filters remain on the server |
| Submit article from browser | `src/components/submit-modal.tsx`, browser client | Deploy updated form first; it omits status/article/reviewer/timestamp columns |
| Submit article via GraphQL | `src/graphql/resolvers.ts`, `supabaseAdmin` | Preserved; validated URL/notes, pending status |
| Reject/delete submission | Admin page/sidebar, browser client | Preserved by admin UPDATE/DELETE RLS |
| Approve submission | `src/app/api/admin/submissions/[id]/approve/route.ts`, `supabaseAdmin` | Preserved |
| Signup/OAuth/profile update | Profile trigger, auth callback, direct/GraphQL edits | Valid inputs and null/fallback usernames preserved |

An older cached browser form still sends protected columns, even if they are null or pending. Those requests will be denied after the migration. Deploy the compatible form before applying the database change; users with an old tab need to refresh. No browser caller in the reviewed repository writes seeds or keys directly. External clients that bypass the supported routes will lose that access deliberately.

## Isolated verification

PGlite is [PostgreSQL compiled to WebAssembly](https://pglite.dev/docs/about), not a SQL mock. The harness loads the repository's complete prior migration history with uuid-ossp and pg_trgm, supplies minimal synthetic Supabase auth/roles/default grants, and then applies both candidate migrations. It exercises actual `SET ROLE anon`, `authenticated`, admin-by-profile, and `service_role BYPASSRLS` behavior.

Run with the pinned development dependency:

```sh
node supabase/tests/run-client-security.mjs
```

A temporary external install is also supported without changing application dependencies:

```sh
npm install --prefix /tmp/linkdrift-pglite --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.9
PGLITE_MODULE_PATH=/tmp/linkdrift-pglite/node_modules/@electric-sql/pglite node supabase/tests/run-client-security.mjs
```

Coverage includes prior explicit column grants, client seed/key escalation and mutation, forged submission ownership/moderation fields, role-specific reads, URL spoofing and boundary sizes, username validation, normal and legacy admin moderation, service-role callers, rollback, and reapply. Tests also temporarily grant INSERT inside the disposable database to prove the restrictive policies work independently of column ACLs.

Latest isolated result: **28 historical migrations + 1 companion migration, 124 security assertions, rollback, and reapply passed**. `git diff --check` also passed.

Verified engine: PostgreSQL 18.6 / PGlite 0.5.9. This does not certify production schema drift, Supabase/PostgREST integration, production PostgreSQL-version behavior, concurrent traffic, or actual live grants. Those checks remain separate. [PostgreSQL's REVOKE documentation](https://www.postgresql.org/docs/current/sql-revoke.html) specifies that revoking table privileges also revokes corresponding column privileges; the harness verifies this with deliberately preexisting column grants.

## Approved rollout order

1. Deploy the compatible application changes first, including the four-column submission insert and safe legacy-link rendering. Confirm the deployed revision and allow users to refresh older tabs.
2. Obtain explicit action-time approval for this exact security migration and its target environment. Do not run live exploit probes, synthetic inserts, or rollback tests.
3. Run the prepared read-only `supabase/tests/client-security-preflight.sql` only in the approved environment. Save ACLs, column grants, policies, roles, triggers, and defaults outside the repository. If there are unexpected inherited privileges, policies, ownership, or schema differences, stop and reconcile them before applying. Do not blindly restore the example baseline rollback to a drifted database.
4. In an approved isolated/staging environment, replay the actual schema and verify ordinary supported submission, moderation, profile, and server seed/key flows. Keep test identities and data out of production.
5. Apply the reviewed migration transaction once through the project's normal migration runner. No secrets belong in commands or logs. Do not bypass or manually mark a failed migration successful.
6. Verify effective grants/policies/triggers with read-only inspection and inspect application errors for permission regressions. Use ordinary real workflows only when authorized; do not insert attack payloads into production. Content-validation failures use SQLSTATE `23514`; denied writes use `42501`.

## Recovery

Prefer a forward fix. A compatible application-only rollback can leave the security boundary intact, provided its form still sends only the four allowed fields. The pre-fix form is not compatible.

The exact repository-baseline emergency SQL is `supabase/rollbacks/20261014010000_lock_client_submission_columns.sql`, intentionally outside the automatic migrations directory. It removes the two validators, restores previous write policies, and restores the prior broad Supabase client grants. **It reopens the audited vulnerabilities.** It requires fresh action-time approval and must be reconciled with the captured pre-change ACL/policy snapshot; it is not an automatically authorized recovery step. The synthetic test rehearses this file and reapplies the migration only inside its disposable database. Production migration-history repair, if needed, is an operator decision and must not be guessed or automated here.
