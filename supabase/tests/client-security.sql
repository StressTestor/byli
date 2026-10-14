-- Isolated assertions only. Requires the synthetic fixtures and candidate
-- migration. SET ROLE is intentional: table-owner tests would bypass RLS.
CREATE TEMP TABLE test_assertions (name text NOT NULL, role_name text NOT NULL);
GRANT SELECT, INSERT ON test_assertions TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  INSERT INTO pg_temp.test_assertions VALUES (label, current_user);
END;
$$;
CREATE FUNCTION pg_temp.expect_error(statement text, expected_code text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_code THEN
      RAISE EXCEPTION 'FAIL: %: expected SQLSTATE %, got % (%)', label, expected_code, SQLSTATE, SQLERRM;
    END IF;
    PERFORM pg_temp.assert_true(true, label);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: %: statement unexpectedly succeeded', label;
END;
$$;

-- Distinguish a missing ACL from RLS rejection when testing old column grants.
CREATE FUNCTION pg_temp.expect_acl_denial(statement text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' OR SQLERRM NOT LIKE 'permission denied for %' THEN
      RAISE EXCEPTION 'FAIL: %: expected ACL permission error, got % (%)', label, SQLSTATE, SQLERRM;
    END IF;
    PERFORM pg_temp.assert_true(true, label);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: %: statement unexpectedly succeeded', label;
END;
$$;

-- All client write grants, including explicit column grants, are gone.
DO $$
DECLARE role_name text; table_name text; privilege_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH table_name IN ARRAY ARRAY['seed_accounts', 'api_keys'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        PERFORM pg_temp.assert_true(
          NOT has_table_privilege(role_name, 'public.' || table_name, privilege_name),
          role_name || ' lacks ' || table_name || ' ' || privilege_name);
      END LOOP;
      PERFORM pg_temp.assert_true(
        NOT has_any_column_privilege(role_name, 'public.' || table_name, 'INSERT, UPDATE, REFERENCES'),
        role_name || ' lacks column grants on ' || table_name);
    END LOOP;
  END LOOP;
END;
$$;
SELECT pg_temp.assert_true(NOT has_column_privilege('authenticated', 'submissions', 'status', 'INSERT'), 'status column INSERT revoked');
SELECT pg_temp.assert_true(has_column_privilege('authenticated', 'submissions', 'url', 'INSERT'), 'URL column INSERT retained');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'validate_submission_content()', 'EXECUTE'), 'submission trigger RPC unavailable');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'validate_profile_username()', 'EXECUTE'), 'profile trigger RPC unavailable');

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT set_config('request.jwt.claim.role', 'anon', false);
SELECT pg_temp.assert_true((SELECT count(*) = 9 FROM public.seed_accounts), 'anon reads only approved seeds');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.api_keys), 'anon cannot read API keys');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.submissions), 'anon cannot read submissions');
SELECT pg_temp.expect_error($q$INSERT INTO public.submissions (submitted_by, url) VALUES ('00000000-0000-0000-0000-000000000001', 'https://x.com/anon')$q$, '42501', 'anon submission denied');
SELECT pg_temp.expect_error($q$INSERT INTO public.seed_accounts (handle) VALUES ('anonymous')$q$, '42501', 'anon seed insert denied');
SELECT pg_temp.expect_error($q$INSERT INTO public.api_keys (user_id, key_hash) VALUES ('00000000-0000-0000-0000-000000000001', 'not-a-key')$q$, '42501', 'anon key insert denied');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT pg_temp.expect_acl_denial($q$INSERT INTO seed_accounts (status) VALUES ('approved')$q$, 'old seed INSERT(status) column grant removed');
SELECT pg_temp.expect_acl_denial($q$UPDATE seed_accounts SET status = 'approved' WHERE handle = 'pending_test'$q$, 'old seed UPDATE(status) column grant removed');
SELECT pg_temp.expect_acl_denial($q$INSERT INTO api_keys (tier) VALUES ('enterprise')$q$, 'old key INSERT(tier) column grant removed');
SELECT pg_temp.expect_acl_denial($q$UPDATE api_keys SET tier = 'enterprise' WHERE user_id = auth.uid()$q$, 'old key UPDATE(tier) column grant removed');
SELECT pg_temp.expect_acl_denial($q$INSERT INTO submissions (submitted_by, url, status) VALUES (auth.uid(), 'https://x.com/old-status-grant', 'pending')$q$, 'old submission INSERT(status) grant removed even for harmless pending');
SELECT pg_temp.expect_acl_denial($q$INSERT INTO submissions (submitted_by, url, reviewed_by, reviewed_at, article_id) VALUES (auth.uid(), 'https://x.com/old-null-grants', NULL, NULL, NULL)$q$, 'old submission moderation grants removed even for harmless NULLs');
SELECT pg_temp.expect_error($q$INSERT INTO public.seed_accounts (handle, submitted_by, status, high_yield) VALUES ('escalate', auth.uid(), 'approved', true)$q$, '42501', 'user cannot self-approve a seed');
SELECT pg_temp.expect_error($q$UPDATE public.seed_accounts SET status = 'approved' WHERE handle = 'pending_test'$q$, '42501', 'user cannot update seed');
SELECT pg_temp.expect_error($q$DELETE FROM public.seed_accounts WHERE handle = 'pending_test'$q$, '42501', 'user cannot delete seed');
SELECT pg_temp.expect_error($q$TRUNCATE public.seed_accounts$q$, '42501', 'user cannot truncate seed');
SELECT pg_temp.expect_error($q$INSERT INTO public.api_keys (user_id, key_hash, tier, rate_limit) VALUES (auth.uid(), 'privileged-hash', 'enterprise', 999999)$q$, '42501', 'user cannot create privileged key');
SELECT pg_temp.expect_error($q$UPDATE public.api_keys SET tier = 'enterprise', rate_limit = 999999 WHERE user_id = auth.uid()$q$, '42501', 'user cannot upgrade key');
SELECT pg_temp.expect_error($q$DELETE FROM public.api_keys WHERE user_id = auth.uid()$q$, '42501', 'user cannot delete key directly');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.api_keys), 'user reads only own keys');

