import { TITLE_BLOCKLIST } from '@/config/title-blocklist';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Unicode-aware word boundaries: a term only matches when it is not touching
// another letter or digit on either side.
export function buildTitleMatcher(terms: readonly string[]): RegExp | null {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const alternation = cleaned.map(escapeRegex).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'iu');
}

const DEFAULT_MATCHER = buildTitleMatcher(TITLE_BLOCKLIST);

export function isBlockedTitle(
  title: string | null | undefined,
  matcher: RegExp | null = DEFAULT_MATCHER,
): boolean {
  if (!title || !matcher) return false;
  return matcher.test(title.normalize('NFKC'));
}

// Drops whole items whose title is blocklisted. Titles are never rewritten.
export function filterBlockedTitles<T extends { title?: string | null }>(items: T[]): T[] {
  return items.filter((item) => !isBlockedTitle(item.title));
}
