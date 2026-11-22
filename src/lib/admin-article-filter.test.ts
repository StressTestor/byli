import { describe, expect, it } from 'vitest';
import { parseAdminArticleIds } from './admin-article-filter';
const id = '12345678-1234-1234-1234-123456789abc';
const other = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
describe('exact admin article URL filter', () => {
  it.each(['', '?tab=articles', '?unrelated=articleIds'])('preserves default query when parameter absent: %s', search => {
    expect(parseAdminArticleIds(search)).toBeNull();
  });
  it('accepts one or multiple exact UUIDs', () => {
    expect(parseAdminArticleIds('?articleIds='+id)).toEqual([id]);
    expect(parseAdminArticleIds('?articleIds='+id+','+other)).toEqual([id, other]);
  });
  it('normalizes case and harmlessly deduplicates', () => {
    expect(parseAdminArticleIds('?articleIds='+id+','+id.toUpperCase())).toEqual([id]);
  });
  it('accepts exactly 50 UUIDs, but rejects a 51st even if duplicate', () => {
    expect(parseAdminArticleIds('?articleIds='+Array(50).fill(id).join(','))).toEqual([id]);
    expect(() => parseAdminArticleIds('?articleIds='+Array(51).fill(id).join(','))).toThrow('Invalid articleIds');
  });
  it.each(['', ',', id+',', ','+id, '*', 'not-a-uuid', id+'x', ' '+id, id+' ', `${id},not-a-uuid`, '%', '%00', '(id.eq.anything)'])('fails closed for malformed present value %s', value => {
    expect(() => parseAdminArticleIds('?articleIds='+encodeURIComponent(value))).toThrow('Invalid articleIds');
  });
  it('rejects repeated parameters rather than accepting a partial filter', () => {
    expect(() => parseAdminArticleIds('?articleIds='+id+'&articleIds='+other)).toThrow('Invalid articleIds');
  });
  it('rejects oversized values before splitting', () => {
    expect(() => parseAdminArticleIds('?articleIds='+'x'.repeat(10000))).toThrow('Invalid articleIds');
  });
});

// Exercise the actual Articles panel without exporting an extra Next page API.
import { beforeEach, afterEach, vi } from 'vitest';
import { createElement, type FunctionComponent } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const ui = vi.hoisted(() => ({ calls: [] as unknown[][], data: [] as unknown[], error: null as unknown, pending: null as null | Promise<unknown>, mutation: { data: null, error: null } as { data: unknown; error: unknown } }));
vi.mock('next/link', () => ({ default: (props: any) => createElement('a', props, props.children) }));
vi.mock('@/hooks/useAdminProfile', () => ({ useAdminProfile: () => ({ user: { id: 'admin', identities: [] }, profile: { role: 'admin' }, isAdmin: true, loading: false }) }));
vi.mock('@/lib/health-check', () => ({ runHealthCheck: async () => [] }));
vi.mock('@/components/agent-keys-panel', () => ({ AgentKeysPanel: () => null }));
vi.mock('@/lib/supabase-browser', () => ({ createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) }, from: (table: string) => {
  ui.calls.push(['from', table]);
  const q: any = {};
  for (const method of ['select', 'order', 'limit', 'in', 'insert', 'eq']) q[method] = (...args: unknown[]) => {
    ui.calls.push([method, ...args]); return q;
  };
  q.update = (payload: unknown) => {
    ui.calls.push(['update', payload]);
    return { eq: (...filter: unknown[]) => {
      ui.calls.push(['eq', ...filter]);
      return { select: async (columns: string) => {
        ui.calls.push(['select', columns]); return ui.mutation;
      } };
    } };
  };
  q.then = (resolve: (value: unknown) => void) => ui.pending ? ui.pending.then(resolve)
    : resolve({ data: table === 'articles' ? ui.data : [], error: ui.error });
  return q;
} }) }));
import AdminPage from '@/app/admin/page';
import AdminSidebar from '@/components/admin-sidebar';
let view: ReactTestRenderer | undefined;
let popstate: (() => void) | undefined;
const location = { search: '' };
async function mountArticles(search: string, component: FunctionComponent = AdminPage) {
  location.search = search;
  await act(async () => { view = create(createElement(component)); });
  const tab = view!.root.findAllByType('button').find(b => b.children.includes('Articles'))!;
  await act(async () => { tab.props.onClick(); });
}
beforeEach(() => {
  ui.calls = []; ui.data = []; ui.error = null; ui.pending = null; ui.mutation = { data: null, error: null }; popstate = undefined;
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('window', { location, addEventListener: (_: string, fn: () => void) => { popstate = fn; }, removeEventListener: vi.fn() });
});
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });
describe('Articles panel exact query integration', () => {
  it('preserves newest50 without a parameter', async () => {
    await mountArticles('');
    expect(ui.calls).toEqual([['from', 'articles'], ['select', '*'], ['order', 'indexed_at', { ascending: false }], ['limit', 50]]);
  });
  it('uses bounded exact IN ids only for Articles', async () => {
    await mountArticles('?articleIds='+id+','+other);
    expect(ui.calls).toEqual([['from', 'articles'], ['select', '*'], ['in', 'id', [id, other]], ['order', 'indexed_at', { ascending: false }], ['limit', 50]]);
  });
  it('does not query or fall back when filter is malformed', async () => {
    await mountArticles('?articleIds='+id+',bad');
    expect(ui.calls).toEqual([]);
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Invalid articleIds'));
  });
  it('clears prior results on malformed navigation and never loads a broad fallback', async () => {
    ui.data = [{ id, title: 'Old result', status: 'published', x_url: 'https://x.com/example/status/123' }];
    await mountArticles('?articleIds='+id);
    expect(JSON.stringify(view!.toJSON())).toContain('Old result');
    ui.calls = []; location.search = '?articleIds=';
    await act(async () => { popstate!(); });
    expect(ui.calls).toEqual([]);
    expect(JSON.stringify(view!.toJSON())).not.toContain('Old result');
  });
  it('ends loading and reports query errors without retrying unfiltered', async () => {
    ui.error = { message: 'Synthetic unavailable' };
    await mountArticles('?articleIds='+id);
    expect(alert).toHaveBeenCalledWith('Failed to load articles. No fallback results were loaded.');
    expect(ui.calls.filter(c => c[0] === 'from')).toHaveLength(1);
    expect(JSON.stringify(view!.toJSON())).not.toContain('animate-pulse');
  });
  it('ignores an earlier successful request after malformed navigation', async () => {
    let resolve!: (value: unknown) => void;
    ui.pending = new Promise(r => { resolve = r; });
    await mountArticles('?articleIds='+id);
    location.search = '?articleIds=bad';
    await act(async () => { popstate!(); });
    await act(async () => { resolve({ data: [{ id, title: 'Stale result' }], error: null }); });
    expect(JSON.stringify(view!.toJSON())).not.toContain('Stale result');
  });
});

