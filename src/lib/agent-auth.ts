import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { Database } from '@/types/database';

// Local schema extension until generated types are refreshed after migration.
type Credential = { id: string; owner_id: string; label: string; secret_hash: string; scope: string; created_at: string; expires_at: string; revoked_at: string | null };
type AgentDatabase = Database & { public: { Tables: { agent_credentials: { Row: Credential; Insert: Omit<Credential, 'created_at' | 'revoked_at'>; Update: Partial<Credential>; Relationships: [] } } } };
export const agentDb = supabaseAdmin as unknown as SupabaseClient<AgentDatabase>;
export class AgentAuthError extends Error {
  constructor(message = 'Invalid agent credential', public status = 401) { super(message); }
}
export function hashAgentSecret(secret: string) { return createHash('sha256').update(secret).digest('hex'); }
export function newAgentSecret() { return `ld_agent_${randomBytes(32).toString('base64url')}`; }
// Closed operation registry: new routes gain no implicit bearer authority.
export const adminAgentOperations = [
  'list.submissions', 'list.articles', 'list.profiles', 'list.settings',
  'list.health', 'list.logs', 'list.seeds', 'list.categories', 'list.authors',
  'article.feature', 'article.status', 'article.delete', 'submission.reject',
  'setting.update', 'health.run', 'profile.role', 'seed.create', 'seed.update',
  'seed.delete', 'approve_submission', 'ingest',
] as const;
export const submissionReviewOperations = ['list.submissions', 'submission.reject', 'approve_submission'] as const;
export function agentScopeAllows(scope: string, operation: string): boolean {
  const allowed: readonly string[] = scope === 'admin' ? adminAgentOperations
    : scope === 'submission_review' ? submissionReviewOperations : [];
  return allowed.includes(operation);
}
export async function authenticateAgent(authorization: string | null, action: string) {
  const match = /^Bearer (ld_agent_[A-Za-z0-9_-]{43})$/.exec(authorization || '');
  if (!match) throw new AgentAuthError();
  const { data: credential, error } = await agentDb.from('agent_credentials')
    .select('*').eq('secret_hash', hashAgentSecret(match[1])).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) throw new AgentAuthError('Credential service unavailable', 503);
  if (!credential || !['admin', 'submission_review'].includes(credential.scope)) throw new AgentAuthError();
  if (!agentScopeAllows(credential.scope, action)) throw new AgentAuthError('Operation outside credential scope', 403);
  // Revoking/demoting the issuing admin immediately disables their credentials.
  const { data: owner, error: ownerError } = await supabaseAdmin.from('profiles').select('role').eq('id', credential.owner_id).maybeSingle();
  if (ownerError) throw new AgentAuthError('Credential service unavailable', 503);
  if (owner?.role !== 'admin') throw new AgentAuthError();
  // Record authorization BEFORE dispatch; fail closed on audit write failure.
  // Never include tokens, request bodies, or query strings in this log.
  const { error: auditError } = await supabaseAdmin.from('admin_logs').insert({
    admin_id: credential.owner_id, action: 'agent_authorized', target_type: 'agent_credential', target_id: credential.id,
    metadata: { credential_id: credential.id, operation: action, scope: credential.scope },
  });
  if (auditError) throw new AgentAuthError('Audit service unavailable', 503);
  return { userId: credential.owner_id, credentialId: credential.id };
}
