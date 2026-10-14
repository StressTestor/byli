/** Read repository schema into ephemeral PostgreSQL; no connection URL accepted. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const root = dirname(dirname(require.resolve('@electric-sql/pglite')));
const { uuid_ossp } = require(resolve(root, 'dist/contrib/uuid_ossp.cjs'));
const { pg_trgm } = require(resolve(root, 'dist/contrib/pg_trgm.cjs'));
const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
const here = dirname(fileURLToPath(import.meta.url));
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions++; };
try {
  await db.exec(await readFile(resolve(here, 'bootstrap.sql'), 'utf8'));
  for (const name of (await readdir(resolve(here, '../migrations'))).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(resolve(here, '../migrations', name), 'utf8'));
  }
  const { rows: [author] } = await db.query(`INSERT INTO authors (x_user_id,handle,display_name)
    VALUES ('synthetic-source-author','synthetic','Synthetic') RETURNING id`);
  const insert = async () => (await db.query(`INSERT INTO articles
    (x_article_id,x_url,title,author_id,status,source)
    VALUES (gen_random_uuid()::text,gen_random_uuid()::text,'Original',$1,'published','twitterapi')
    RETURNING *, indexed_at::text AS original_timestamp`, [author.id])).rows[0];
  const row = await insert();
  check(row.indexed_at.getTime() === row.updated_at.getTime(), 'Insert defaults match');
  const { rows: [equal] } = await db.query('SELECT indexed_at = updated_at AS pristine FROM articles WHERE id=$1', [row.id]);
  check(equal.pristine, 'Database equality preserves full timestamp precision');
  const cas = async (r, title) => (await db.query(`UPDATE articles SET title=$1,excerpt='Fresh',body_preview='Fresh body',read_time_min=2
    WHERE id=$2 AND x_article_id=$3 AND x_url=$4 AND author_id=$5 AND source='twitterapi'
    AND status='published' AND featured=false AND indexed_at=$6 AND updated_at=$6 RETURNING id`,
    [title,r.id,r.x_article_id,r.x_url,r.author_id,r.original_timestamp])).rows;
  await db.query('UPDATE article_stats SET like_count=17,bookmark_count=9 WHERE article_id=$1', [row.id]);
  check((await cas(row, 'Refreshed')).length === 1, 'First refresh matches');
  check((await cas(row, 'Stale worker')).length === 0, 'Second worker cannot reuse stale timestamp');
  const { rows: [after] } = await db.query('SELECT *, indexed_at = updated_at AS pristine FROM articles WHERE id=$1', [row.id]);
  check(!after.pristine && after.title === 'Refreshed', 'Update trigger invalidates first-refresh eligibility');
  check(after.status === row.status && after.featured === row.featured && after.source === row.source && after.author_id === row.author_id && after.x_url === row.x_url, 'Identity and moderation preserved');
  for (const edit of ["title='Admin edit'", "status='rejected'", 'featured=true', "source='manual'"]) {
    const candidate = await insert();
    await db.exec(`UPDATE articles SET ${edit} WHERE id='${candidate.id}'`);
    check((await cas(candidate, 'Must not overwrite')).length === 0, `Concurrent edit excluded: ${edit}`);
  }
  const nullable = await insert();
  await db.query('UPDATE articles SET indexed_at=NULL WHERE id=$1', [nullable.id]);
  check((await cas(nullable, 'Must not overwrite')).length === 0, 'Null indexed timestamp excluded');
  const { rows: [stats] } = await db.query('SELECT like_count,bookmark_count FROM article_stats WHERE article_id=$1', [row.id]);
  check(stats.like_count === 17 && stats.bookmark_count === 9, 'Content refresh leaves engagement counters unchanged');
  await db.exec('BEGIN');
  const sameTransaction = await insert();
  await db.query("UPDATE articles SET title='Same transaction edit' WHERE id=$1", [sameTransaction.id]);
  const { rows: [heuristic] } = await db.query('SELECT indexed_at = updated_at AS pristine FROM articles WHERE id=$1', [sameTransaction.id]);
  check(heuristic.pristine, 'Known limitation: same-transaction edits retain equality; this is not provenance proof');
  await db.exec('ROLLBACK');
  console.log(`PASS: ${assertions} source refresh assertions using repository historical migrations; ephemeral PostgreSQL only.`);
  console.log((await db.query('SELECT version()')).rows[0].version);
} finally { await db.close(); }