describe.each([{ name: 'admin page', component: AdminPage }, { name: 'admin sidebar', component: AdminSidebar }])('$name confirms article mutations', ({ component }) => {
  it.each([
    { button: 'Archive', featured: true, data: [], error: null, payload: { status: 'archived' }, alertText: 'No article update was confirmed.' },
    { button: 'Feature', featured: false, data: null, error: { message: 'publication policy' }, payload: { featured: true }, alertText: 'Failed to update: publication policy' },
    { button: 'Unfeature', featured: true, data: [], error: null, payload: { featured: false }, alertText: 'No article update was confirmed.' },
  ])('$button does not log success unless an update was confirmed', async ({ button, featured, payload, data, error, alertText }) => {
    ui.data = [{ id, title: 'Policy fixture', status: 'published', featured, x_url: 'https://x.com/example/status/123' }];
    ui.mutation = { data, error };
    await mountArticles('?articleIds='+id, component);
    ui.calls = [];
    const action = view!.root.findAllByType('button').find(b => b.children.includes(button))!;
    await act(async () => { await action.props.onClick(); });
    expect(ui.calls).toEqual([['from', 'articles'], ['update', payload], ['eq', 'id', id], ['select', 'id']]);
    expect(alert).toHaveBeenCalledWith(alertText);
  });
  it.each([
    { button: 'Archive', payload: { status: 'archived' }, actionName: 'change_article_status' },
    { button: 'Unfeature', payload: { featured: false }, actionName: 'unfeature_article' },
  ])('retains $button and logs its confirmed update', async ({ button, payload, actionName }) => {
    ui.data = [{ id, title: 'Policy fixture', status: 'published', featured: true, x_url: 'https://x.com/example/status/123' }];
    ui.mutation = { data: [{ id }], error: null };
    await mountArticles('?articleIds='+id, component);
    ui.calls = [];
    const action = view!.root.findAllByType('button').find(b => b.children.includes(button))!;
    await act(async () => { await action.props.onClick(); });
    expect(ui.calls.slice(0,4)).toEqual([['from', 'articles'], ['update', payload], ['eq', 'id', id], ['select', 'id']]);
    expect(ui.calls).toContainEqual(['insert', expect.objectContaining({ action: actionName, target_id: id })]);
    expect(alert).not.toHaveBeenCalled();
    if (component === AdminPage) expect(ui.calls).toContainEqual(['in', 'id', [id]]);
  });
});
