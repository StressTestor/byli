import { isCredentialOwner } from '@/lib/credential-owner';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';
import { agentDb, hashAgentSecret, newAgentSecret } from '@/lib/agent-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

const headers = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' };
const publicFields = 'id,owner_id,label,scope,created_at,expires_at,revoked_at';
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
async function owner(req: NextRequest, mutation = false) {
  // Credential lifecycle is intentionally browser-owner-only, never bearer auth.
  if (req.headers.has('authorization')) return null;
  if (mutation && req.headers.get('origin') !== req.nextUrl.origin) return null;
  const db = await createSupabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user || !isCredentialOwner(user)) return null;
  const { data, error } = await db.rpc('is_admin');
  return !error && data === true ? user.id : null;
}
export async function GET(req: NextRequest) {
  const userId = await owner(req);
  if (!userId) return NextResponse.json({ error: 'Admin login required' }, { status: 403, headers });
  const rawOffset = req.nextUrl.searchParams.get('offset') ?? '0';
  const offset = Number(rawOffset);
  if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset > 100000)
    return NextResponse.json({ error: 'Invalid offset' }, { status: 400, headers });
  const { data, error } = await agentDb.from('agent_credentials').select(publicFields)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 99);
  return NextResponse.json(error ? { error: 'Lookup failed' } : { credentials: data, offset, nextOffset: data?.length === 100 && offset <= 99900 ? offset + 100 : null }, { status: error ? 503 : 200, headers });
}
export async function POST(req: NextRequest) {
  const userId = await owner(req, true);
  if (!userId) return NextResponse.json({ error: 'Same-origin admin login required' }, { status: 403, headers });
  const body = await readBody(req);
  const ttl = body?.expiresInDays;
  if (typeof body?.label !== 'string' || body.label.trim().length < 1 || body.label.length > 80 || !Number.isInteger(ttl) || ttl < 1 || ttl > 90)
    return NextResponse.json({ error: 'label (1–80 characters) and expiresInDays (1–90) required' }, { status: 400, headers });
  // Preserve legacy clients that omit scope, but never coerce invalid values
  // into broader authority. The owner chooses any explicit restricted scope.
  const scope = body.scope === undefined ? 'admin' : body.scope;
  if (scope !== 'admin' && scope !== 'submission_review')
    return NextResponse.json({ error: 'scope must be admin or submission_review' }, { status: 400, headers });
  const principalId = body.adminUserId ?? userId;
  if (typeof principalId !== 'string' || !/^[0-9a-f-]{36}$/i.test(principalId))
    return NextResponse.json({ error: 'Invalid adminUserId' }, { status: 400, headers });
  const { data: principal, error: principalError } = await supabaseAdmin.from('profiles').select('role').eq('id', principalId).maybeSingle();
  if (principalError || principal?.role !== 'admin')
    return NextResponse.json({ error: 'Target must be a current admin' }, { status: 400, headers });
  const id = randomUUID();
  const token = newAgentSecret();
  const expiresAt = new Date(Date.now() + ttl * 86400000).toISOString();
  // Pre-log issuance intent; a failed insert leaves no usable secret.
  const { error: auditError } = await supabaseAdmin.from('admin_logs').insert({ admin_id: userId, action: 'agent_credential_issue_requested', target_type: 'agent_credential', target_id: id, metadata: { expires_at: expiresAt, principal_id: principalId, scope } });
  if (auditError) return NextResponse.json({ error: 'Audit service unavailable' }, { status: 503, headers });
  const { error } = await agentDb.from('agent_credentials').insert({ id, owner_id: principalId, label: body.label.trim(), scope, secret_hash: hashAgentSecret(token), expires_at: expiresAt });
  return NextResponse.json(error ? { error: 'Issue failed' } : { id, token, scope, expiresAt }, { status: error ? 503 : 201, headers });
}
export async function DELETE(req: NextRequest) {
  const userId = await owner(req, true);
  if (!userId) return NextResponse.json({ error: 'Same-origin admin login required' }, { status: 403, headers });
  const body = await readBody(req);
  if (typeof body?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: 'Credential id required' }, { status: 400, headers });
  // Revoke even if logging fails: revocation must remain available in outages.
  const { data, error } = await agentDb.from('agent_credentials').update({ revoked_at: new Date().toISOString() }).eq('id', body.id).select('id');
  if (error) return NextResponse.json({ error: 'Revoke failed' }, { status: 503, headers });
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  const { error: auditError } = await supabaseAdmin.from('admin_logs').insert({ admin_id: userId, action: 'agent_credential_revoked', target_type: 'agent_credential', target_id: body.id });
  return NextResponse.json({ revoked: true, auditRecorded: !auditError }, { headers });
}
