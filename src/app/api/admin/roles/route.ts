import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';
import { CREDENTIAL_OWNER_USER_ID, isCredentialOwner } from '@/lib/credential-owner';

const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function readBody(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
  finally { reader.releaseLock(); }
}
export async function POST(req: NextRequest) {
  if (req.headers.has('authorization') || req.headers.get('origin') !== req.nextUrl.origin) {
    return response({ error: 'Owner browser session required' }, 403);
  }
  const db = await createSupabaseServer();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !isCredentialOwner(user)) return response({ error: 'Owner browser session required' }, 403);
  const body = await readBody(req);
  if (!body || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id) || !['user', 'moderator', 'admin'].includes(body.role)) {
    return response({ error: 'Valid profile ID and role required' }, 400);
  }
  if (body.id.toLowerCase() === CREDENTIAL_OWNER_USER_ID && body.role !== 'admin') return response({ error: 'Owner self-demotion is not allowed' }, 403);
  // Use the verified owner's session, NEVER the service-role client: the
  // database guard must see the owner's auth.uid() on the actual update.
  const { data, error } = await db.from('profiles').update({ role: body.role }).eq('id', body.id).select('id,role');
  if (error) return response({ error: 'Role update failed' }, 500);
  if (!data?.length) return response({ error: 'Profile not found' }, 404);
  return response({ ok: true, data });
}
