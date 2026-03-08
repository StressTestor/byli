'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase-browser';
import { useAuth } from '@/hooks/api';
import type { Profile, Submission, Article, SiteSetting, HealthCheck, UserRole } from '@/types/database';

// ─── Admin Guard ─────────────────────────────────────────────

function useAdminProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }

    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setProfile(data as Profile | null);
        setLoading(false);
      });
  }, [user, authLoading]);

  return { user, profile, loading: authLoading || loading, isAdmin: profile?.role === 'admin' };
}

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

// ─── System Health Section ───────────────────────────────────

function SystemHealth() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const runCheck = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc('run_db_health_check' as any);
      if (data) {
        setChecks(Array.isArray(data) ? data : [data]);
      }
    } catch {
      // Fallback: fetch latest from health_checks table
      const { data } = await supabase
        .from('health_checks' as any)
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(10);
      if (data) setChecks(data as any);
    }
    setLoading(false);
  }, []);

  useEffect(() => { runCheck(); }, [runCheck]);

  const statusColor = (status: string) => {
    if (status === 'healthy') return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (status === 'warning') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">System Health</h2>
        <button
          onClick={runCheck}
          disabled={loading}
          className="text-xs text-zinc-400 hover:text-white px-3 py-1.5 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>
      {loading && checks.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-zinc-800/30 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : checks.length === 0 ? (
        <p className="text-sm text-zinc-500">No health check data available. Run the health check RPC to populate.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {checks.map((check, i) => (
            <div
              key={i}
              className={`border rounded-lg p-4 ${statusColor(check.status)}`}
            >
              <div className="text-xs font-medium uppercase tracking-wider mb-1 opacity-80">
                {check.check_name}
              </div>
              <div className="text-sm font-semibold capitalize">{check.status}</div>
              {check.message && (
                <div className="text-xs mt-1 opacity-70">{check.message}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Submission Queue ────────────────────────────────────────

function SubmissionQueue() {
  const [submissions, setSubmissions] = useState<(Submission & { category_label?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('submissions')
      .select('*, categories(label)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (data) {
      setSubmissions(data.map((s: any) => ({
        ...s,
        category_label: s.categories?.label,
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  const handleApprove = async (submission: Submission) => {
    // Create article from submission
    const { data: article } = await (supabase
      .from('articles') as any)
      .insert({
        x_url: submission.url,
        title: `Submitted article`,
        status: 'published',
        source: 'submission',
        featured: false,
        author_id: submission.submitted_by,
      })
      .select('id')
      .single();

    // Update submission
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from('submissions') as any)
      .update({
        status: 'approved',
        article_id: article?.id || null,
        reviewed_by: user?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', submission.id);

    await logAdminAction('approve_submission', 'submission', submission.id, { url: submission.url });
    fetchSubmissions();
  };

  const handleReject = async (submission: Submission) => {
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from('submissions') as any)
      .update({
        status: 'rejected',
        reviewed_by: user?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', submission.id);

    await logAdminAction('reject_submission', 'submission', submission.id, { url: submission.url });
    fetchSubmissions();
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Submission Queue</h2>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-zinc-800/30 rounded-lg animate-pulse" />)}
        </div>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-zinc-500 py-4">No pending submissions.</p>
      ) : (
        <div className="space-y-2">
          {submissions.map(sub => (
            <div key={sub.id} className="border border-zinc-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <a
                  href={sub.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 truncate block"
                >
                  {sub.url}
                </a>
                <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                  {sub.category_label && (
                    <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">{sub.category_label}</span>
                  )}
                  <span>{new Date(sub.created_at).toLocaleDateString()}</span>
                  {sub.notes && <span className="truncate max-w-[200px]">— {sub.notes}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleApprove(sub)}
                  className="px-3 py-1.5 text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReject(sub)}
                  className="px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Article Management ──────────────────────────────────────

function ArticleManagement() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('articles')
      .select('*')
      .order('indexed_at', { ascending: false })
      .limit(50);
    if (data) setArticles(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const toggleFeatured = async (article: Article) => {
    await (supabase.from('articles') as any).update({ featured: !article.featured }).eq('id', article.id);
    await logAdminAction(article.featured ? 'unfeature_article' : 'feature_article', 'article', article.id, { title: article.title });
    fetchArticles();
  };

  const changeStatus = async (article: Article, status: 'published' | 'archived') => {
    await (supabase.from('articles') as any).update({ status }).eq('id', article.id);
    await logAdminAction('change_article_status', 'article', article.id, { from: article.status, to: status });
    fetchArticles();
  };

  const deleteArticle = async (article: Article) => {
    if (!confirm(`Delete "${article.title}"? This cannot be undone.`)) return;
    await supabase.from('articles').delete().eq('id', article.id);
    await logAdminAction('delete_article', 'article', article.id, { title: article.title });
    fetchArticles();
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Article Management</h2>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-zinc-800/30 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map(article => (
            <div key={article.id} className="border border-zinc-800 rounded-lg p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-zinc-200 truncate">{article.title}</h3>
                    {article.featured && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/10 text-amber-400 rounded">Featured</span>
                    )}
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                      article.status === 'published' ? 'bg-green-500/10 text-green-400' :
                      article.status === 'archived' ? 'bg-zinc-500/10 text-zinc-400' :
                      'bg-yellow-500/10 text-yellow-400'
                    }`}>{article.status}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 truncate">{article.x_url}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                  <button
                    onClick={() => toggleFeatured(article)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      article.featured
                        ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10'
                        : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    {article.featured ? 'Unfeature' : 'Feature'}
                  </button>
                  {article.status === 'published' ? (
                    <button
                      onClick={() => changeStatus(article, 'archived')}
                      className="px-2 py-1 text-xs border border-zinc-700 text-zinc-400 rounded hover:bg-zinc-800 transition-colors"
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      onClick={() => changeStatus(article, 'published')}
                      className="px-2 py-1 text-xs border border-green-500/30 text-green-400 rounded hover:bg-green-500/10 transition-colors"
                    >
                      Publish
                    </button>
                  )}
                  <button
                    onClick={() => deleteArticle(article)}
                    className="px-2 py-1 text-xs border border-red-500/30 text-red-400 rounded hover:bg-red-500/10 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Site Settings ───────────────────────────────────────────

const SETTINGS_KEYS = [
  { key: 'ingestion_enabled', label: 'Article Ingestion', description: 'Automatically ingest new articles from X' },
  { key: 'submissions_enabled', label: 'User Submissions', description: 'Allow users to submit articles' },
  { key: 'signup_enabled', label: 'User Signups', description: 'Allow new user registrations' },
  { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Show maintenance page to visitors' },
];

function SiteSettings() {
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('site_settings' as any)
      .select('*');
    if (data) {
      const map: Record<string, boolean> = {};
      (data as any[]).forEach(s => {
        map[s.key] = s.value === 'true' || s.value === '1';
      });
      setSettings(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const toggleSetting = async (key: string) => {
    const newValue = !settings[key];
    await supabase
      .from('site_settings' as any)
      .upsert({ key, value: String(newValue), updated_at: new Date().toISOString() } as any);
    setSettings(prev => ({ ...prev, [key]: newValue }));
    await logAdminAction('toggle_setting', 'site_setting', key, { value: newValue });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Site Settings</h2>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-zinc-800/30 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {SETTINGS_KEYS.map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between border border-zinc-800 rounded-lg p-4">
              <div>
                <div className="text-sm font-medium text-zinc-200">{label}</div>
                <div className="text-xs text-zinc-500">{description}</div>
              </div>
              <button
                onClick={() => toggleSetting(key)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  settings[key] ? 'bg-green-500' : 'bg-zinc-700'
                }`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  settings[key] ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── User Management ─────────────────────────────────────────

function UserManagement() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setProfiles(data as Profile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  const changeRole = async (profile: Profile, newRole: UserRole) => {
    await (supabase.from('profiles') as any).update({ role: newRole }).eq('id', profile.id);
    await logAdminAction('change_user_role', 'profile', profile.id, {
      username: profile.username,
      from: profile.role,
      to: newRole,
    });
    fetchProfiles();
  };

  const roles: UserRole[] = ['user', 'moderator', 'admin'];

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">User Management</h2>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 bg-zinc-800/30 rounded-lg animate-pulse" />)}
        </div>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-zinc-500">No users found.</p>
      ) : (
        <div className="space-y-2">
          {profiles.map(profile => (
            <div key={profile.id} className="flex flex-col sm:flex-row sm:items-center gap-3 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium text-white uppercase flex-shrink-0">
                  {profile.username?.[0] || profile.x_handle?.[0] || '?'}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">
                    {profile.username || profile.x_handle || profile.id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {profile.x_handle ? `@${profile.x_handle}` : profile.id.slice(0, 12)}
                    <span className="mx-1">·</span>
                    Joined {new Date(profile.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <select
                value={profile.role || 'user'}
                onChange={e => changeRole(profile, e.target.value as UserRole)}
                className="px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 focus:outline-none focus:border-zinc-500"
              >
                {roles.map(role => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Health Check History ────────────────────────────────────

function HealthCheckHistory() {
  const [history, setHistory] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('health_checks' as any)
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(10);
      if (data) setHistory(data as any);
      setLoading(false);
    })();
  }, []);

  const statusColor = (status: string) => {
    if (status === 'healthy') return 'text-green-400';
    if (status === 'warning') return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Health Check History</h2>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 bg-zinc-800/30 rounded-lg animate-pulse" />)}
        </div>
      ) : history.length === 0 ? (
        <p className="text-sm text-zinc-500 py-4">No health check history available.</p>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left">
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Check</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider hidden sm:table-cell">Message</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((check, i) => (
                <tr key={check.id || i} className="border-b border-zinc-800/50 last:border-0">
                  <td className="px-4 py-3 text-zinc-300">{check.check_name}</td>
                  <td className={`px-4 py-3 font-medium capitalize ${statusColor(check.status)}`}>{check.status}</td>
                  <td className="px-4 py-3 text-zinc-500 hidden sm:table-cell truncate max-w-[200px]">{check.message || '-'}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {new Date(check.checked_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Admin Tabs ──────────────────────────────────────────────

const TABS = [
  { key: 'health', label: 'Health' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'articles', label: 'Articles' },
  { key: 'settings', label: 'Settings' },
  { key: 'users', label: 'Users' },
  { key: 'history', label: 'History' },
] as const;

type TabKey = typeof TABS[number]['key'];

// ─── Admin Page ──────────────────────────────────────────────

export default function AdminPage() {
  const { user, profile, loading, isAdmin } = useAdminProfile();
  const [activeTab, setActiveTab] = useState<TabKey>('health');

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-sm text-zinc-500 mb-4">Please log in to access the admin dashboard.</p>
          <Link href="/login" className="text-sm text-blue-400 hover:text-blue-300">Go to Login</Link>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-sm text-zinc-500 mb-4">You need admin privileges to access this page.</p>
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">Go Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Admin Header */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xl font-bold tracking-tight text-white hover:text-zinc-300 transition-colors">
              linkdrift
            </Link>
            <span className="text-xs text-zinc-600 px-2 py-0.5 border border-zinc-800 rounded">Admin</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-medium text-white uppercase">
              {profile?.username?.[0] || user.email?.[0] || 'A'}
            </div>
            <span className="hidden sm:inline">{profile?.username || user.email}</span>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Tab Navigation */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar mb-6 border-b border-zinc-800 pb-px">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap transition-colors relative ${
                activeTab === tab.key
                  ? 'text-white font-medium'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'health' && <SystemHealth />}
        {activeTab === 'submissions' && <SubmissionQueue />}
        {activeTab === 'articles' && <ArticleManagement />}
        {activeTab === 'settings' && <SiteSettings />}
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'history' && <HealthCheckHistory />}
      </div>
    </div>
  );
}
