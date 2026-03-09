'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase-browser';
import { useAdminProfile } from '@/hooks/useAdminProfile';
import type { Submission, Article, HealthCheck, Profile, UserRole } from '@/types/database';

// ─── Admin Log Helper ────────────────────────────────────────

async function logAdminAction(
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, any>
) {
  const supabase = createBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('admin_logs').insert({
    admin_id: user.id,
    action,
    target_type: targetType || null,
    target_id: targetId || null,
    metadata: metadata || null,
    created_at: new Date().toISOString(),
  } as any);
}

// ─── Icons ───────────────────────────────────────────────────

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ─── Tabs ────────────────────────────────────────────────────

const TABS = [
  { key: 'submissions', label: 'Queue' },
  { key: 'articles', label: 'Articles' },
  { key: 'settings', label: 'Settings' },
  { key: 'users', label: 'Users' },
  { key: 'health', label: 'Health' },
] as const;

type TabKey = typeof TABS[number]['key'];

// ─── Submission Queue ────────────────────────────────────────

function SidebarSubmissions() {
  const [submissions, setSubmissions] = useState<(Submission & { category_label?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('submissions')
      .select('*, categories(label)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (data) {
      setSubmissions(data.map((s: any) => ({ ...s, category_label: s.categories?.label })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleApprove = async (sub: Submission) => {
    await (supabase.from('articles') as any).insert({
      x_url: sub.url,
      title: 'Submitted article',
      status: 'published',
      source: 'submission',
      featured: false,
      author_id: sub.submitted_by,
    });
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from('submissions') as any).update({
      status: 'approved',
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', sub.id);
    await logAdminAction('approve_submission', 'submission', sub.id, { url: sub.url });
    fetch();
  };

  const handleReject = async (sub: Submission) => {
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from('submissions') as any).update({
      status: 'rejected',
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', sub.id);
    await logAdminAction('reject_submission', 'submission', sub.id, { url: sub.url });
    fetch();
  };

  if (loading) return <Skeleton count={3} />;
  if (submissions.length === 0) return <Empty text="No pending submissions" />;

  return (
    <div className="space-y-2">
      {submissions.map(sub => (
        <div key={sub.id} className="border border-zinc-800 rounded-lg p-3">
          <a href={sub.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 truncate block">
            {sub.url}
          </a>
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-500">
            {sub.category_label && <span className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-400">{sub.category_label}</span>}
            <span>{new Date(sub.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex gap-1.5 mt-2">
            <button onClick={() => handleApprove(sub)} className="flex-1 px-2 py-1 text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/30 rounded hover:bg-green-500/20 transition-colors">
              Approve
            </button>
            <button onClick={() => handleReject(sub)} className="flex-1 px-2 py-1 text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/30 rounded hover:bg-red-500/20 transition-colors">
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Article Management ──────────────────────────────────────

function SidebarArticles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('articles')
      .select('*')
      .order('indexed_at', { ascending: false })
      .limit(20);
    if (data) setArticles(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const toggleFeatured = async (a: Article) => {
    await (supabase.from('articles') as any).update({ featured: !a.featured }).eq('id', a.id);
    await logAdminAction(a.featured ? 'unfeature_article' : 'feature_article', 'article', a.id, { title: a.title });
    fetch();
  };

  const changeStatus = async (a: Article, status: 'published' | 'archived') => {
    await (supabase.from('articles') as any).update({ status }).eq('id', a.id);
    await logAdminAction('change_article_status', 'article', a.id, { from: a.status, to: status });
    fetch();
  };

  const deleteArticle = async (a: Article) => {
    if (!confirm(`Delete "${a.title}"?`)) return;
    await supabase.from('articles').delete().eq('id', a.id);
    await logAdminAction('delete_article', 'article', a.id, { title: a.title });
    fetch();
  };

  if (loading) return <Skeleton count={4} />;

  return (
    <div className="space-y-2">
      {articles.map(a => (
        <div key={a.id} className="border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <h3 className="text-xs font-medium text-zinc-200 truncate flex-1">{a.title}</h3>
            {a.featured && <span className="px-1 py-0.5 text-[9px] bg-amber-500/10 text-amber-400 rounded flex-shrink-0">Featured</span>}
          </div>
          <p className="text-[10px] text-zinc-500 truncate mb-2">{a.x_url}</p>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => toggleFeatured(a)} className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${a.featured ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'}`}>
              {a.featured ? 'Unfeature' : 'Feature'}
            </button>
            {a.status === 'published' ? (
              <button onClick={() => changeStatus(a, 'archived')} className="px-1.5 py-0.5 text-[10px] border border-zinc-700 text-zinc-400 rounded hover:bg-zinc-800 transition-colors">Archive</button>
            ) : (
              <button onClick={() => changeStatus(a, 'published')} className="px-1.5 py-0.5 text-[10px] border border-green-500/30 text-green-400 rounded hover:bg-green-500/10 transition-colors">Publish</button>
            )}
            <button onClick={() => deleteArticle(a)} className="px-1.5 py-0.5 text-[10px] border border-red-500/30 text-red-400 rounded hover:bg-red-500/10 transition-colors">Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Site Settings ───────────────────────────────────────────

const SETTINGS_KEYS = [
  { key: 'ingestion_enabled', label: 'Ingestion' },
  { key: 'submissions_enabled', label: 'Submissions' },
  { key: 'signup_enabled', label: 'Signups' },
  { key: 'maintenance_mode', label: 'Maintenance' },
];

function SidebarSettings() {
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('site_settings' as any).select('*');
    if (data) {
      const map: Record<string, boolean> = {};
      (data as any[]).forEach(s => { map[s.key] = s.value === 'true' || s.value === '1'; });
      setSettings(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const toggle = async (key: string) => {
    const newValue = !settings[key];
    await supabase.from('site_settings' as any).upsert({ key, value: String(newValue), updated_at: new Date().toISOString() } as any);
    setSettings(prev => ({ ...prev, [key]: newValue }));
    await logAdminAction('toggle_setting', 'site_setting', key, { value: newValue });
  };

  if (loading) return <Skeleton count={4} />;

  return (
    <div className="space-y-1.5">
      {SETTINGS_KEYS.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between border border-zinc-800 rounded-lg px-3 py-2.5">
          <span className="text-xs text-zinc-300">{label}</span>
          <button
            onClick={() => toggle(key)}
            className={`relative w-9 h-5 rounded-full transition-colors ${settings[key] ? 'bg-green-500' : 'bg-zinc-700'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings[key] ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── User Management ─────────────────────────────────────────

function SidebarUsers() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(20);
    if (data) setProfiles(data as Profile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const changeRole = async (p: Profile, newRole: UserRole) => {
    await (supabase.from('profiles') as any).update({ role: newRole }).eq('id', p.id);
    await logAdminAction('change_user_role', 'profile', p.id, { username: p.username, from: p.role, to: newRole });
    fetch();
  };

  const roles: UserRole[] = ['user', 'moderator', 'admin'];

  if (loading) return <Skeleton count={3} />;
  if (profiles.length === 0) return <Empty text="No users" />;

  return (
    <div className="space-y-1.5">
      {profiles.map(p => (
        <div key={p.id} className="flex items-center gap-2 border border-zinc-800 rounded-lg px-3 py-2">
          <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-medium text-white uppercase flex-shrink-0">
            {p.username?.[0] || p.x_handle?.[0] || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-200 truncate">{p.username || p.x_handle || p.id.slice(0, 8)}</div>
          </div>
          <select
            value={p.role || 'user'}
            onChange={e => changeRole(p, e.target.value as UserRole)}
            className="px-1.5 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:outline-none"
          >
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

// ─── Health ──────────────────────────────────────────────────

function SidebarHealth() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.rpc('run_db_health_check' as any);
        if (data) setChecks(Array.isArray(data) ? data : [data]);
      } catch {
        const { data } = await supabase.from('health_checks' as any).select('*').order('checked_at', { ascending: false }).limit(5);
        if (data) setChecks(data as any);
      }
      setLoading(false);
    })();
  }, []);

  const statusColor = (s: string) => {
    if (s === 'healthy') return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (s === 'warning') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  };

  if (loading) return <Skeleton count={3} />;
  if (checks.length === 0) return <Empty text="No health data" />;

  return (
    <div className="grid grid-cols-2 gap-2">
      {checks.map((c, i) => (
        <div key={i} className={`border rounded-lg p-2.5 ${statusColor(c.status)}`}>
          <div className="text-[10px] font-medium uppercase tracking-wider opacity-80">{c.check_name}</div>
          <div className="text-xs font-semibold capitalize mt-0.5">{c.status}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Shared UI ───────────────────────────────────────────────

function Skeleton({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-14 bg-zinc-800/30 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-zinc-500 py-4 text-center">{text}</p>;
}

// ─── Main Sidebar Component ─────────────────────────────────

export default function AdminSidebar() {
  const { loading, isAdmin } = useAdminProfile();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('submissions');

  // Don't render anything for non-admins
  if (loading || !isAdmin) return null;

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-[60] w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all ${
          open
            ? 'bg-zinc-700 text-white rotate-90'
            : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 border border-zinc-700'
        }`}
        aria-label="Toggle admin panel"
      >
        {open ? <CloseIcon /> : <GearIcon />}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[49] transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-zinc-950 border-l border-zinc-800 z-[55] transition-transform duration-200 ease-out flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Admin</span>
            <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 border border-zinc-800 rounded">Panel</span>
          </div>
          <Link
            href="/admin"
            className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => setOpen(false)}
          >
            Full view <ExternalIcon />
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 overflow-x-auto no-scrollbar px-4 pt-3 pb-2 border-b border-zinc-800/50 flex-shrink-0">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {activeTab === 'submissions' && <SidebarSubmissions />}
          {activeTab === 'articles' && <SidebarArticles />}
          {activeTab === 'settings' && <SidebarSettings />}
          {activeTab === 'users' && <SidebarUsers />}
          {activeTab === 'health' && <SidebarHealth />}
        </div>
      </div>
    </>
  );
}
