import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';
import { NextResponse, NextRequest } from 'next/server';

// GET /api/seed-accounts — list approved seed accounts (public)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('seed_accounts')
    .select('handle, high_yield, articles_found, created_at')
    .eq('status', 'approved')
    .order('articles_found', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: data });
}

// POST /api/seed-accounts — submit a handle for inclusion
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  const body = await req.json();
  const handle = (body.handle || '').trim().replace(/^@/, '');

  if (!handle || handle.length > 50 || !/^[a-zA-Z0-9_]+$/.test(handle)) {
    return NextResponse.json(
      { error: 'Invalid handle. Use your X username without the @.' },
      { status: 400 }
    );
  }

  // Check if already submitted
  const { data: existing } = await supabaseAdmin
    .from('seed_accounts')
    .select('id, status')
    .eq('handle', handle)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      error: `@${handle} has already been ${existing.status === 'approved' ? 'added' : 'submitted'}.`,
    }, { status: 409 });
  }

  const { error: insertError } = await supabaseAdmin
    .from('seed_accounts')
    .insert({
      handle,
      submitted_by: user.id,
      status: 'pending',
    });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, handle, status: 'pending' });
}
