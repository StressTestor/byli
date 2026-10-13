-- One row per /api/ingest cron run.
--
-- The run inserts a 'running' row at start and updates it to 'ok' or 'failed'
-- with stats and the error text at the end. A row left in 'running' means the
-- function was killed (timeout) before it could finish.
--
-- Written by the service role only; admins can read it.

CREATE TABLE public.ingest_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  stats       jsonb NOT NULL DEFAULT '{}',
  error       text
);

CREATE INDEX ingest_runs_started_at_idx ON public.ingest_runs (started_at DESC);

ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policies: only the service role (which bypasses RLS) writes.
CREATE POLICY "admins can read ingest_runs"
  ON public.ingest_runs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
