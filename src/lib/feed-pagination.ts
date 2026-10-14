// One cursor contract for the server-rendered homepage and GraphQL feed.
// Keep this server-only module out of client imports (Buffer is intentional).
export const FEED_SORTS = ['FOR_YOU', 'LATEST', 'POPULAR'] as const;
export type FeedSort = (typeof FEED_SORTS)[number];
export const MAX_FEED_PAGE_SIZE = 50;
export const FEED_UNAVAILABLE_MESSAGE = 'Could not load articles. Please try again.';

interface LegacyFeedCursor {
  version: 1;
  publishedAt: string;
}
export interface RankedFeedCursor {
  version: 2;
  sort: FeedSort;
  category: string | null;
  asOf: string;
  rank: string;
  publishedAt: string | null;
  id: string;
}
export type FeedCursor = LegacyFeedCursor | RankedFeedCursor;

export class InvalidFeedCursorError extends Error {
  constructor() {
    super('This feed link has expired or is invalid. Refresh the feed and try again.');
    this.name = 'InvalidFeedCursorError';
  }
}

export function feedPageSize(value?: number | null): number {
  if (value == null) return 20;
  if (!Number.isInteger(value) || value < 1) throw new Error('Page size must be a positive integer.');
  return Math.min(value, MAX_FEED_PAGE_SIZE);
}

function isTimestamp(value: unknown): value is string {
  // Preserve PostgreSQL microseconds; Date.toISOString() would truncate them.
  return typeof value === 'string' && value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function encodeLegacyFeedCursor(publishedAt: string | null): string | null {
  return isTimestamp(publishedAt) ? Buffer.from(publishedAt).toString('base64') : null;
}

export function encodeRankedFeedCursor(cursor: RankedFeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeFeedCursor(
  input: string | null | undefined,
  scope: { sort: FeedSort; category: string | null },
): FeedCursor | null {
  if (input == null) return null;
  if (!input || input.length > 2048) throw new InvalidFeedCursorError();
  // Old ISR HTML contains a plain timestamp, while the old API emitted base64.
  // Accept both during deploys so a cached page can still load its next page.
  if (isTimestamp(input)) return { version: 1, publishedAt: input };
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(input)) throw new InvalidFeedCursorError();
  const raw = Buffer.from(input, 'base64').toString('utf8');
  if (isTimestamp(raw)) return { version: 1, publishedAt: raw };
  let cursor: RankedFeedCursor;
  try {
    cursor = JSON.parse(raw);
  } catch {
    throw new InvalidFeedCursorError();
  }
  if (!cursor || cursor.version !== 2 || cursor.sort !== scope.sort ||
      cursor.category !== scope.category || !isTimestamp(cursor.asOf) ||
      !(cursor.publishedAt === null || isTimestamp(cursor.publishedAt)) ||
      typeof cursor.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor.id) ||
      typeof cursor.rank !== 'string' || cursor.rank.length > 128 ||
      !/^-?\d+(?:\.\d+)?$/.test(cursor.rank)) {
    throw new InvalidFeedCursorError();
  }
  return cursor;
}
