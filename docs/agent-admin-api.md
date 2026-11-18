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
| `setting.update` | `key`, `value` | Update an existing boolean setting, or numeric featured_limit |
| `health.run` | None | Run fresh database health checks and return the summary |
| `profile.role` | `id`, `role` | Switch user/moderator only; existing admins and owner protected |
| `seed.create` | `handle`, `status`, optional `high_yield` (boolean) | Create seed; record owner as submitter |
| `seed.update` | `id`, `status`, `high_yield` (boolean) | Change seed status and high-yield flag |
| `seed.delete` | `id` | Permanently remove seed |

Seed status is pending, approved, or rejected. Handles contain 1–50 ASCII letters, digits, or underscores, without `@`. Boolean settings are `ingestion_enabled`, `submissions_enabled`, `signup_enabled`, and `maintenance_mode`. `featured_limit` requires an integer from 0 to 100 and is stored as a JSON number, not coerced to a boolean. No other setting keys are writable.

Successful mutations return `{ "ok": true, "data": [{ "id": "..." }], "auditRecorded": true }` (setting updates return `key`). Missing targets or a submission no longer pending return 409. Validation errors return 400, authentication failures return the auth layer's 401/403, and database failures return a generic 500 without internal details. JSON bodies are limited to 8192 bytes, including requests without Content-Length.

## Separate routes and limits

Submission approval must use the existing ingestion-backed approval route, not a raw status edit. Ingestion is a separate API. Consult the credential lifecycle and route integration documentation for those routes and token creation/revocation.

This API grants application administration, not hosting, repository, DNS, database console, infrastructure secrets, or unrestricted Supabase access. It does not change external agent approval requirements. `profile.role` can switch user and moderator roles only. All bearer credentials, including owner-issued credentials, are forbidden from granting admin or demoting an existing admin. Every bearer credential is also prohibited from changing the pinned owner account's role. Giving another account the admin role does not make it the owner or permit credential lifecycle management. Authentication identities cannot be altered. `list.health` reads recorded checks; `health.run` creates a fresh run and returns its summary as the single element in `data`. The health RPC is fixed and cannot be selected by the caller.

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

Apply `20261118020756_agent_credentials.sql` before enabling clients. Deploy this branch only after tests/review. No production token was issued during development. A real randomly generated disposable test token was authenticated, expired, revoked, and rechecked using the production auth function with an isolated PostgreSQL adapter; its database was destroyed and its secret was never printed. HTTP route tests use mocks; a full deployed HTTP-to-Supabase end-to-end test remains pending. Run `node supabase/tests/run-agent-credentials.mjs`, `vitest run`, `tsc --noEmit`, and `next build`. After rollout, the owner should issue a short-lived token and verify a read-only list request, revoke it, and verify the same request is denied before issuing the operational key. Do not test on real pending submissions. Never distribute a Supabase service-role key as a substitute.

Role demotion disables a principal’s credentials while they are not an admin; restoring their role restores any still-valid, unrevoked credentials. Explicit key revocation is permanent and owner-only. This is separate from normal administrator role management.

## Owner-only admin promotion and demotion

`POST /api/admin/roles` accepts `{ "id": "profile-uuid", "role": "user|moderator|admin" }` from the verified owner's same-origin browser session only. Authorization headers are rejected, even when owner cookies are also present. Non-owner admins cannot use this endpoint. The owner cannot demote their own account. Updates use the owner's authenticated Supabase session, not a service-role client, so the database guard sees the verified caller. Admin promotion/demotion is reserved to that owner session across API and direct database-access paths by the accompanying database guard.

Owner account demotion/deletion is rejected to avoid lockout. Ownership transfer or recovery is deliberately not exposed through an agent token or generic admin route: it requires a separately authorized, reviewed server/database migration updating both verified identity bindings and policy constants. Privileged database operators who can change the schema remain a trusted infrastructure boundary; this feature cannot prevent a database owner from deliberately replacing its enforcement code.

The role-control migration also guards INSERT and DELETE, not only UPDATE, and records successful admin transitions in the same database transaction. Failure to write that audit aborts the transition. It uses `auth.identities.provider_id`, never user-editable identity metadata. A service-role request with no authenticated owner session cannot grant/remove administrators. Deploy both migrations before the API code.

## Owner key panel

The existing admin dashboard includes an owner-only **Agent keys** tab. Visibility is based on a successful server credential-list check, not merely a client-side admin flag. Server checks remain authoritative for every operation.

Create a labeled key with a 1–90 day expiration; optionally associate it with another current administrator. The new secret starts hidden and exists only in memory. Reveal it when ready to save it in your agent’s secret store, or dismiss it permanently. The panel never saves plaintext to local/session storage or logs. Existing secrets cannot be retrieved from the list.

**Test read** performs only a one-category read and reports the HTTP status without displaying data. Revoking a newly created key additionally retries that same harmless read with the now-revoked credential; HTTP 401 confirms denial. Neither action touches submissions. Rotation revokes the old key before issuing a replacement, so access is interrupted until the new key is installed. If replacement issuance fails or is unconfirmed, the old key stays revoked; refresh the list before retrying.
