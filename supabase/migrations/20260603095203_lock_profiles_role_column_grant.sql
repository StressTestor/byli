
-- Column-level revoke is a no-op while a TABLE-level UPDATE grant exists, so revoke
-- the table grant and re-grant UPDATE on every column EXCEPT role.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (id, username, avatar_url, x_handle, x_user_id, created_at, updated_at)
  ON public.profiles TO authenticated;
