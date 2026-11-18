// Ephemeral PostgreSQL only. Does not read env or contact production.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    INSERT INTO profiles VALUES ('00000000-0000-0000-0000-000000000001');
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;`);
  await db.exec(await readFile(new URL('../migrations/20261118020756_agent_credentials.sql', import.meta.url),'utf8'));
  const { rows: [grants] } = await db.query(`SELECT
    has_table_privilege('anon','agent_credentials','SELECT') AS anon_read,
    has_table_privilege('authenticated','agent_credentials','SELECT') AS user_read,
    has_table_privilege('authenticated','agent_credentials','UPDATE') AS user_write,
    has_table_privilege('service_role','agent_credentials','INSERT') AS service_write,
    (SELECT relrowsecurity FROM pg_class WHERE oid='agent_credentials'::regclass) AS rls`);
  assert.deepEqual(grants, {anon_read:false,user_read:false,user_write:false,service_write:true,rls:true});
  await db.exec('SET ROLE service_role');
  const { rows: [credential] } = await db.query(`INSERT INTO agent_credentials(owner_id,label,secret_hash,expires_at)
    VALUES ('00000000-0000-0000-0000-000000000001','Synthetic test',$1,now()+interval '1 day') RETURNING id`, ['a'.repeat(64)]);
  await assert.rejects(db.query(`INSERT INTO agent_credentials(owner_id,label,secret_hash,expires_at)
    VALUES ('00000000-0000-0000-0000-000000000001','Bad TTL',$1,now()+interval '91 days')`, ['b'.repeat(64)]));
  await db.query('UPDATE agent_credentials SET revoked_at=now() WHERE id=$1',[credential.id]);
  await db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(db.query('SELECT secret_hash FROM agent_credentials'));
  await assert.rejects(db.query('UPDATE agent_credentials SET revoked_at=NULL'));
  console.log('PASS: isolated PostgreSQL schema, grants, RLS, expiry constraint, revoke and browser-denial checks');
} finally { await db.close(); }
