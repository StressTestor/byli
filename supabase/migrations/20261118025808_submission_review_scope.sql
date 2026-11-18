-- Add an opt-in least-privilege tier. Existing credentials and default unchanged.
-- Transactional constraint replacement does not update or revoke any keys.
ALTER TABLE public.agent_credentials DROP CONSTRAINT agent_credentials_scope_check;
ALTER TABLE public.agent_credentials ADD CONSTRAINT agent_credentials_scope_check
  CHECK (scope IN ('admin', 'submission_review'));