INSERT INTO public.submissions (submitted_by, url, category_id, notes)
VALUES (auth.uid(), 'https://x.com/alice/status/123?s=20#preview', (SELECT id FROM categories LIMIT 1), 'A valid note');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND article_id IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL AND created_at IS NOT NULL FROM submissions WHERE url = 'https://x.com/alice/status/123?s=20#preview'), 'submission uses safe server defaults');
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url) VALUES ('00000000-0000-0000-0000-000000000002', 'https://x.com/spoof')$q$, '42501', 'cannot spoof submission owner');
DO $$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY['status', 'article_id', 'reviewed_by', 'reviewed_at', 'id', 'created_at'] LOOP
    PERFORM pg_temp.expect_error(format('INSERT INTO public.submissions (submitted_by, url, %I) VALUES (auth.uid(), %L, DEFAULT)', column_name, 'https://x.com/forbidden-' || column_name), '42501', 'cannot supply protected column ' || column_name);
  END LOOP;
END;
$$;
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url, status) VALUES (auth.uid(), 'https://x.com/approved', 'approved')$q$, '42501', 'cannot self-approve submission');
WITH changed AS (UPDATE submissions SET status = 'approved' WHERE submitted_by = auth.uid() RETURNING id)
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM changed), 'user UPDATE blocked by RLS');
WITH changed AS (DELETE FROM submissions WHERE submitted_by = auth.uid() RETURNING id)
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM changed), 'user DELETE blocked by RLS');

DO $$
DECLARE candidate text;
BEGIN
  FOREACH candidate IN ARRAY ARRAY[
    'javascript:alert(1)', 'http://x.com/a', 'https://evil.test/x.com/a',
    'https://x.com.evil.test/a', 'https://x.com@evil.test/a', 'https://user@x.com/a',
    'https://x.com:443/a', 'https://twitter.com:444/a', 'https://x.com',
    'https://x.com/a b', E'https://x.com/a\n', E'https://x.com/a\t',
    'https://x.com/a' || chr(127), 'https://x.com/a' || chr(160),
    'https://x.com/a' || chr(65279), 'https://x.com/' || chr(92) || 'evil.test',
    'https://x.com/' || repeat('a', 2035)
  ] LOOP
    PERFORM pg_temp.expect_error(format('INSERT INTO submissions (submitted_by, url) VALUES (auth.uid(), %L)', candidate), '23514', 'invalid URL rejected: ' || candidate);
  END LOOP;
  FOREACH candidate IN ARRAY ARRAY[
    'https://x.com/i/article/123', 'https://twitter.com/alice/status/123',
    'https://www.x.com/alice/status/123', 'https://mobile.twitter.com/alice/status/123',
    'HTTPS://X.COM/alice/status/123', 'https://x.com/',
    'https://x.com/' || repeat('a', 2034)
  ] LOOP
    EXECUTE format('INSERT INTO submissions (submitted_by, url) VALUES (auth.uid(), %L)', candidate);
    PERFORM pg_temp.assert_true(true, 'valid URL accepted: ' || left(candidate, 80));
  END LOOP;
