-- Run AFTER original migrations and BEFORE the candidate security migration.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
INSERT INTO auth.users (id, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000001', '{"username":"alice"}'),
  ('00000000-0000-0000-0000-000000000002', '{"username":"bob"}'),
  ('00000000-0000-0000-0000-000000000003', '{"username":"admin"}'),
  ('00000000-0000-0000-0000-000000000004', '{"username":"legacy"}');
UPDATE public.profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET username = 'old invalid name' WHERE id = '00000000-0000-0000-0000-000000000004';
INSERT INTO public.submissions (id, submitted_by, url, notes) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'javascript:alert(1)', repeat('x', 2001));
INSERT INTO public.seed_accounts (handle, submitted_by) VALUES
  ('pending_test', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.api_keys (user_id, key_hash, label) VALUES
  ('00000000-0000-0000-0000-000000000001', 'synthetic-alice-hash', 'Synthetic only'),
  ('00000000-0000-0000-0000-000000000002', 'synthetic-bob-hash', 'Synthetic only');
-- Prove table REVOKE also strips any explicit column grants.
GRANT INSERT (status), UPDATE (status) ON public.seed_accounts TO authenticated;
GRANT INSERT (tier), UPDATE (tier) ON public.api_keys TO authenticated;
GRANT INSERT (status, article_id, reviewed_by, reviewed_at) ON public.submissions TO authenticated;
GRANT INSERT (status) ON public.seed_accounts TO PUBLIC;
GRANT UPDATE (tier) ON public.api_keys TO PUBLIC;
GRANT INSERT (reviewed_at) ON public.submissions TO PUBLIC;
SELECT set_config('request.jwt.claim.role', '', false);
