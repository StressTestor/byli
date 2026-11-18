/**
 * POST /api/admin/submissions/:id/approve
 *
 * Approves a community submission by running it through the same
 * single-article ingest path as POST /api/ingest, then links the resulting
 * article to the submission. Admin only (checked via is_admin() as the caller).
 */

import { randomUUID } from 'node:crypto';
import type { Json } from '@/types/database';
import { authenticateAgent, AgentAuthError } from '@/lib/agent-auth';
import { NextResponse, NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ingestSingleArticle } from '@/lib/ingest';
import { extractTweetId } from '@/lib/tweet-id';

export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let user: { id: string };
  let credentialId: string | null = null;
  if (_req.headers.has('authorization')) {
    try {
      const principal = await authenticateAgent(_req.headers.get('authorization'), 'approve_submission');
      user = { id: principal.userId };
      credentialId = principal.credentialId;
    }
    catch (error) {
      if (!(error instanceof AgentAuthError)) throw error;
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
  } else {
  const supabase = await createSupabaseServer();
  const { data: { user: browserUser } } = await supabase.auth.getUser();
  if (!browserUser) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { data: isAdmin, error: adminErr } = await supabase.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

    user = browserUser;
  }

  // Separate authorization from operation attribution. This log is not atomic
  // with ingestion or submission writes: an attempt without an outcome means
  // inspect the submission/article state before retrying, not 'nothing happened'.
  const attemptId = randomUUID();
  let stage = 'lookup';
  async function audit(outcome: string, details: Record<string, Json> = {}) {
    if (!credentialId) return true;
    try {
      const { error } = await supabaseAdmin.from('admin_logs').insert({
        admin_id: user.id, action: `agent_approval_${outcome}`,
        target_type: 'submission', target_id: id,
        metadata: { credential_id: credentialId, attempt_id: attemptId,
          operation: 'approve_submission', stage, ...details },
      });
      return !error;
    } catch { return false; }
  }
  async function finish(body: Record<string, Json>, status: number, outcome: string, details: Record<string, Json> = {}) {
    const auditRecorded = await audit(outcome, { http_status: status, ...details });
    return NextResponse.json({ ...body, ...(credentialId ? { auditRecorded } : {}) }, { status });
  }
  if (!await audit('attempt')) {
    return NextResponse.json({ error: 'Audit unavailable; approval not started' }, { status: 503 });
  }

  try {
  const { data: submission, error: subErr } = await supabaseAdmin
    .from('submissions')
    .select('id, url, status, category_id')
    .eq('id', id)
    .maybeSingle();
  if (subErr) {
    console.error('[approve] submission lookup failed:', subErr);
    return finish({ error: 'Lookup failed' }, 500, 'failed');
  }
  if (!submission) {
    return finish({ error: 'Submission not found' }, 404, 'no_match');
  }
  if (submission.status !== 'pending') {
    return finish({ error: `Submission is already ${submission.status}` }, 409, 'no_match');
  }

  const tweetId = extractTweetId(submission.url);
  if (!tweetId) {
    return finish({ error: 'URL is not an x.com/<user>/status/<id> link' }, 422, 'rejected');
  }

  // Claim the submission before ingesting anything, so a concurrent approve
  // or reject can't interleave with a published article.
  stage = 'claim';
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('submissions')
    .update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) {
    console.error('[approve] claim failed:', claimErr);
    return finish({ error: 'Claim failed' }, 500, 'unknown');
  }
  if (!claimed || claimed.length === 0) {
    return finish({ error: 'Submission was reviewed by someone else' }, 409, 'no_match');
  }

  stage = 'ingest';
  const outcome = await ingestSingleArticle(tweetId);
  // "already exists" still carries the existing article's id; link it.
  const articleId = outcome.articleId;
  if (!articleId) {
    // Release the claim so the submission goes back to the queue.
    stage = 'release';
    const { error: releaseErr } = await supabaseAdmin
      .from('submissions')
      .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
      .eq('id', id)
      .eq('status', 'approved')
      .is('article_id', null);
    if (releaseErr) console.error('[approve] releasing claim failed:', releaseErr);
    const status = outcome.blocked ? 422 : 502;
    return finish({ error: outcome.error || 'Ingest failed' }, status, releaseErr ? 'partial' : 'failed', { release_request_succeeded: !releaseErr });
  }

  let categoryLinkFailed = false;
  stage = 'category';
  if (submission.category_id) {
    const { error: catErr } = await supabaseAdmin
      .from('article_categories')
      .upsert(
        { article_id: articleId, category_id: submission.category_id },
        { onConflict: 'article_id,category_id', ignoreDuplicates: true },
      );
    categoryLinkFailed = Boolean(catErr);
    if (catErr) console.error('[approve] category link failed:', catErr);
  }

  stage = 'link';
  const { error: linkErr } = await supabaseAdmin
    .from('submissions')
    .update({ article_id: articleId })
    .eq('id', id);
  if (linkErr) {
    console.error('[approve] linking article failed:', linkErr);
    return finish({ error: 'Article ingested but submission update failed' }, 500, 'partial', { article_id: articleId });
  }

  stage = 'complete';
  return finish({ ok: true, articleId, created: outcome.ok }, 200, categoryLinkFailed ? 'partial' : 'succeeded', { article_id: articleId, category_link_failed: categoryLinkFailed });
  } catch (error) {
    if (!credentialId) throw error; // Preserve existing browser exception behavior.
    return finish({ error: 'Approval interrupted; inspect submission and article state before retrying' }, 500, 'unknown');
  }
}