END;
$$;
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url, notes) VALUES (auth.uid(), 'https://x.com/notes-over', repeat('x', 2001))$q$, '23514', 'oversized notes denied');
INSERT INTO submissions (submitted_by, url, notes) VALUES (auth.uid(), 'https://x.com/notes-max', repeat('x', 2000));
SELECT pg_temp.assert_true((SELECT length(notes) = 2000 FROM submissions WHERE url = 'https://x.com/notes-max'), '2000-character notes allowed');

UPDATE profiles SET username = 'valid_User-2' WHERE id = auth.uid();
SELECT pg_temp.assert_true((SELECT username = 'valid_User-2' FROM profiles WHERE id = auth.uid()), 'valid profile username update allowed');
DO $$
DECLARE candidate text;
BEGIN
  FOREACH candidate IN ARRAY ARRAY['a', repeat('x', 40), 'two words', 'a.b', E'alice\n', 'álîce'] LOOP
    PERFORM pg_temp.expect_error(format('UPDATE profiles SET username = %L WHERE id = auth.uid()', candidate), '23514', 'invalid username rejected: ' || candidate);
  END LOOP;
END;
$$;
UPDATE profiles SET username = NULL WHERE id = auth.uid();
SELECT pg_temp.assert_true((SELECT username IS NULL FROM profiles WHERE id = auth.uid()), 'null username remains allowed');
RESET ROLE;

-- The existing signup trigger must remain compatible with the new validator.
INSERT INTO auth.users (id, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000005', '{"username":"new_signup"}'),
  ('00000000-0000-0000-0000-000000000006', '{"username":"invalid signup name"}'),
  ('00000000-0000-0000-0000-000000000007', '{"username":"bob"}'),
  ('00000000-0000-0000-0000-000000000008', '{"preferred_username":"oauth_user"}');
SELECT pg_temp.assert_true((SELECT username = 'new_signup' FROM profiles WHERE id = '00000000-0000-0000-0000-000000000005'), 'valid signup username preserved');
SELECT pg_temp.assert_true((SELECT username IS NULL FROM profiles WHERE id = '00000000-0000-0000-0000-000000000006'), 'invalid signup metadata becomes null without blocking signup');
SELECT pg_temp.assert_true((SELECT username IS NULL FROM profiles WHERE id = '00000000-0000-0000-0000-000000000007'), 'taken signup username becomes null without blocking signup');
SELECT pg_temp.assert_true((SELECT username = 'oauth_user' FROM profiles WHERE id = '00000000-0000-0000-0000-000000000008'), 'OAuth signup username preserved');
DELETE FROM profiles WHERE id = '00000000-0000-0000-0000-000000000005';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
SELECT pg_temp.expect_error($q$INSERT INTO profiles (id, username) VALUES (auth.uid(), 'invalid direct username')$q$, '23514', 'direct profile INSERT checks username');
INSERT INTO profiles (id, username) VALUES (auth.uid(), 'restored_user');
SELECT pg_temp.assert_true((SELECT username = 'restored_user' FROM profiles WHERE id = auth.uid()), 'valid direct profile INSERT remains allowed');
RESET ROLE;

-- Even accidental future grants cannot revive the old owner-only seed/key
-- policies. INSERT defense-in-depth checks are tested independently of ACLs.
BEGIN;
GRANT INSERT ON public.submissions, public.seed_accounts, public.api_keys TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url, status) VALUES (auth.uid(), 'https://x.com/rls-status', 'approved')$q$, '42501', 'RLS rejects non-pending independently of column ACL');
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url, reviewed_by) VALUES (auth.uid(), 'https://x.com/rls-reviewer', auth.uid())$q$, '42501', 'RLS rejects forged reviewer independently of column ACL');
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url, reviewed_at) VALUES (auth.uid(), 'https://x.com/rls-time', now())$q$, '42501', 'RLS rejects forged review time independently of column ACL');
SELECT pg_temp.expect_error($q$INSERT INTO seed_accounts (handle, submitted_by, status) VALUES ('grant-regression', auth.uid(), 'approved')$q$, '42501', 'seed mutation policy removed');
SELECT pg_temp.expect_error($q$INSERT INTO api_keys (user_id, key_hash, tier) VALUES (auth.uid(), 'grant-regression', 'enterprise')$q$, '42501', 'key mutation policy removed');
-- Restore the exact production grants in this synthetic transaction before
-- committing the assertion rows. No live grant is created by this test.
RESET ROLE;
REVOKE INSERT ON public.submissions, public.seed_accounts, public.api_keys FROM authenticated;
GRANT INSERT (submitted_by, url, category_id, notes) ON public.submissions TO authenticated;
COMMIT;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM submissions), 'other user cannot read Alice submissions');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SELECT pg_temp.assert_true((SELECT count(*) = 10 FROM seed_accounts), 'admin still reads pending seeds');
SELECT pg_temp.expect_error($q$UPDATE seed_accounts SET status = 'approved' WHERE handle = 'pending_test'$q$, '42501', 'admin browser seed writes also denied');
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url, status) VALUES (auth.uid(), 'https://x.com/admin-insert', 'approved')$q$, '42501', 'admin browser cannot override insert moderation fields');
UPDATE submissions SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'rejected' AND url = 'javascript:alert(1)' AND length(notes) = 2001 FROM submissions WHERE id = '10000000-0000-0000-0000-000000000001'), 'admin can reject unchanged malformed legacy submission');
UPDATE submissions SET url = url, notes = notes, reviewed_at = now()
WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(true, 'explicitly unchanged legacy fields remain moderatable');
SELECT pg_temp.expect_error($q$UPDATE submissions SET url = 'javascript:newBadUrl' WHERE id = '10000000-0000-0000-0000-000000000001'$q$, '23514', 'admin cannot change legacy URL to another invalid value');
SELECT pg_temp.expect_error($q$UPDATE submissions SET notes = repeat('y', 2001) WHERE id = '10000000-0000-0000-0000-000000000001'$q$, '23514', 'admin cannot change legacy notes to another oversized value');
UPDATE submissions SET url = 'https://x.com/repaired-legacy' WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT length(notes) = 2001 FROM submissions WHERE id = '10000000-0000-0000-0000-000000000001'), 'one legacy field can be corrected independently');
UPDATE submissions SET notes = NULL WHERE id = '10000000-0000-0000-0000-000000000001';
WITH changed AS (DELETE FROM submissions WHERE url = 'https://x.com/notes-max' RETURNING id)
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM changed), 'admin can still delete submission');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
UPDATE profiles SET avatar_url = 'https://example.test/avatar.png', username = username WHERE id = auth.uid();
SELECT pg_temp.assert_true((SELECT username = 'old invalid name' AND avatar_url = 'https://example.test/avatar.png' FROM profiles WHERE id = auth.uid()), 'legacy username does not block unrelated profile edits');
RESET ROLE;

