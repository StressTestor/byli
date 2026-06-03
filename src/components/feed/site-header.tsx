'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/api';
import { SubmitArticleModal } from '@/components/submit-modal';
import { Wordmark } from './wordmark';

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const [showSubmit, setShowSubmit] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-baseline gap-3">
            <Wordmark />
            <span className="hidden text-xs text-zinc-600 sm:inline">where X articles surface</span>
          </div>

          <div className="flex items-center gap-2">
            {loading ? (
              <div className="h-8 w-20 animate-pulse rounded-md bg-zinc-800/50" />
            ) : user ? (
              <>
                <button
                  onClick={() => setShowSubmit(true)}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-white"
                >
                  Submit
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowMenu((v) => !v)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/50"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium uppercase text-zinc-200">
                      {user.email?.[0] || 'U'}
                    </span>
                    <span className="hidden max-w-[120px] truncate text-xs text-zinc-400 sm:inline">{user.email}</span>
                  </button>
                  {showMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                      <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
                        <div className="truncate border-b border-zinc-800 px-3 py-2 text-xs text-zinc-500">{user.email}</div>
                        <button
                          onClick={async () => { await signOut(); setShowMenu(false); }}
                          className="w-full px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
                        >
                          Log out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <Link href="/login" className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-white">
                  Log in
                </Link>
                <Link href="/signup" className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {showSubmit && <SubmitArticleModal onClose={() => setShowSubmit(false)} />}
    </>
  );
}
