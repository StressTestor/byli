// Run from the repo root: node tests/integration/article-visibility.mjs
// Uses synthetic data only and builds/runs Next in production mode.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const id = '11111111-1111-4111-8111-111111111111';
const relatedId = '22222222-2222-4222-8222-222222222222';
const author = { id: 'mock-author', handle: 'fixture', display_name: 'Fixture Author' };
const article = (id, title) => ({
  id, title, excerpt: title + ' excerpt', author_id: author.id, author,
  categories: [], x_url: 'https://example.test/article', published_at: '2026-01-01',
  stats: { like_count: 0, comment_count: 0, bookmark_count: 0, share_count: 0 },
});
const main = { ...article(id, 'Synthetic Main Title'), status: 'published' };
const related = { ...article(relatedId, 'Synthetic Related Title'), status: 'published' };
let detailReads = 0;
const stub = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.writeHead(405); res.end('{}'); return;
  }
  if (url.pathname !== '/rest/v1/articles') { res.end('[]'); return; }
  if (url.searchParams.get('id') === 'eq.' + id) {
    detailReads++;
    assert.equal(url.searchParams.get('status'), 'eq.published');
    if (main.status !== 'published') {
      res.writeHead(406); res.end(JSON.stringify({ code: 'PGRST116', message: 'No matching rows' })); return;
    }
    res.end(JSON.stringify(main)); return;
  }
  if (url.searchParams.get('id') === 'neq.' + id) {
    assert.equal(url.searchParams.get('status'), 'eq.published');
    res.end(JSON.stringify(related.status === 'published' ? [related] : [])); return;
  }
  res.end('[]');
});
const appPort = process.env.ARTICLE_VISIBILITY_TEST_PORT || '19147';
let app;
try {
  stub.listen(0, '127.0.0.1'); await once(stub, 'listening');
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${stub.address().port}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', NEXT_TELEMETRY_DISABLED: '1' };
  const build = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { env, stdio: 'inherit' });
  assert.deepEqual(await once(build, 'exit'), [0, null]);
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', appPort], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await Promise.race([(async () => {
    for await (const chunk of app.stdout) if (String(chunk).includes('Ready in')) return;
    throw new Error('Next exited before readiness');
  })(), sleep(10000, null, { ref: false }).then(() => { throw new Error('Next readiness timeout'); })]);
  const url = `http://127.0.0.1:${appPort}/article/${id}`;
  async function read() {
    const response = await fetch(url);
    return { status: response.status, html: await response.text() };
  }
  const warm = await read();
  assert.equal(warm.status, 200);
  assert.ok(warm.html.includes(`<title>${main.title} | Linkdrift</title>`) || warm.html.includes(`<title>${main.title}</title>`), 'Published title missing from metadata');
  assert.ok(warm.html.includes(related.title));
  assert.equal(detailReads, 1, 'Metadata and page should share a single detail lookup');
  related.status = 'archived';
  const afterRelatedArchive = await read();
  assert.equal(afterRelatedArchive.status, 200);
  assert.ok(!afterRelatedArchive.html.includes(related.title));
  assert.equal(detailReads, 2);
  main.status = 'archived';
  const afterArchive = await read();
  assert.equal(afterArchive.status, 404);
  assert.ok(!afterArchive.html.includes(main.title), 'Archived title appeared in HTML or metadata');
  assert.equal(detailReads, 3);
  console.log('Production Next article freshness, related cards and request-local de-duplication passed.');
} finally {
  app?.kill();
  stub.close();
}
