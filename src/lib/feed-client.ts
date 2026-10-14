// Browser-safe helpers shared by both feed clients.
export const FEED_LOAD_ERROR = 'Could not load articles. Please try again.';

export function appendUniqueArticles<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((article) => article.id));
  return [...current, ...incoming.filter((article) => {
    if (seen.has(article.id)) return false;
    seen.add(article.id);
    return true;
  })];
}

export interface FeedConnection {
  edges: { node: any; cursor?: string; score?: number }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export function readFeedConnection(value: any): FeedConnection {
  if (!value || !Array.isArray(value.edges) ||
      !value.edges.every((edge: any) => edge?.node && typeof edge.node.id === 'string') ||
      typeof value.pageInfo?.hasNextPage !== 'boolean' ||
      !(value.pageInfo.endCursor === null || typeof value.pageInfo.endCursor === 'string') ||
      (value.pageInfo.hasNextPage && !value.pageInfo.endCursor)) {
    throw new Error(FEED_LOAD_ERROR);
  }
  return value;
}
