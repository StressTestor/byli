-- First-class website-admin credentials. Never grant their secret hashes to
-- browser roles; all lifecycle operations run through owner-checked server code.
CREATE TABLE public.agent_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  scope text NOT NULL DEFAULT 'admin' CHECK (scope = 'admin'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days'),
  revoked_at timestamptz
);
ALTER TABLE public.agent_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_credentials TO service_role;
CREATE INDEX agent_credentials_owner_idx ON public.agent_credentials(owner_id);
COMMENT ON TABLE public.agent_credentials IS 'Server-only admin agent credentials: SHA-256 of random 256-bit secrets. Owner controls lifecycle; expiration and live admin role checked on every request.';
