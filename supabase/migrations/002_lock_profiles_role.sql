-- 002_lock_profiles_role.sql
-- Fixes a privilege-escalation hole: the `authenticated` role held column-level
-- UPDATE on profiles.role, and the profiles UPDATE RLS policy only checks row
-- ownership (auth.uid() = id), not the value being set. So any signed-up user
-- could PATCH their own profile with {"role":"admin"} via the public anon key
-- and gain full admin write access (is_admin() gates on profiles.role='admin').
--
-- Two layers:
--   1. Remove `role` from the columns the client roles may UPDATE. A plain
--      `REVOKE UPDATE (role)` is a no-op while a TABLE-level UPDATE grant exists
--      (the table grant implies all columns), so we revoke the table-level UPDATE
--      and re-grant UPDATE on every column EXCEPT role. Legitimate profile self-edits
--      (username, avatar, x identity) still work; the only role writes in the app are
--      the service-role GitHub auto-promote in auth/callback, which is unaffected.
--      (The admin "change user role" UI was already non-functional because the profiles
--      UPDATE policy restricts to auth.uid()=id; it needs a separate service-role route.)
--   2. A BEFORE UPDATE guard trigger that rejects any role change unless the caller is
--      the trusted backend (service_role) or an existing admin — defense in depth in
--      case the column grant is ever re-added by a future `GRANT ALL`.
--
-- `created_at` is intentionally NOT granted (users must not backdate their profile).
-- `id` stays granted: the RLS WITH CHECK (auth.uid()=id) already prevents reassigning
-- it, and the signup upsert's ON CONFLICT path can reference it.

REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (id, username, avatar_url, x_handle, x_user_id, updated_at)
  ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_profile_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF coalesce(auth.role(), '') <> 'service_role'
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid() AND p.role = 'admin'
       ) THEN
      RAISE EXCEPTION 'profiles.role may only be changed by an administrator';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_prevent_role_change ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_role_change();
