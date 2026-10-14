-- EMERGENCY ROLLBACK ONLY. This restores the repository's previous broad
-- client-write surface, including the audited vulnerabilities. Do not run on
-- any live database without fresh action-time security approval and a captured
-- pre-change ACL/policy snapshot. Prefer fixing forward or an app-only rollback.
-- This file is deliberately outside supabase/migrations/.
BEGIN;

DROP TRIGGER IF EXISTS profiles_validate_username ON public.profiles;
DROP FUNCTION IF EXISTS public.validate_profile_username();

DROP TRIGGER IF EXISTS submissions_validate_content ON public.submissions;
DROP FUNCTION IF EXISTS public.validate_submission_content();

DROP POLICY IF EXISTS "Admins can read all seed accounts" ON public.seed_accounts;
CREATE POLICY "authenticated users can submit handles"
  ON public.seed_accounts FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid());
CREATE POLICY "admins full access"
  ON public.seed_accounts FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));

CREATE POLICY "Users can create their own API keys"
  ON public.api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own API keys"
  ON public.api_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own API keys"
  ON public.api_keys FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create submissions" ON public.submissions;
CREATE POLICY "Users can create submissions"
  ON public.submissions FOR INSERT WITH CHECK (auth.uid() = submitted_by);
DROP POLICY IF EXISTS "Admins can read all submissions" ON public.submissions;
DROP POLICY IF EXISTS "Admins can update all submissions" ON public.submissions;
DROP POLICY IF EXISTS "Admins can delete all submissions" ON public.submissions;
CREATE POLICY "Admins can manage all submissions"
  ON public.submissions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Supabase's baseline table grants, as reproduced by the synthetic test.
-- If the approved preflight snapshot differs, restore that snapshot instead.
REVOKE INSERT ON public.submissions FROM authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.seed_accounts, public.api_keys TO anon, authenticated;
GRANT INSERT, TRUNCATE, REFERENCES, TRIGGER
  ON public.submissions TO anon, authenticated;

COMMIT;
