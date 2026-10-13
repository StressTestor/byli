import { describe, it, expect, vi } from 'vitest';
import { runHealthCheck } from './health-check';

// run_db_health_check() returns a summary ({ run_id, articles, ... }) and
// writes the individual checks to health_checks under that run_id.
function fakeClient(rpcResult: { data: unknown; error: unknown }, rows: unknown[]) {
  const eq = vi.fn();
  const query: any = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    eq: vi.fn((...args: unknown[]) => { eq(...args); return query; }),
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
  };
  const client: any = {
    rpc: vi.fn(async () => rpcResult),
    from: vi.fn(() => query),
  };
  return { client, eq };
}

const ROWS = [{ id: '1', check_name: 'article_count', status: 'pass', run_id: 'run-1' }];

describe('runHealthCheck', () => {
  it('returns the rows written by this run, not the summary object', async () => {
    const { client, eq } = fakeClient({ data: { run_id: 'run-1', articles: 800 }, error: null }, ROWS);
    const checks = await runHealthCheck(client, 10);
    expect(client.rpc).toHaveBeenCalledWith('run_db_health_check');
    expect(client.from).toHaveBeenCalledWith('health_checks');
    expect(eq).toHaveBeenCalledWith('run_id', 'run-1');
    expect(checks).toEqual(ROWS);
  });

  it('falls back to the latest stored checks when the run fails', async () => {
    const { client, eq } = fakeClient({ data: null, error: { message: 'admin only' } }, ROWS);
    const checks = await runHealthCheck(client, 5);
    expect(eq).not.toHaveBeenCalled();
    expect(checks).toEqual(ROWS);
  });
});
