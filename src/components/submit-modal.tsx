'use client';

import { useState, useEffect, FormEvent } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { Category } from '@/types/database';

interface SubmitArticleModalProps {
  onClose: () => void;
}

type Tab = 'article' | 'handle';

export function SubmitArticleModal({ onClose }: SubmitArticleModalProps) {
  const supabase = createBrowserClient();
  const [tab, setTab] = useState<Tab>('article');

  // Article form state
  const [url, setUrl] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);

  // Handle form state
  const [handle, setHandle] = useState('');

  // Shared state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    supabase
      .from('categories')
      .select('*')
      .order('sort_order')
      .then(({ data }) => {
        if (data) setCategories(data);
      });
  }, []);

  const handleArticleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please enter a URL.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase.from('submissions').insert({
      url: url.trim(),
      category_id: categoryId || null,
      notes: notes.trim() || null,
      status: 'pending',
      submitted_by: (await supabase.auth.getUser()).data.user!.id,
      article_id: null,
      reviewed_by: null,
      reviewed_at: null,
    } as any);

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setSubmitting(false);
  };

  const handleHandleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = handle.trim().replace(/^@/, '');
    if (!cleaned) {
      setError('Please enter your X handle.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await fetch('/api/seed-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: cleaned }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Something went wrong.');
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Submit</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors p-1"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => { setTab('article'); setError(null); setSuccess(false); }}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === 'article'
                ? 'text-white border-b-2 border-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Article
          </button>
          <button
            onClick={() => { setTab('handle'); setError(null); setSuccess(false); }}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === 'handle'
                ? 'text-white border-b-2 border-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Your Profile
          </button>
        </div>

        <div className="p-5">
          {success ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-white mb-1">Thanks!</h3>
              <p className="text-sm text-zinc-400">
                {tab === 'article'
                  ? 'Your submission is being reviewed.'
                  : 'Your handle has been submitted. We\'ll start scanning your articles once approved.'}
              </p>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          ) : tab === 'article' ? (
            <form onSubmit={handleArticleSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Article URL</label>
                <input
                  type="url"
                  placeholder="https://x.com/..."
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  className="w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Category</label>
                <select
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500 transition-colors"
                >
                  <option value="">Select a category</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Notes (optional)</label>
                <textarea
                  placeholder="Why is this article worth featuring?"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-white hover:bg-zinc-200 text-zinc-950 font-medium text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Article'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleHandleSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <p className="text-sm text-zinc-400">
                Submit your X handle and we'll scan your profile for articles.
                Once approved, your articles will automatically appear on Linkdrift.
              </p>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">X Handle</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">@</span>
                  <input
                    type="text"
                    placeholder="yourhandle"
                    value={handle}
                    onChange={e => setHandle(e.target.value.replace(/^@/, ''))}
                    className="w-full pl-7 pr-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
                    required
                    maxLength={50}
                    pattern="[a-zA-Z0-9_]+"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-white hover:bg-zinc-200 text-zinc-950 font-medium text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Handle'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
