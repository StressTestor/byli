/**
 * POST /api/admin/submissions/:id/approve
 *
 * Approves a community submission by running it through the same
 * single-article ingest path as POST /api/ingest, then links the resulting
 * article to the submission. Admin only (checked via is_admin() as the caller).
 */

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

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { data: isAdmin, error: adminErr } = await supabase.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { data: submission, error: subErr } = await supabaseAdmin
    .from('submissions')
    .select('id, url, status, category_id')
    .eq('id', id)
    .maybeSingle();
  if (subErr) {
    console.error('[approve] submission lookup failed:', subErr);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
  }
  if (submission.status !== 'pending') {
    return NextResponse.json({ error: `Submission is already ${submission.status}` }, { status: 409 });
  }

  const tweetId = extractTweetId(submission.url);
  if (!tweetId) {
    return NextResponse.json(
      { error: 'URL is not an x.com/<user>/status/<id> link' },
      { status: 422 },
    );
  }

  const outcome = await ingestSingleArticle(tweetId);
  // "already exists" still carries the existing article's id; link it.
  const articleId = outcome.articleId;
  if (!articleId) {
    const status = outcome.blocked ? 422 : 502;
    return NextResponse.json({ error: outcome.error || 'Ingest failed' }, { status });
  }

  if (submission.category_id) {
    const { error: catErr } = await supabaseAdmin
      .from('article_categories')
      .upsert(
        { article_id: articleId, category_id: submission.category_id },
        { onConflict: 'article_id,category_id', ignoreDuplicates: true },
      );
    if (catErr) console.error('[approve] category link failed:', catErr);
  }

  // Conditional on still being pending, so a concurrent approve/reject wins
  // cleanly instead of both writing.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('submissions')
    .update({
      status: 'approved',
      article_id: articleId,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (updErr) {
    console.error('[approve] submission update failed:', updErr);
    return NextResponse.json({ error: 'Article ingested but submission update failed' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Submission was reviewed by someone else' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, articleId, created: outcome.ok });
}
