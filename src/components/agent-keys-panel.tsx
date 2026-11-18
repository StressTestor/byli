'use client';

import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';

type KeyScope = 'admin' | 'submission_review';
type Credential = { scope: KeyScope; id: string; owner_id: string; label: string; expires_at: string; revoked_at: string | null };
type Secret = { id: string; token: string; scope: KeyScope };
const readOperation = (scope: KeyScope) => scope === 'submission_review' ? 'list.submissions' : 'list.categories';
const endpoint = '/api/admin/agent-credentials';
const button = 'px-3 py-1.5 text-xs border border-zinc-700 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-40';

export function AgentKeysPanel() {
  const [allowed, setAllowed] = useState(false);
  const [keys, setKeys] = useState<Credential[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const offsetRef = useRef(0);
  const [label, setLabel] = useState('');
  const [adminUserId, setAdminUserId] = useState('');
  const [pending, setPending] = useState<{ key: Credential; action: 'revoke' | 'rotate' } | null>(null);
  const [scope, setScope] = useState<KeyScope>('admin');
  const [days, setDays] = useState(30);
  const [secret, setSecret] = useState<Secret | null>(null);
  const secretRef = useRef<Secret | null>(null);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const epoch = useRef(0);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  function clearSecret() { secretRef.current = null; setSecret(null); setReveal(false); }
  function showSecret(value: Secret) { secretRef.current = value; setSecret(value); setReveal(false); }

  useEffect(() => {
    let mounted = true;
    async function reset() {
      const generation = ++epoch.current;
      controller.current?.abort();
      const abort = new AbortController(); controller.current = abort;
      locked.current = false; setBusy(false); setAllowed(false); setKeys([]); clearSecret(); setMessage(''); setPending(null); setAdminUserId(''); setLabel(''); setScope('admin'); offsetRef.current = 0; setOffset(0); setNextOffset(null);
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: abort.signal });
        const data = response.ok ? await response.json() : null;
        if (!mounted || generation !== epoch.current) return;
        if (response.ok && Array.isArray(data?.credentials)) { setAllowed(true); setKeys(data.credentials); setNextOffset(typeof data.nextOffset === 'number' ? data.nextOffset : null); }
      } catch { /* Permission is never inferred from a failed check. */ }
    }
    void reset();
    const { data: { subscription } } = createBrowserClient().auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') void reset();
    });
    return () => { mounted = false; epoch.current++; controller.current?.abort(); secretRef.current = null; subscription.unsubscribe(); };
  }, []);

  async function run(action: (generation: number, signal: AbortSignal) => Promise<void>) {
    if (locked.current || !allowed) return;
    locked.current = true; setBusy(true); setMessage(''); setPending(null);
    const generation = epoch.current;
    const abort = new AbortController(); controller.current = abort;
    try { await action(generation, abort.signal); }
    catch {
      if (generation === epoch.current) {
        setMessage('Request interrupted. Check the key list before retrying; a server change may already have completed. Revoke any unwanted key.');
        await refresh(generation, abort.signal).catch(() => {});
      }
    } finally {
      if (generation === epoch.current) { locked.current = false; setBusy(false); }
    }
  }
  async function refresh(generation: number, signal: AbortSignal, page = offsetRef.current) {
    const response = await fetch(page ? `${endpoint}?offset=${page}` : endpoint, { cache: 'no-store', signal });
    const data = response.ok ? await response.json() : null;
    if (generation !== epoch.current) return;
    if (response.status === 403) { setAllowed(false); setKeys([]); clearSecret(); return; }
    if (!response.ok || !Array.isArray(data?.credentials)) throw new Error('List unavailable');
    setKeys(data.credentials); offsetRef.current = page; setOffset(page); setNextOffset(typeof data.nextOffset === 'number' ? data.nextOffset : null);
  }
  async function issue(generation: number, signal: AbortSignal, old?: Credential) {
    clearSecret();
    const requestedScope = old ? old.scope ?? 'admin' : scope;
    try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ label: old?.label ?? label.trim(), expiresInDays: days, scope: requestedScope, ...(old ? { adminUserId: old.owner_id } : adminUserId.trim() ? { adminUserId: adminUserId.trim() } : {}) }) });
    const data = await response.json();
    if (generation !== epoch.current) return;
    if (!response.ok || typeof data.token !== 'string' || typeof data.id !== 'string') {
      setMessage(old ? 'Old key revoked. Replacement issuance failed; access remains interrupted. Refresh before retrying.' : 'Key issuance failed. Refresh the list before retrying.');
      if (response.status === 403) { setAllowed(false); setKeys([]); }
      else await refresh(generation, signal, 0).catch(() => {});
      return;
    }
    showSecret({ id: data.id, token: data.token, scope: requestedScope });
    setMessage(old ? 'Old key revoked. Replacement created; reveal it once and save it securely.' : 'Key created. Reveal it once and save it securely.');
    await refresh(generation, signal, 0).catch(() => {
      if (generation === epoch.current) setMessage('Key created, but the list refresh failed. Save the new key securely and refresh the list.');
    });
    } catch {
      if (generation === epoch.current) {
        setMessage(old ? 'Old key revoked. Replacement issuance is unconfirmed. Check the refreshed list and revoke any unwanted key before retrying.' : 'Key issuance is unconfirmed. Check the refreshed list and revoke any unwanted key before retrying.');
        await refresh(generation, signal, 0).catch(() => {});
      }
    }
  }
  async function revoke(key: Credential, generation: number, signal: AbortSignal, rotating = false) {
    const held = secretRef.current?.id === key.id ? secretRef.current : null;
    const response = await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key.id }), signal });
    if (generation !== epoch.current) return false;
    if (!response.ok) { setMessage('Revocation failed or is unconfirmed. No replacement was issued.'); if (response.status === 403) { clearSecret(); setAllowed(false); setKeys([]); } return false; }
    if (held) {
      try {
        const test = await fetch('/api/agent/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${held.token}` }, body: JSON.stringify({ operation: readOperation(held.scope), limit: 1 }), signal });
        if (generation !== epoch.current) return false;
        setMessage(test.status === 401 ? 'Key revoked. Read test confirmed HTTP 401.' : `Key revoked; verification returned HTTP ${test.status}, not the expected 401. No replacement issued. Investigate before relying on revocation.`);
        if (test.status !== 401) { await refresh(generation, signal); return false; }
      } catch {
        if (generation === epoch.current) {
          setMessage('Key revoked; read verification is unavailable. No replacement issued. Check the list before retrying.');
          await refresh(generation, signal).catch(() => {});
        }
        return false;
      } finally { if (generation === epoch.current) clearSecret(); }
    } else setMessage('Key revoked.');
    if (!rotating) await refresh(generation, signal);
    return true;
  }
  if (!allowed) return null;
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold text-white">Agent keys</h2>
    <p className="text-sm text-zinc-400">Owner-managed application keys. Keys cannot manage keys or grant or revoke admin roles. Plaintext is shown only once and is never saved in this browser.</p>
    <div className="flex flex-wrap gap-3 items-end border border-zinc-800 rounded-lg p-4">
      <label className="text-xs text-zinc-400">Label<input aria-label="Key label" value={label} maxLength={80} disabled={busy} onChange={e => setLabel(e.target.value)} className="block mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white" /></label>
      <label className="text-xs text-zinc-400">Associated admin UUID (optional)<input aria-label="Associated admin UUID" placeholder="Defaults to owner" value={adminUserId} maxLength={36} disabled={busy} onChange={e => setAdminUserId(e.target.value)} className="block mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white" /></label>
      <label className="text-xs text-zinc-400">Scope<select aria-label="Key scope" value={scope} disabled={busy} onChange={e => setScope(e.target.value as KeyScope)} className="block mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"><option value="admin">Full admin</option><option value="submission_review">Submission review only</option></select></label>
      <label className="text-xs text-zinc-400">Expires in days<input aria-label="Expires in days" type="number" min={1} max={90} value={days} disabled={busy} onChange={e => setDays(Number(e.target.value))} className="block mt-1 w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white" /></label>
      <button className={button} disabled={busy || !label.trim() || (Boolean(adminUserId.trim()) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminUserId.trim())) || !Number.isInteger(days) || days < 1 || days > 90} onClick={() => void run((g, s) => issue(g, s))}>Create key</button>
      <button className={button} disabled={busy} onClick={() => void run(refresh)}>Refresh list</button>
    </div>
    <p className="text-xs text-zinc-500">Submission review keys can list, approve, and reject submissions only. Rotation preserves the old key’s scope and associated admin.</p>
    {message && <p role="status" className="text-sm text-zinc-300">{message}</p>}
    {secret && <div className="space-y-3 border border-zinc-700 rounded-lg p-4">
      <p className="text-sm text-zinc-400">New key ready. Dismissing or leaving this tab removes its plaintext from this page.</p>
      {reveal && <code className="block break-all text-xs text-white select-all">{secret.token}</code>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => reveal ? clearSecret() : setReveal(true)}>{reveal ? 'Dismiss key permanently' : 'Reveal key'}</button>
        <button className={button} disabled={busy} onClick={() => void run(async (g, signal) => {
          const value = secretRef.current; if (!value) return;
          const response = await fetch('/api/agent/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value.token}` }, body: JSON.stringify({ operation: readOperation(value.scope), limit: 1 }), signal });
          if (g === epoch.current) { setMessage(`Read test returned HTTP ${response.status}. No application content was changed. Audit logs record this read; returned data was not displayed.`); if (response.status === 401 || response.status === 403) clearSecret(); }
        })}>Test read</button>
        <button className={button} disabled={busy} onClick={clearSecret}>Dismiss key</button>
      </div>
    </div>}
    {pending && <div className="border border-amber-700/50 rounded-lg p-4 space-y-3">
      <p className="text-sm text-amber-200">{pending.action === 'rotate' ? 'The old key is revoked FIRST. Access stops until you install its replacement. If issuance fails, the old key remains revoked.' : 'Revoke this key? Its agent will lose access immediately.'}</p>
      <p className="text-xs text-zinc-400">{pending.key.label}</p>
      <div className="flex gap-2">
        <button className={button} disabled={busy} onClick={() => {
          const selected = pending;
          void run(async (g, signal) => {
            if (await revoke(selected.key, g, signal, selected.action === 'rotate') && selected.action === 'rotate' && g === epoch.current) {
              try { await issue(g, signal, selected.key); }
              catch { if (g === epoch.current) { setMessage('Old key revoked. Replacement issuance is unconfirmed; access may remain interrupted. Check the refreshed list and revoke any unwanted key before retrying.'); await refresh(g, signal).catch(() => {}); } }
            }
          });
        }}>{pending.action === 'rotate' ? 'Confirm rotation' : 'Confirm revoke'}</button>
        <button className={button} disabled={busy} onClick={() => setPending(null)}>Cancel</button>
      </div>
    </div>}
    <div className="space-y-2">{keys.map(key => <div key={key.id} className="border border-zinc-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm text-white">{key.label}</p><p className="text-xs text-zinc-400">{key.scope === 'submission_review' ? 'Submission review only' : 'Full admin'}</p><p className="text-xs text-zinc-500 break-all">Admin: {key.owner_id}</p><p className="text-xs text-zinc-500">{key.revoked_at ? 'Revoked' : new Date(key.expires_at).getTime() <= Date.now() ? 'Expired' : 'Active'} · Expires {new Date(key.expires_at).toLocaleString()}</p></div>
      {!key.revoked_at && <div className="flex gap-2">
        <button className={button} disabled={busy} onClick={() => setPending({ key, action: 'revoke' })}>Revoke</button>
        <button className={button} disabled={busy || !Number.isInteger(days) || days < 1 || days > 90} onClick={() => setPending({ key, action: 'rotate' })}>Rotate</button>
      </div>}
    </div>)}</div>
    <div className="flex items-center gap-3">
      <button className={button} disabled={busy || offset === 0} onClick={() => void run((g, s) => refresh(g, s, Math.max(0, offset - 100)))}>Newer keys</button>
      <span className="text-xs text-zinc-500">Page {Math.floor(offset / 100) + 1}</span>
      <button className={button} disabled={busy || nextOffset === null} onClick={() => { if (nextOffset !== null) void run((g, s) => refresh(g, s, nextOffset)); }}>Older keys</button>
    </div>
    {keys.length === 0 && <p className="text-sm text-zinc-500">No keys found.</p>}
  </section>;
}
