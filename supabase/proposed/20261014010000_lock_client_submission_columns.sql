-- Prepared security change: applying this to a shared/live database requires
-- separate approval. Deploy the compatible submission form first.
--
BEGIN;

-- Seed and API-key writes already use trusted server routes/resolvers. Keep
-- client reads governed by RLS, but remove every client mutation privilege.
-- Table-level REVOKE also removes corresponding column-level grants.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.seed_accounts, public.api_keys FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "authenticated users can submit handles" ON public.seed_accounts;
DROP POLICY IF EXISTS "admins full access" ON public.seed_accounts;
CREATE POLICY "Admins can read all seed accounts"
  ON public.seed_accounts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));

DROP POLICY IF EXISTS "Users can create their own API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can update their own API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can delete their own API keys" ON public.api_keys;

-- An authenticated submitter chooses content only, never moderation results,
-- ownership of someone else's row, identifiers, or timestamps. UPDATE/DELETE
-- remain available to the existing browser admin moderation flow under RLS.
REVOKE INSERT, TRUNCATE, REFERENCES, TRIGGER
  ON public.submissions FROM PUBLIC, anon, authenticated;
GRANT INSERT (submitted_by, url, category_id, notes)
  ON public.submissions TO authenticated;
ALTER TABLE public.submissions ALTER COLUMN status SET DEFAULT 'pending';

DROP POLICY IF EXISTS "Users can create submissions" ON public.submissions;
DROP POLICY IF EXISTS "Users can submit articles" ON public.submissions;
CREATE POLICY "Users can create submissions"
  ON public.submissions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = submitted_by
    AND status = 'pending'
    AND article_id IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

-- A permissive FOR ALL policy is ORed with INSERT policies. Replace it with
-- explicit admin operations so admins' client INSERTs follow the same limits.
DROP POLICY IF EXISTS "Admins can manage all submissions" ON public.submissions;
CREATE POLICY "Admins can read all submissions"
  ON public.submissions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));
CREATE POLICY "Admins can update all submissions"
  ON public.submissions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));
CREATE POLICY "Admins can delete all submissions"
  ON public.submissions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- CHECK ... NOT VALID still validates every UPDATE. That would prevent an
-- admin rejecting a legacy row with a malformed URL or oversized notes. An
-- invoker trigger validates INSERTs and each changed content field instead;
-- unchanged historical values can still be reviewed without being rewritten.
-- This is enforced for service-role writes too (BYPASSRLS bypasses only RLS).
CREATE FUNCTION public.validate_submission_content()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.url IS DISTINCT FROM OLD.url THEN
    IF NEW.url IS NULL
       OR char_length(NEW.url) > 2048
       OR NEW.url !~* '^https://((www|mobile)[.])?(x[.]com|twitter[.]com)/'
       OR NEW.url ~ '[[:space:][:cntrl:]]'
       OR NEW.url ~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
       OR strpos(NEW.url, chr(92)) > 0 THEN
      RAISE EXCEPTION 'URL must be a valid HTTPS X/Twitter link (maximum 2048 characters)'
        USING ERRCODE = '23514', CONSTRAINT = 'submissions_url_valid';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    IF char_length(NEW.notes) > 2000 THEN
      RAISE EXCEPTION 'Notes must be at most 2000 characters'
        USING ERRCODE = '23514', CONSTRAINT = 'submissions_notes_length';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_submission_content()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER submissions_validate_content
  BEFORE INSERT OR UPDATE OF url, notes ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.validate_submission_content();

-- The browser can update profiles directly, so mirror USERNAME_RE from the
-- signup/callback/updateProfile paths at the database boundary as well. Null
-- usernames are intentional while signup/OAuth assigns a fallback. Unchanged
-- historical usernames never block an unrelated avatar or role update.
CREATE FUNCTION public.validate_profile_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.username IS DISTINCT FROM OLD.username THEN
    IF NEW.username IS NOT NULL
       AND (char_length(NEW.username) NOT BETWEEN 2 AND 39
            OR NEW.username ~ '[^A-Za-z0-9_-]') THEN
      RAISE EXCEPTION 'Username must be 2-39 letters, numbers, underscores, or hyphens'
        USING ERRCODE = '23514', CONSTRAINT = 'profiles_username_valid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_profile_username()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_validate_username
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_username();

COMMIT;
