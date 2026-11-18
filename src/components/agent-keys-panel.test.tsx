import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';

const auth = vi.hoisted(() => ({ callback: null as null | ((event: string) => void), unsubscribe: vi.fn() }));
vi.mock('@/lib/supabase-browser', () => ({ createBrowserClient: () => ({ auth: {
  onAuthStateChange: (callback: (event: string) => void) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  },
} }) }));
import { AgentKeysPanel } from './agent-keys-panel';
const fetchMock = vi.fn();
let view: ReactTestRenderer | undefined;
const credential = {
  id: '12345678-1234-1234-1234-123456789abc',
  owner_id: '11ca70b7-4ecf-4446-a6cb-47eb80e84d44',
  label: 'Test agent', scope: 'admin',
  created_at: '2026-11-17T00:00:00Z', expires_at: '2099-12-01T00:00:00Z', revoked_at: null,
};
const secret = 'ld_agent_' + 'X'.repeat(43);
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function text(node: ReactTestInstance): string { return node.children.map(c => typeof c === 'string' ? c : text(c)).join(''); }
function button(label: RegExp) { return view!.root.findAllByType('button').find(b => label.test(text(b)))!; }
function rendered() { return JSON.stringify(view?.toJSON()); }
async function click(label: RegExp) { await act(async () => { await button(label).props.onClick(); }); }
beforeEach(() => {
  fetchMock.mockReset(); auth.callback = null; auth.unsubscribe.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

async function mount(status = 200, keys = [credential]) {
  fetchMock.mockResolvedValueOnce(response({ credentials: keys }, status));
  await act(async () => { view = create(<AgentKeysPanel />); });
}
async function label(value = 'Test agent') {
  await act(async () => { view!.root.findByProps({ 'aria-label': 'Key label' }).props.onChange({ target: { value } }); });
}
async function issue() {
  await label();
  fetchMock.mockResolvedValueOnce(response({ id: credential.id, token: secret }, 201));
  fetchMock.mockResolvedValueOnce(response({ credentials: [credential] }));
  await click(/^Create key$/);
}
async function confirmAction(action: 'Revoke' | 'Rotate') {
  await click(new RegExp('^'+action+'$'));
  const confirm = button(action === 'Rotate' ? /^Confirm rotation$/ : /^Confirm revoke$/);
  if (confirm) await act(async () => { confirm.props.onClick(); });
}
describe('owner agent key panel', () => {
  it('hides all controls when server denies owner authorization', async () => {
    await mount(403);
    expect(view!.toJSON()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('shows owner list and controls only after successful server check', async () => {
    await mount();
    expect(rendered()).toContain('Test agent');
    expect(button(/^Create key$/)).toBeDefined();
    expect(button(/^Revoke$/)).toBeDefined();
  });
  it('keeps a new secret out of DOM until explicit reveal and clears it on dismissal', async () => {
    await mount(); await issue();
    expect(rendered()).not.toContain(secret);
    expect(button(/^Reveal key$/)).toBeDefined();
    await click(/^Reveal key$/);
    expect(rendered()).toContain(secret);
    await click(/^Dismiss key$/);
    expect(rendered()).not.toContain(secret);
    expect(button(/^Reveal key$/)).toBeUndefined();
  });
  it('tests a harmless bounded read using the new token without displaying returned data', async () => {
    await mount(); await issue();
    fetchMock.mockResolvedValueOnce(response({ data: [{ private: 'do-not-render-this' }] }));
    await click(/^Test read$/);
    const [url, options] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/agent/admin');
    expect(options.headers.Authorization).toBe('Bearer '+secret);
    expect(JSON.parse(options.body)).toEqual({ operation: 'list.categories', limit: 1 });
    expect(rendered()).toContain('HTTP 200');
    expect(rendered()).not.toContain('do-not-render-this');
    expect(rendered()).toMatch(/No application content (?:was )?changed/);
  });
  it('revokes then verifies a held secret returns 401 and clears plaintext', async () => {
    await mount(); await issue(); await click(/^Reveal key$/);
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    fetchMock.mockResolvedValueOnce(response({ error: 'Invalid credential' }, 401));
    fetchMock.mockResolvedValueOnce(response({ credentials: [{ ...credential, revoked_at: new Date().toISOString() }] }));
    await confirmAction('Revoke');
    expect(fetchMock.mock.calls.at(-3)![1].method).toBe('DELETE');
    expect(fetchMock.mock.calls.at(-2)![0]).toBe('/api/agent/admin');
    expect(rendered()).toContain('401');
    expect(rendered()).not.toContain(secret);
    expect(button(/^Reveal key$/)).toBeUndefined();
  });
  it('rotates by revoking first and warns when replacement issuance fails', async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    fetchMock.mockResolvedValueOnce(response({ error: 'Issue failed' }, 503));
    fetchMock.mockResolvedValueOnce(response({ credentials: [{ ...credential, revoked_at: new Date().toISOString() }], offset: 0, nextOffset: null }));
    await confirmAction('Rotate');
    expect(fetchMock.mock.calls.slice(1).map(c => c[1]?.method)).toEqual(['DELETE', 'POST', undefined]);
    expect(rendered()).toMatch(/Old key revoked/);
    expect(rendered()).toMatch(/access remains interrupted/);
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'POST')![1].body).adminUserId).toBe(credential.owner_id);
  });
  it('never issues a replacement when revoke fails', async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(response({ error: 'Revoke failed' }, 503));
    await confirmAction('Rotate');
    expect(fetchMock.mock.calls.slice(1).map(c => c[1]?.method)).toEqual(['DELETE']);
    expect(rendered()).toContain('No replacement was issued');
  });
  it('guards immediate duplicate create clicks before disabled UI rerenders', async () => {
    await mount(); await label();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const handler = button(/^Create key$/).props.onClick;
    await act(async () => { handler(); handler(); });
    expect(fetchMock.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1);
    expect(button(/^Create key$/).props.disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(response({ credentials: [credential] }));
    await act(async () => { pending.resolve(response({ id: credential.id, token: secret }, 201)); });
    expect(button(/^Create key$/).props.disabled).toBe(false);
  });
  it('clears plaintext on session change and rejects late issuance from previous session', async () => {
    await mount(); await label();
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    await click(/^Create key$/);
    fetchMock.mockResolvedValueOnce(response({}, 403));
    await act(async () => { auth.callback!('SIGNED_OUT'); });
    expect(view!.toJSON()).toBeNull();
    await act(async () => { pending.resolve(response({ id: credential.id, token: secret }, 201)); });
    expect(view!.toJSON()).toBeNull();
    expect(fetchMock.mock.calls.filter(c => !c[1]?.method)).toHaveLength(2);
  });
  it('removes an already revealed secret when another account signs in', async () => {
    await mount(); await issue(); await click(/^Reveal key$/);
    fetchMock.mockResolvedValueOnce(response({}, 403));
    await act(async () => { auth.callback!('SIGNED_IN'); });
    expect(view!.toJSON()).toBeNull();
  });
  it('ignores in-flight issuance after unmount and unsubscribes', async () => {
    await mount(); await label();
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    await click(/^Create key$/);
    await act(async () => { view!.unmount(); });
    await act(async () => { pending.resolve(response({ id: credential.id, token: secret }, 201)); });
    expect(auth.unsubscribe).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view!.toJSON()).toBeNull();
  });
  it('canceling an inline rotation confirmation performs no request', async () => {
    await mount();
    await click(/^Rotate$/);
    expect(button(/^Confirm rotation$/)).toBeDefined();
    await click(/^Cancel$/);
    expect(button(/^Confirm rotation$/)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not expose a late owner list after a newer session denial', async () => {
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => { view = create(<AgentKeysPanel />); });
    fetchMock.mockResolvedValueOnce(response({}, 403));
    await act(async () => { auth.callback!('SIGNED_IN'); });
    await act(async () => { pending.resolve(response({ credentials: [credential] })); });
    expect(view!.toJSON()).toBeNull();
  });
  it('clears a displayed secret when refreshed owner authorization is denied', async () => {
    await mount(); await issue(); await click(/^Reveal key$/);
    fetchMock.mockResolvedValueOnce(response({}, 403));
    await click(/^Refresh list$/);
    expect(view!.toJSON()).toBeNull();
  });
  it('sends the selected associated admin UUID on issuance', async () => {
    await mount(); await label();
    const other = 'abcdefab-1234-1234-1234-123456789abc';
    await act(async () => { view!.root.findByProps({ 'aria-label': 'Associated admin UUID' }).props.onChange({ target: { value: other } }); });
    fetchMock.mockResolvedValueOnce(response({ id: credential.id, token: secret }, 201));
    fetchMock.mockResolvedValueOnce(response({ credentials: [credential] }));
    await click(/^Create key$/);
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'POST')![1].body).adminUserId).toBe(other);
  });
  it('does not retry ambiguous issuance and refreshes metadata only', async () => {
    await mount(); await label();
    fetchMock.mockRejectedValueOnce(new Error('network lost'));
    fetchMock.mockResolvedValueOnce(response({ credentials: [credential] }));
    await click(/^Create key$/);
    expect(fetchMock.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1);
    expect(rendered()).toMatch(/interrupted|unconfirmed/i);
    expect(rendered()).not.toContain(secret);
  });

  it('navigates past 100 keys, revokes an older key, and returns to newer metadata', async () => {
    const recent = Array.from({ length: 100 }, (_, index) => ({ ...credential, id: `recent-${index}`, label: `Recent ${index}` }));
    const older = { ...credential, id: 'abcdefab-1234-1234-1234-123456789abc', label: 'Older than first hundred' };
    fetchMock.mockResolvedValueOnce(response({ credentials: recent, offset: 0, nextOffset: 100 }));
    await act(async () => { view = create(<AgentKeysPanel />); });
    expect(button(/^Newer keys$/).props.disabled).toBe(true);
    expect(button(/^Older keys$/).props.disabled).toBe(false);
    fetchMock.mockResolvedValueOnce(response({ credentials: [older], offset: 100, nextOffset: null }));
    await click(/^Older keys$/);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/admin/agent-credentials?offset=100');
    expect(rendered()).toContain(older.label);
    expect(rendered()).not.toContain('Recent 0');
    expect(button(/^Older keys$/).props.disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    fetchMock.mockResolvedValueOnce(response({ credentials: [{ ...older, revoked_at: new Date().toISOString() }], offset: 100, nextOffset: null }));
    await confirmAction('Revoke');
    const deletion = fetchMock.mock.calls.find(c => c[1]?.method === 'DELETE')!;
    expect(JSON.parse(deletion[1].body)).toEqual({ id: older.id });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/admin/agent-credentials?offset=100');
    expect(button(/^Revoke$/)).toBeUndefined();
    fetchMock.mockResolvedValueOnce(response({ credentials: recent, offset: 0, nextOffset: 100 }));
    await click(/^Newer keys$/);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/admin/agent-credentials');
    expect(rendered()).toContain('Recent 0');
    expect(button(/^Newer keys$/).props.disabled).toBe(true);
  });
  it('returns to page zero after creating a credential from an older page', async () => {
    fetchMock.mockResolvedValueOnce(response({ credentials: [credential], offset: 0, nextOffset: 100 }));
    await act(async () => { view = create(<AgentKeysPanel />); });
    fetchMock.mockResolvedValueOnce(response({ credentials: [credential], offset: 100, nextOffset: null }));
    await click(/^Older keys$/);
    expect(button(/^Newer keys$/).props.disabled).toBe(false);
    await issue();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/admin/agent-credentials');
    expect(button(/^Newer keys$/).props.disabled).toBe(true);
  });
  it.each([200, 503])('does not replace a held key if post-revoke read returns %i instead of401', async status => {
    await mount(); await issue(); await click(/^Reveal key$/);
    const start = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    fetchMock.mockResolvedValueOnce(response({}, status));
    fetchMock.mockResolvedValueOnce(response({ credentials: [{ ...credential, revoked_at: new Date().toISOString() }], offset: 0, nextOffset: null }));
    await confirmAction('Rotate');
    const calls = fetchMock.mock.calls.slice(start);
    expect(calls[0][1].method).toBe('DELETE');
    expect(calls[1][0]).toBe('/api/agent/admin');
    expect(calls.filter(c => c[0] === '/api/admin/agent-credentials' && c[1]?.method === 'POST')).toHaveLength(0);
    expect(rendered()).toContain(`verification returned HTTP ${status}`);
    expect(rendered()).toContain('No replacement issued');
    expect(rendered()).not.toContain(secret);
    expect(button(/^Reveal key$/)).toBeUndefined();
  });

});


