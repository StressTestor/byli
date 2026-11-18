import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: mock }));
import { authenticateAgent, hashAgentSecret, newAgentSecret } from './agent-auth';
const token = 'ld_agent_' + 'A'.repeat(43);
function response(data: unknown, error: unknown = null) {
  const q: any = { data, error };
  for (const method of ['select', 'eq', 'is', 'gt', 'maybeSingle', 'insert']) q[method] = vi.fn(() => q);
  return q;
}
beforeEach(() => mock.from.mockReset());
describe('agent credentials', () => {
  it('generates unique high entropy secrets and stores only a digest', () => {
    const a = newAgentSecret(), b = newAgentSecret();
    expect(a).toMatch(/^ld_agent_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b); expect(hashAgentSecret(a)).toHaveLength(64);
    expect(hashAgentSecret(a)).not.toContain(a);
  });
  it.each([null, '', 'Bearer abc', 'Basic '+token, 'Bearer '+token+'\n'])('rejects malformed credentials %s', async header => {
    await expect(authenticateAgent(header, 'read')).rejects.toMatchObject({status:401});
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('filters revoked and expired tokens before granting access', async () => {
    const q = response(null); mock.from.mockReturnValue(q);
    await expect(authenticateAgent('Bearer '+token, 'read')).rejects.toMatchObject({status:401});
    expect(q.is).toHaveBeenCalledWith('revoked_at', null);
    expect(q.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
    expect(q.eq).toHaveBeenCalledWith('secret_hash', hashAgentSecret(token));
  });
  it('rejects demoted principals', async () => {
    mock.from.mockReturnValueOnce(response({id:'credential',owner_id:'admin',scope:'admin'})).mockReturnValueOnce(response({role:'user'}));
    await expect(authenticateAgent('Bearer '+token, 'read')).rejects.toMatchObject({status:401});
  });
  it('fails closed if audit unavailable', async () => {
    mock.from.mockReturnValueOnce(response({id:'credential',owner_id:'admin',scope:'admin'})).mockReturnValueOnce(response({role:'admin'})).mockReturnValueOnce(response(null,{message:'down'}));
    await expect(authenticateAgent('Bearer '+token, 'read')).rejects.toMatchObject({status:503});
  });
  it('grants ordinary admin powers with distinct credential attribution', async () => {
    const audit = response(null);
    mock.from.mockReturnValueOnce(response({id:'credential',owner_id:'other-admin',scope:'admin'})).mockReturnValueOnce(response({role:'admin'})).mockReturnValueOnce(audit);
    await expect(authenticateAgent('Bearer '+token, 'read')).resolves.toEqual({userId:'other-admin',credentialId:'credential'});
    expect(JSON.stringify(audit.insert.mock.calls)).not.toContain(token);
  });
});
