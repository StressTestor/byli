'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/format';

export function ArticleTime({ publishedAt }: { publishedAt: string }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  // ISR HTML can be older than the browser's clock, and its server timezone
  // may differ. The first render must not depend on either runtime setting.
  // After hydration, retain the existing relative/local display behavior.
  const label = hydrated ? timeAgo(publishedAt) : new Date(publishedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  return <time dateTime={publishedAt}>{label}</time>;
}
