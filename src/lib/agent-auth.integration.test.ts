import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const state = vi.hoisted(() => ({ db: null as any }));
// Adapter translates the production auth module's Supabase query chain to a
// disposable real PostgreSQL database. No production URL/credential is read.
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from(table: string) {
  const clauses: string[] = [], args: unknown[] = [];
  let insert: any = null;
  const q: any = {
    select: () => q,
    eq(k:string,v:unknown) { args.push(v); clauses.push(`${k}=$${args.length}`); return q; },
    is(k:string) { clauses.push(`${k} IS NULL`); return q; },
    gt(k:string,v:unknown) { args.push(v); clauses.push(`${k}>$${args.length}`); return q; },
    insert(v:unknown) { insert=v; return q; },
    maybeSingle: () => q,
    async then(resolve: (v:unknown)=>void) {
      if (insert) {
        await state.db.query('INSERT INTO admin_logs(admin_id,action,target_id,metadata) VALUES ($1,$2,$3,$4)',[insert.admin_id,insert.action,insert.target_id,JSON.stringify(insert.metadata)]);
        return resolve({error:null});
      }
      const result = await state.db.query(`SELECT * FROM ${table} WHERE ${clauses.join(' AND ')}`,args);
      return resolve({data:result.rows[0] ?? null,error:null});
    },
  }; return q;
} } }));
import { authenticateAgent, hashAgentSecret, newAgentSecret } from './agent-auth';
const principal = '00000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
    CREATE TABLE admin_logs(admin_id uuid,action text,target_id uuid,metadata jsonb);
    INSERT INTO profiles VALUES ('${principal}','admin');`);
  await state.db.exec(await readFile('supabase/migrations/20261118020756_agent_credentials.sql','utf8'));
  await state.db.exec(await readFile('supabase/migrations/20261118025808_submission_review_scope.sql','utf8'));
});
afterAll(async () => state.db?.close());
it('validates real disposable credentials, tampering, expiry, demotion and revocation', async () => {
  const token = newAgentSecret();
  const {rows:[row]} = await state.db.query(`INSERT INTO agent_credentials(owner_id,label,secret_hash,expires_at) VALUES ($1,'Synthetic test',$2,now()+interval '1 day') RETURNING id`,[principal,hashAgentSecret(token)]);
  await expect(authenticateAgent(`Bearer ${token}`,'list.articles')).resolves.toEqual({userId:principal,credentialId:row.id});
  await expect(authenticateAgent(`Bearer ${newAgentSecret()}`,'list.articles')).rejects.toMatchObject({status:401});
  await state.db.query("UPDATE profiles SET role='user' WHERE id=$1",[principal]);
  await expect(authenticateAgent(`Bearer ${token}`,'list.articles')).rejects.toMatchObject({status:401});
  await state.db.query("UPDATE profiles SET role='admin' WHERE id=$1",[principal]);
  await state.db.query("UPDATE agent_credentials SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[row.id]);
  await expect(authenticateAgent(`Bearer ${token}`,'list.articles')).rejects.toMatchObject({status:401});
  await state.db.query("UPDATE agent_credentials SET expires_at=now()+interval '1 day',revoked_at=now() WHERE id=$1",[row.id]);
  await expect(authenticateAgent(`Bearer ${token}`,'list.articles')).rejects.toMatchObject({status:401});
  const {rows:logs} = await state.db.query('SELECT * FROM admin_logs');
  expect(logs).toHaveLength(1);
  expect(JSON.stringify(logs)).not.toContain(token);
  // No raw token ever persisted or printed; database destroyed by afterAll.
});

it('enforces a real review credential scope and leaves existing admin scope unchanged', async () => {
  const token = newAgentSecret();
  const {rows:[row]} = await state.db.query(`INSERT INTO agent_credentials(owner_id,label,scope,secret_hash,expires_at) VALUES ($1,'Synthetic reviewer','submission_review',$2,now()+interval '1 day') RETURNING id`,[principal,hashAgentSecret(token)]);
  for (const operation of ['list.submissions', 'submission.reject', 'approve_submission']) {
    await expect(authenticateAgent(`Bearer ${token}`,operation)).resolves.toEqual({userId:principal,credentialId:row.id});
  }
  for (const operation of ['ingest','list.profiles','list.logs','article.delete','setting.update','profile.role','credentials.issue','unknown']) {
    await expect(authenticateAgent(`Bearer ${token}`,operation)).rejects.toMatchObject({status:403});
  }
  const {rows:old} = await state.db.query("SELECT scope FROM agent_credentials WHERE label='Synthetic test'");
  expect(old[0].scope).toBe('admin');
  await state.db.query('UPDATE agent_credentials SET revoked_at=now() WHERE id=$1',[row.id]);
  await expect(authenticateAgent(`Bearer ${token}`,'list.submissions')).rejects.toMatchObject({status:401});
});
