# Agent application-admin API

`POST /api/agent/admin` accepts an application agent credential in `Authorization: Bearer <credential>` and a JSON body. Credentials are not Supabase service-role keys, GitHub tokens, Vercel tokens, browser cookies, or a general SQL interface. Never place a credential in a URL or a checked-in script.

Every operation requires an unexpired, unrevoked credential whose owner still has administrator privileges. Browser administration remains unchanged. Responses are `Cache-Control: no-store`.

## Reads

Send `{ "operation": "list.articles", "offset": 0, "limit": 50 }`.

Supported operations: `list.submissions`, `list.articles`, `list.profiles`, `list.settings`, `list.health`, `list.logs`, `list.seeds`, `list.categories`, `list.authors`.

The response is `{ "data": [...], "offset": 0, "limit": 50 }`. Limit is an integer from 1 to 100, offset from 0 to 100000. Results are ordered by ID (settings by key). Pagination is not a transactional snapshot: concurrent inserts/deletes may shift rows. These are administrator reads and may include unpublished articles, submission notes, and profile information. Credential storage tables and raw authentication data cannot be selected.

## Mutations

Each body includes `operation` and only the relevant fields below. IDs are UUID strings.

| Operation | Fields | Behavior |
|---|---|---|
| `article.feature` | `id`, `featured` (boolean) | Set featured flag |
| `article.status` | `id`, `status` | Status: pending, published, archived, rejected |
| `article.delete` | `id` | Permanently delete article; database cascades apply |
| `submission.reject` | `id` | Reject a pending submission only; record owner as reviewer |
| `setting.update` | `key`, `value` (boolean) | Update an existing boolean setting |
| `seed.create` | `handle`, `status`, optional `high_yield` (boolean) | Create seed; record owner as submitter |
| `seed.update` | `id`, `status`, `high_yield` (boolean) | Change seed status and high-yield flag |
| `seed.delete` | `id` | Permanently remove seed |

Seed status is pending, approved, or rejected. Handles contain 1–50 ASCII letters, digits, or underscores, without `@`. Boolean settings are `ingestion_enabled`, `submissions_enabled`, `signup_enabled`, and `maintenance_mode`. Numeric `featured_limit` is deliberately not exposed as a boolean toggle.

Successful mutations return `{ "ok": true, "data": [{ "id": "..." }], "auditRecorded": true }` (setting updates return `key`). Missing targets or a submission no longer pending return 409. Validation errors return 400, authentication failures return the auth layer's 401/403, and database failures return a generic 500 without internal details. JSON bodies are limited to 8192 bytes, including requests without Content-Length.

## Separate routes and limits

Submission approval must use the existing ingestion-backed approval route, not a raw status edit. Ingestion is a separate API. Consult the credential lifecycle and route integration documentation for those routes and token creation/revocation.

This API grants application administration, not hosting, repository, DNS, database console, infrastructure secrets, or unrestricted Supabase access. It does not change external agent approval requirements. It cannot grant profile roles or alter authentication identities; the current admin dashboard's user management is read-only as well. `list.health` reads recorded health checks, not a fresh health-check run.

All tests for the dispatcher use mocked database and auth clients. No production submission, seed, setting, or article is modified by these tests. No real credential has been issued by the implementation tests.

## Mutation audit guarantees

Authorization is logged separately from execution. Each validated mutation writes a target-bearing `agent_operation_attempt` before touching the target and then a correlated `succeeded`, `failed`, `no_match`, or `unknown` record. UUID targets, setting keys, or seed handles are included, not raw request bodies or credentials. If the attempt log cannot be written, the operation does not start and returns 503. If the mutation succeeds but its outcome log fails, the response remains successful with `auditRecorded: false`; do not repeat a successful mutation merely to repair its audit log. Audit logging and application writes are separate database calls, not one atomic transaction. A crash can leave an attempt without an outcome; investigate target state before retrying.

## Owner-only credential lifecycle

`/api/admin/agent-credentials` requires a verified Supabase cookie session, current admin role, and BOTH the pinned owner account UUID and GitHub provider ID (verified against `auth.identities`, not user-editable metadata). No bearer credential or other browser admin can issue, list, revoke or rotate these keys. Normal administration remains available to those admins. The owner binding is in `src/lib/credential-owner.ts`; changing it is a reviewed server deployment, never an API parameter.

- GET lists credential metadata (never secret hashes).
- POST JSON `{ "label": "my-agent", "expiresInDays": 30 }` issues a full application-admin credential. Optional `adminUserId` associates a credential with another current admin. The returned `token` is shown once; store it in the other agent's secret store, not source control/chat/logs.
- DELETE JSON `{ "id": "credential-uuid" }` revokes any credential, including those associated with other admins.
- POST and DELETE require `Origin` exactly equal to the site's request origin. Invoke using the owner's existing same-origin logged-in session. Do not export browser cookies.
- Rotation is owner-controlled revoke + issue. No refresh token or automatic bearer self-rotation exists. Revocation prevents new authorizations, not a request already authorized/in flight.

Secrets contain 256 random bits and only SHA-256 digests persist. Credentials expire in 1–90 days; demotion/deletion of their associated admin disables them. Credential tables deny all browser-role access and enable RLS. Audit unavailability fails authorization closed. Issuance audit records intent, not proof of success; revocation remains effective even if its audit write fails (`auditRecorded:false`). API responses are no-store.

`POST /api/admin/submissions/:id/approve` and `GET|POST /api/ingest` also accept `Authorization: Bearer <token>`. Browser approval and existing cron-secret ingestion continue to work. The ingestion endpoint incurs upstream API usage just as a scheduled run does. No Supabase service key, cron secret, GitHub access, hosting access or arbitrary SQL is granted. App tokens do not bypass an agent's own review/confirmation controls.

## Rollout / verification

Apply `20261118015049_agent_credentials.sql` before enabling clients. Deploy this branch only after tests/review. No real token was issued during development; all tests use mocks or an ephemeral PostgreSQL instance. Run `node supabase/tests/run-agent-credentials.mjs`, `vitest run`, `tsc --noEmit`, and `next build`. After rollout, the owner should issue a short-lived token and verify a read-only list request, revoke it, and verify the same request is denied before issuing the operational key. Do not test on real pending submissions. Never distribute a Supabase service-role key as a substitute.