describe('owner panel scoped credentials', () => {
  it('defaults new credentials to explicit full admin scope', async () => {
    await mount();
    expect(view!.root.findByProps({ 'aria-label': 'Key scope' }).props.value).toBe('admin');
    await issue();
    const creation = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!;
    expect(JSON.parse(creation[1].body).scope).toBe('admin');
  });
  it.each([
    { scope: 'submission_review', operation: 'list.submissions', display: 'Submission review only' },
    { scope: 'admin', operation: 'list.categories', display: 'Full admin' },
  ])('issues $scope, labels it, and uses $operation for read and revocation verification', async ({ scope, operation, display }) => {
    await mount(); await label();
    await act(async () => { view!.root.findByProps({ 'aria-label': 'Key scope' }).props.onChange({ target: { value: scope } }); });
    fetchMock.mockResolvedValueOnce(response({ id: credential.id, token: secret, scope }, 201));
    fetchMock.mockResolvedValueOnce(response({ credentials: [{ ...credential, scope }], offset: 0, nextOffset: null }));
    await click(/^Create key$/);
    const creation = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!;
    expect(JSON.parse(creation[1].body).scope).toBe(scope);
    expect(view!.root.findAllByType('p').some(p => text(p) === display)).toBe(true);
    fetchMock.mockResolvedValueOnce(response({ data: [] }));
    await click(/^Test read$/);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ operation, limit: 1 });
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    fetchMock.mockResolvedValueOnce(response({ error: 'Invalid credential' }, 401));
    fetchMock.mockResolvedValueOnce(response({ credentials: [{ ...credential, scope, revoked_at: new Date().toISOString() }], offset: 0, nextOffset: null }));
    await confirmAction('Revoke');
    const reads = fetchMock.mock.calls.filter(c => c[0] === '/api/agent/admin');
    expect(reads).toHaveLength(2);
    expect(JSON.parse(reads[1][1].body)).toEqual({ operation, limit: 1 });
    expect(rendered()).toContain('HTTP 401');
    expect(button(/^Reveal key$/)).toBeUndefined();
  });
  it('preserves a review key scope during rotation even when new-key selector is admin', async () => {
    const reviewKey = { ...credential, scope: 'submission_review' };
    await mount(200, [reviewKey]);
    expect(view!.root.findByProps({ 'aria-label': 'Key scope' }).props.value).toBe('admin');
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    fetchMock.mockResolvedValueOnce(response({ id: 'replacement', token: secret, scope: 'submission_review' }, 201));
    fetchMock.mockResolvedValueOnce(response({ credentials: [{ ...reviewKey, id: 'replacement' }], offset: 0, nextOffset: null }));
    await confirmAction('Rotate');
    const calls = fetchMock.mock.calls.slice(1);
    expect(calls[0][1].method).toBe('DELETE');
    expect(calls[1][1].method).toBe('POST');
    expect(JSON.parse(calls[1][1].body)).toMatchObject({ scope: 'submission_review', adminUserId: credential.owner_id });
    fetchMock.mockResolvedValueOnce(response({ data: [] }));
    await click(/^Test read$/);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ operation: 'list.submissions', limit: 1 });
  });
});