SET ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO seed_accounts (handle, submitted_by, status, high_yield)
VALUES ('server_seed', '00000000-0000-0000-0000-000000000001', 'approved', true);
UPDATE seed_accounts SET articles_found = 12, last_checked_at = now() WHERE handle = 'server_seed';
SELECT pg_temp.assert_true((SELECT status = 'approved' AND high_yield AND articles_found = 12 FROM seed_accounts WHERE handle = 'server_seed'), 'service seed creation/ingestion update preserved');
INSERT INTO api_keys (user_id, key_hash, label, tier, rate_limit, revoked)
VALUES ('00000000-0000-0000-0000-000000000001', 'server-created-hash', 'Synthetic server key', 'developer', 300, false);
UPDATE api_keys SET revoked = true WHERE key_hash = 'server-created-hash';
SELECT pg_temp.assert_true((SELECT revoked FROM api_keys WHERE key_hash = 'server-created-hash'), 'service API-key creation/revocation preserved');
INSERT INTO submissions (submitted_by, url, status, reviewed_by, reviewed_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'https://x.com/service-approved', 'approved', '00000000-0000-0000-0000-000000000003', now());
SELECT pg_temp.assert_true((SELECT status = 'approved' FROM submissions WHERE url = 'https://x.com/service-approved'), 'service moderation still allowed');
SELECT pg_temp.expect_error($q$INSERT INTO submissions (submitted_by, url) VALUES ('00000000-0000-0000-0000-000000000001', 'https://attacker.test/x.com')$q$, '23514', 'service cannot bypass URL validation');
SELECT pg_temp.expect_error($q$UPDATE profiles SET username = 'invalid server name' WHERE id = '00000000-0000-0000-0000-000000000001'$q$, '23514', 'service cannot bypass username validation');
RESET ROLE;
