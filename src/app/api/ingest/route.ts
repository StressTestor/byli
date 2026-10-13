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
 */

import { NextResponse, NextRequest } from 'next/server';
import { safeEqual } from '@/lib/timing-safe-equal';
import { ingestArticles, ingestSingleArticle, sleep } from '@/lib/ingest';

// ─── API Route Handlers ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends this header). Constant-time compare.
  const authHeader = req.headers.get('authorization');
  if (!safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await ingestArticles();

  return NextResponse.json(result);
}

// POST /api/ingest — manually submit article(s) by tweet ID
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
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
