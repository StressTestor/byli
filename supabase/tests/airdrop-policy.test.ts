import { beforeAll,afterAll,expect,it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import fixtures from '../../src/lib/fixtures/airdrop-policy.json';
import { isBlockedAirdropContent } from '../../src/lib/airdrop-policy';
const db=new PGlite();
const claimMigration='supabase/migrations/20261122194643_airdrop_claim_announcements.sql';
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
 CREATE TABLE public.articles(id text PRIMARY KEY,title text,excerpt text,body_preview text,status text,featured boolean DEFAULT false);
 GRANT USAGE ON SCHEMA public TO authenticated,service_role;
 GRANT ALL ON public.articles TO authenticated,service_role;
 INSERT INTO articles(id,title,status) VALUES('legacy','Crypto airdrop is live','published');`);
 await db.exec(await readFile('supabase/migrations/20261122194411_airdrop_publication_guard.sql','utf8'));
 const before=await db.query("SELECT oid,proacl FROM pg_proc WHERE oid='public.is_blocked_airdrop_content(text,text,text)'::regprocedure");
 await db.exec(await readFile(claimMigration,'utf8'));
 const after=await db.query("SELECT oid,proacl FROM pg_proc WHERE oid='public.is_blocked_airdrop_content(text,text,text)'::regprocedure");
 expect(after.rows).toEqual(before.rows);
},15000);
afterAll(()=>db.close());
it.each(fixtures)('SQL/JS UTF8 parity: $title',async(row)=>{
 const {rows}=await db.query<{blocked:boolean}>('SELECT public.is_blocked_airdrop_content($1,$2,$3) AS blocked',[row.title,'excerpt' in row?row.excerpt:null,'body_preview' in row?row.body_preview:null]);
 expect(rows[0].blocked).toBe(row.blocked);expect(rows[0].blocked).toBe(isBlockedAirdropContent(row));
});
it('denies direct browser and service-role publication, while archive/unfeature remain possible',async()=>{
 for(const role of ['authenticated','service_role']){
  await db.exec(`SET ROLE ${role}`);
  await expect(db.query("INSERT INTO articles(id,title,status) VALUES($1,'Crypto airdrop is live','published')",[role+'bad'])).rejects.toMatchObject({code:'23514',constraint:'articles_airdrop_publication_policy'});
  await db.query("INSERT INTO articles(id,title,status) VALUES($1,'Crypto airdrop is live','archived')",[role+'draft']);
  await expect(db.query("UPDATE articles SET status='published' WHERE id=$1",[role+'draft'])).rejects.toMatchObject({code:'23514'});
  await db.query("INSERT INTO articles(id,title,status) VALUES($1,'Ordinary news','published')",[role+'good']);
  await expect(db.query("UPDATE articles SET title='Crypto airdrop is live' WHERE id=$1",[role+'good'])).rejects.toMatchObject({code:'23514'});
  await db.exec('RESET ROLE');
 }
 await expect(db.query("UPDATE articles SET featured=true WHERE id='legacy'")).rejects.toMatchObject({code:'23514'});
 await db.query("UPDATE articles SET featured=false WHERE id='legacy'");
 await db.query("UPDATE articles SET status='archived' WHERE id='legacy'");
 await db.query("DELETE FROM articles WHERE id='legacy'");
 const {rows}=await db.query<{allowed:boolean}>("SELECT has_function_privilege('anon','public.is_blocked_airdrop_content(text,text,text)','EXECUTE') AS allowed");
 expect(rows[0].allowed).toBe(false);
});
it('does not mutate existing rows when installing guard',async()=>{
 // The migration only defines functions/trigger; no data statements permitted.
 const sql=await readFile('supabase/migrations/20261122194411_airdrop_publication_guard.sql','utf8');
 expect(sql).not.toMatch(/\b(TRUNCATE|DROP TABLE|DELETE FROM|UPDATE public\.articles|INSERT INTO)\b/i);
});

it('rejects claim availability on publication without rebuilding the trigger',async()=>{
 await db.exec('SET ROLE authenticated');
 try {
  await expect(db.exec("INSERT INTO articles(id,title,status) VALUES('announcement','News: airdrop claims open after token launch','published')")).rejects.toMatchObject({code:'23514',constraint:'articles_airdrop_publication_policy'});
  await db.exec("INSERT INTO articles(id,title,status) VALUES('future','News: airdrop claims will open after token launch','published')");
 } finally {
  await db.exec('RESET ROLE');
 }
 const sql=await readFile(claimMigration,'utf8');
 expect(sql).not.toMatch(/^[ \t]*(CREATE TRIGGER|DROP|TRUNCATE|DELETE FROM|UPDATE public\.articles|INSERT INTO|GRANT|REVOKE)\b/im);
});
