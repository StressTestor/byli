/**
 * Linkdrift Ingestion Worker
 *
 * GET  /api/ingest  cron: scan seed timelines + global article search
 * POST /api/ingest  manual: ingest specific tweet ids
 *
 * Cron config in vercel.json:
 * { "crons": [{ "path": "/api/ingest", "schedule": "0 0 * * *" }] }
 *
 * The ingestion logic lives in src/lib/ingest.ts so the admin submission
 * approve route can reuse it.
 *
 * GET answers non-2xx when the run fails so the Vercel cron is marked failed:
 * 502 { error, status } for a twitterapi.io auth/quota error, 500 { error }
 * for anything else (e.g. seed_accounts unreadable). Each run is recorded in
 * the ingest_runs table.
 */

import { NextResponse, NextRequest } from 'next/server';
import { safeEqual } from '@/lib/timing-safe-equal';
import { runIngestion, ingestSingleArticle, sleep } from '@/lib/ingest';

// Vercel Hobby max. src/lib/ingest.ts budgets its phases to finish inside it.
export const maxDuration = 60;

// ─── API Route Handlers ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends this header). Constant-time compare.
  const authHeader = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim() || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const outcome = await runIngestion();
  if (outcome.ok) return NextResponse.json(outcome.result);

  if (outcome.upstreamStatus !== undefined) {
    return NextResponse.json(
      { error: outcome.error, status: outcome.upstreamStatus, stats: outcome.result },
      { status: 502 },
    );
  }
  return NextResponse.json({ error: outcome.error, stats: outcome.result }, { status: 500 });
}

// POST /api/ingest — manually submit article(s) by tweet ID
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim() || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const tweetIds: string[] = Array.isArray(body.tweet_ids)
    ? body.tweet_ids
    : body.tweet_id
      ? [body.tweet_id]
      : [];

  if (tweetIds.length === 0) {
    return NextResponse.json({ error: 'provide tweet_id or tweet_ids[]' }, { status: 400 });
  }

  const results = [];
  for (const tid of tweetIds) {
    const result = await ingestSingleArticle(tid);
    results.push({ tweet_id: tid, ...result });
    await sleep(300);
  }

  return NextResponse.json({ ingested: results });
}
