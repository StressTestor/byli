import { isBlockedAirdropContent } from '@/lib/airdrop-policy';
import { CREDENTIAL_OWNER_USER_ID } from '@/lib/credential-owner';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent, AgentAuthError } from '@/lib/agent-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

const reads = {
  'list.submissions': 'submissions', 'list.articles': 'articles',
  'list.profiles': 'profiles', 'list.settings': 'site_settings',
  'list.health': 'health_checks', 'list.logs': 'admin_logs',
  'list.seeds': 'seed_accounts', 'list.categories': 'categories',
  'list.authors': 'authors',
} as const;
const writes = ['article.feature', 'article.status', 'article.delete', 'submission.reject',
  'setting.update', 'health.run', 'profile.role', 'seed.create', 'seed.update', 'seed.delete'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class InputError extends Error {}
class AuditError extends Error {}
function check(value: unknown): asserts value { if (!value) throw new InputError(); }
function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
// Stream-limited before JSON parsing; Content-Length is not trusted.
async function body(req: NextRequest): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  check(reader);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new InputError(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  check(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const input = await body(req);
    const op = input.operation;
    check(typeof op === 'string' && (Object.hasOwn(reads, op) || writes.includes(op as typeof writes[number])));
    const actor = await authenticateAgent(req.headers.get('authorization'), op);
    if (Object.hasOwn(reads, op)) {
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;
      check(Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 100);
      check(Number.isInteger(offset) && Number(offset) >= 0 && Number(offset) <= 100000);
      const table = reads[op as keyof typeof reads];
      const result = await supabaseAdmin.from(table).select('*')
        .order(table === 'site_settings' ? 'key' : 'id', { ascending: true })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      if (result.error) return reply({ error: 'Read failed' }, 500);
      return reply({ data: result.data, offset, limit });
    }
    if (op !== 'seed.create' && op !== 'setting.update' && op !== 'health.run') check(typeof input.id === 'string' && uuid.test(input.id));
    const id = op === 'seed.create' || op === 'setting.update' || op === 'health.run' ? '' : input.id as string;
    // Authorization is not a completed operation. Correlate a durable attempt
    // with its outcome; a failed result log must not invite a duplicate mutation.
    const attemptId = randomUUID();
    const operation = op;
    async function audit(phase: 'attempt' | 'succeeded' | 'failed' | 'no_match' | 'unknown') {
      const { error } = await supabaseAdmin.from('admin_logs').insert({
        admin_id: actor.userId, action: `agent_operation_${phase}`,
        target_type: operation.split('.')[0],
        target_id: id || null,
        metadata: { credential_id: actor.credentialId, attempt_id: attemptId, operation,
          ...(op === 'setting.update' ? { setting_key: input.key as string } : {}),
          ...(op === 'profile.role' ? { requested_role: input.role as string } : {}),
          ...(op === 'seed.create' ? { seed_handle: input.handle as string } : {}),
        },
      });
      return !error;
    }
    async function mutate<T extends { data: unknown[] | null; error: unknown }>(run: () => PromiseLike<T>) {
      if (!await audit('attempt')) throw new AuditError();
      let outcome: T;
      try { outcome = await run(); }
      catch (error) { await audit('unknown').catch(() => false); throw error; }
      const auditRecorded = await audit(outcome.error ? 'failed' : outcome.data?.length ? 'succeeded' : 'no_match').catch(() => false);
      return { ...outcome, auditRecorded };
    }
    let result;
    switch (op) {
      case 'article.feature':
        check(typeof input.featured === 'boolean');
        result = await mutate(() => supabaseAdmin.from('articles').update({ featured: input.featured as boolean }).eq('id', id).select('id')); break;
      case 'article.status':
        check(['pending', 'published', 'archived', 'rejected'].includes(String(input.status)));
        if (input.status === 'published') {
          const prospective = await supabaseAdmin.from('articles').select('title,excerpt,body_preview').eq('id', id).maybeSingle();
          if (prospective.error) return reply({ error: 'Article lookup failed' }, 500);
          if (!prospective.data) return reply({ error: 'Target missing or state changed' }, 409);
          if (isBlockedAirdropContent(prospective.data)) return reply({ error: 'Crypto-airdrop promotion is not allowed' }, 422);
          // The database publication trigger remains the authoritative boundary
          // against concurrent content edits and direct browser writes.
        }
        result = await mutate(() => supabaseAdmin.from('articles').update({ status: input.status as 'pending' | 'published' | 'archived' | 'rejected' }).eq('id', id).select('id')); break;
      case 'article.delete':
        result = await mutate(() => supabaseAdmin.from('articles').delete().eq('id', id).select('id')); break;
      case 'submission.reject':
        result = await mutate(() => supabaseAdmin.from('submissions').update({ status: 'rejected', reviewed_by: actor.userId, reviewed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select('id')); break;
      case 'setting.update':
        if (input.key === 'featured_limit') {
          check(typeof input.value === 'number' && Number.isInteger(input.value) && input.value >= 0 && input.value <= 100);
        } else {
          check(['ingestion_enabled', 'submissions_enabled', 'signup_enabled', 'maintenance_mode'].includes(String(input.key)));
          check(typeof input.value === 'boolean');
        }
        result = await mutate(() => supabaseAdmin.from('site_settings').update({ value: input.key === 'featured_limit' ? input.value as number : String(input.value), updated_by: actor.userId, updated_at: new Date().toISOString() }).eq('key', input.key as string).select('key')); break;
      case 'health.run':
        result = await mutate(async () => {
          const { data, error } = await supabaseAdmin.rpc('run_db_health_check');
          return { data: data === null ? null : [data], error };
        }); break;
      case 'profile.role':
        check(['user', 'moderator', 'admin'].includes(String(input.role)));
        if (id.toLowerCase() === CREDENTIAL_OWNER_USER_ID) {
          return reply({ error: 'Owner role cannot be changed using agent credentials' }, 403);
        }
        if (input.role === 'admin') return reply({ error: 'Admin role changes require the owner browser session' }, 403);
        // The database trigger is the authoritative concurrency boundary. This
        // check gives a clear API error; the conditional update also avoids
        // overwriting a concurrent role change.
        const current = await supabaseAdmin.from('profiles').select('role').eq('id', id).maybeSingle();
        if (current.error) return reply({ error: 'Role lookup failed' }, 500);
        if (!current.data) return reply({ error: 'Target missing or state changed' }, 409);
        if (current.data.role === 'admin') return reply({ error: 'Admin role changes require the owner browser session' }, 403);
        const currentRole = current.data.role;
        result = await mutate(() => supabaseAdmin.from('profiles').update({ role: input.role as string, updated_at: new Date().toISOString() }).eq('id', id).eq('role', currentRole).select('id')); break;
      case 'seed.create':
        check(typeof input.handle === 'string' && /^[a-zA-Z0-9_]{1,50}$/.test(input.handle));
        check(['pending', 'approved', 'rejected'].includes(String(input.status)));
        check(input.high_yield === undefined || typeof input.high_yield === 'boolean');
        result = await mutate(() => supabaseAdmin.from('seed_accounts').insert({ handle: input.handle as string, status: input.status as string, high_yield: input.high_yield as boolean | undefined, submitted_by: actor.userId }).select('id')); break;
      case 'seed.update':
        check(['pending', 'approved', 'rejected'].includes(String(input.status)));
        check(typeof input.high_yield === 'boolean');
        result = await mutate(() => supabaseAdmin.from('seed_accounts').update({ status: input.status as string, high_yield: input.high_yield as boolean, updated_at: new Date().toISOString() }).eq('id', id).select('id')); break;
      case 'seed.delete':
        result = await mutate(() => supabaseAdmin.from('seed_accounts').delete().eq('id', id).select('id')); break;
      default: throw new InputError();
    }
    if (result.error) return reply({ error: 'Operation failed' }, 500);
    if (!result.data?.length) return reply({ error: 'Target missing or state changed' }, 409);
    return reply({ ok: true, data: result.data, auditRecorded: result.auditRecorded });
  } catch (error) {
    if (error instanceof AuditError) return reply({ error: 'Audit service unavailable; operation not started' }, 503);
    if (error instanceof AgentAuthError) return reply({ error: 'Unauthorized' }, error.status);
    if (error instanceof InputError || error instanceof SyntaxError) return reply({ error: 'Invalid request' }, 400);
    return reply({ error: 'Operation failed' }, 500);
  }
}
