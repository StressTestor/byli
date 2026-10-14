/**
 * In-memory PostgreSQL only. No URL, credentials, or persistent database path
 * is accepted. PGLITE_MODULE_PATH may point at a locally installed package.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { PGlite } = require(modulePath);
const packageRoot = dirname(dirname(require.resolve(modulePath)));
const { uuid_ossp } = require(resolve(packageRoot, 'dist/contrib/uuid_ossp.cjs'));
const { pg_trgm } = require(resolve(packageRoot, 'dist/contrib/pg_trgm.cjs'));
const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
const securityMigration = '20261014010000_lock_client_submission_columns.sql';
let phase = 'bootstrap';
try {
  await db.exec(await readFile(resolve(here, 'bootstrap.sql'), 'utf8'));
  const history = (await readdir(resolve(here, '../migrations')))
    .filter(name => name.endsWith('.sql') && name < securityMigration).sort();
  for (const name of history) {
    phase = `historical migration ${name}`;
    await db.exec(await readFile(resolve(here, '../migrations', name), 'utf8'));
  }
  phase = 'fixtures';
  await db.exec(await readFile(resolve(here, 'client-security-fixtures.sql'), 'utf8'));
  phase = 'candidate security migration';
  await db.exec(await readFile(resolve(here, '../proposed', securityMigration), 'utf8'));
  const laterMigrations = (await readdir(resolve(here, '../proposed')))
    .filter(name => name.endsWith('.sql') && name > securityMigration).sort();
  for (const name of laterMigrations) {
    phase = `companion migration ${name}`;
    await db.exec(await readFile(resolve(here, '../proposed', name), 'utf8'));
  }
  phase = 'role/RLS/validation tests';
  await db.exec(await readFile(resolve(here, 'client-security.sql'), 'utf8'));
  const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM test_assertions');
  assert.ok(count > 0);
  phase = 'rollback rehearsal';
  await db.exec(await readFile(resolve(here, '../rollbacks', securityMigration), 'utf8'));
  const { rows: [rollback] } = await db.query(`SELECT
    has_table_privilege('authenticated', 'public.submissions', 'INSERT') AS submissions_insert,
    has_table_privilege('authenticated', 'public.seed_accounts', 'INSERT') AS seed_insert,
    has_table_privilege('authenticated', 'public.api_keys', 'UPDATE') AS key_update,
    to_regprocedure('public.validate_submission_content()') IS NULL AS no_submission_trigger_function,
    to_regprocedure('public.validate_profile_username()') IS NULL AS no_profile_trigger_function`);
  assert.ok(Object.values(rollback).every(Boolean), 'Rollback did not restore expected baseline');
  phase = 'reapply after rollback';
  await db.exec(await readFile(resolve(here, '../proposed', securityMigration), 'utf8'));
  const { rows: [{ version }] } = await db.query('SELECT version()');
  console.log(`PASS: ${history.length} historical migrations + ${laterMigrations.length} companion migrations, ${count} security assertions, rollback and reapply.`);
  console.log(version);
  console.log('Only an ephemeral in-memory synthetic database was used. No live database was contacted.');
} catch (error) {
  console.error(`FAIL during ${phase}:`, error.message);
  if (error.detail) console.error(error.detail);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
