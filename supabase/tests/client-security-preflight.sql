-- READ-ONLY PREFLIGHT. Prepared for an explicitly approved environment.
-- This was NOT run against production while preparing the fix. Keep the result
-- with the operator's rollback record; do not commit real production metadata.
SELECT current_database(), version();
SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS owner, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'submissions', 'seed_accounts', 'api_keys');
SELECT attrelid::regclass AS relation, attname, attacl
FROM pg_attribute
WHERE attrelid IN ('public.profiles'::regclass, 'public.submissions'::regclass,
                  'public.seed_accounts'::regclass, 'public.api_keys'::regclass)
  AND attnum > 0 AND NOT attisdropped;
SELECT * FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('profiles', 'submissions', 'seed_accounts', 'api_keys');
SELECT member::regrole AS member, roleid::regrole AS inherited_role
FROM pg_auth_members
WHERE member IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole);
SELECT rolname, rolsuper, rolinherit, rolbypassrls
FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role');
SELECT tgrelid::regclass AS relation, tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid IN ('public.profiles'::regclass, 'public.submissions'::regclass)
  AND NOT tgisinternal;
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'submissions';
SELECT
  count(*) FILTER (WHERE url IS NULL OR char_length(url) > 2048
    OR url !~* '^https://((www|mobile)[.])?(x[.]com|twitter[.]com)/'
    OR url ~ '[[:space:][:cntrl:]]'
    OR url ~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
    OR strpos(url, chr(92)) > 0) AS legacy_invalid_url_count,
  count(*) FILTER (WHERE char_length(notes) > 2000) AS legacy_oversized_notes_count
FROM public.submissions;
SELECT count(*) AS legacy_invalid_username_count
FROM public.profiles
WHERE username IS NOT NULL AND (char_length(username) NOT BETWEEN 2 AND 39 OR username ~ '[^A-Za-z0-9_-]');
