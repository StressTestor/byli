/**
 * Trending Topics Cron Route
 *
 * Fetches worldwide trending topics from twitterapi.io hourly.
 * Stores results in trending_topics table for the sidebar.
 *
 * Cron config in vercel.json:
 * { "path": "/api/trends", "schedule": "0 * * * *" }
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { NextResponse, NextRequest } from 'next/server';

const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY!;
const TWITTERAPI_BASE = 'https://api.twitterapi.io/twitter';

interface TrendItem {
  name: string;
  query: string;
  tweet_count: number | null;
  domain?: string;
}

interface TrendsResponse {
  status: string;
  trends?: TrendItem[];
}

function formatPostCount(count: number | null): string | null {
  if (!count || count === 0) return null;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M posts`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K posts`;
  return `${count} posts`;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch(`${TWITTERAPI_BASE}/trends?woeid=1&count=30`, {
      headers: { 'X-API-Key': TWITTERAPI_KEY },
    });

    if (!res.ok) {
      console.error('Trends API error:', res.status, await res.text());
      return NextResponse.json(
        { error: 'Failed to fetch trends from API' },
        { status: 502 }
      );
    }

    const json: TrendsResponse = await res.json();
    const trends = json.trends;

    if (!trends || !Array.isArray(trends) || trends.length === 0) {
      console.error('No trends in API response:', json);
      return NextResponse.json(
        { error: 'No trends returned from API' },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    const rows = trends.map((t, i) => ({
      name: t.name,
      query: t.query || t.name,
      rank: i + 1,
      post_count: formatPostCount(t.tweet_count),
      fetched_at: now,
    }));

    // Delete old trends and insert fresh batch in a transaction-like sequence.
    // Only delete AFTER we have new data to avoid empty state on failure.
    const { error: deleteError } = await supabaseAdmin
      .from('trending_topics')
      .delete()
      .gte('id', 0); // delete all rows

    if (deleteError) {
      console.error('Failed to clear old trends:', deleteError);
      return NextResponse.json(
        { error: 'Failed to clear old trends' },
        { status: 500 }
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from('trending_topics')
      .insert(rows);

    if (insertError) {
      console.error('Failed to insert trends:', insertError);
      return NextResponse.json(
        { error: 'Failed to insert trends' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      count: rows.length,
      fetched_at: now,
    });
  } catch (err) {
    console.error('Trends cron error:', err);
    return NextResponse.json(
      { error: 'Internal error fetching trends' },
      { status: 500 }
    );
  }
}
