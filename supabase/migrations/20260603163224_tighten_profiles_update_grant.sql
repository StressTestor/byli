
-- Drop created_at from the client UPDATE grant (no backdating profiles).
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (id, username, avatar_url, x_handle, x_user_id, updated_at)
  ON public.profiles TO authenticated;
