-- submissions.url had no uniqueness of any kind, so the same post could sit in
-- the review queue several times over. Survivable while submissions were
-- hand-typed; not once an automated submitter is pointed at the queue.
--
-- Scoped to pending rows only: a rejected URL should stay re-submittable later
-- (the post may earn traction), and approved rows are already deduped by
-- articles.x_url / articles.x_article_id.

CREATE UNIQUE INDEX IF NOT EXISTS submissions_url_pending_uniq
  ON public.submissions (url)
  WHERE status = 'pending';