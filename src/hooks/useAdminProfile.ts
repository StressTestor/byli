'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import { useAuth } from '@/hooks/api';
import type { Profile } from '@/types/database';

export function useAdminProfile() {
  const { user, loading: authLoading } = useAuth();
  const [result, setResult] = useState<{ userId: string; profile: Profile | null } | null>(null);
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    if (authLoading || !userId) {
      setResult(null);
      return () => { active = false; };
    }
    const supabase = createBrowserClient();
    Promise.resolve(supabase.from('profiles').select('*').eq('id', userId).single())
      .then(({ data }) => {
        if (active) setResult({ userId, profile: data?.id === userId ? data as Profile : null });
      })
      .catch(() => {
        if (active) setResult({ userId, profile: null });
      });
    return () => { active = false; };
  }, [userId, authLoading]);

  // Bind results to their session before rendering, not only after the effect
  // runs. A previous admin result must never authorize a different session UI.
  const profile = !authLoading && userId && result && result.userId === userId ? result.profile : null;
  const loading = authLoading || Boolean(userId && result?.userId !== userId);
  return { user, profile, loading, isAdmin: profile?.role === 'admin' };
}
