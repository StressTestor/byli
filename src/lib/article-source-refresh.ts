import { stripHtml, estimateReadTime } from './ingest-utils';
import { isBlockedTitle } from './title-filter';
import { extractTweetId } from './tweet-id';

// No provenance snapshot exists yet. Only the first update of an untouched,
// automatically imported, published row is eligible. Timestamp equality is a
// conservative heuristic, not proof: same-transaction edits can retain equality.
// Never treat this as sync or use it for known manually managed content.
export interface RefreshableArticle {
  id: string;
  x_article_id: string | null;
  x_url: string;
  author_id: string;
  author: { x_user_id: string } | null;
  source: string;
  status: string;
  featured: boolean;
  indexed_at: string | null;
  updated_at: string | null;
  title: string;
  excerpt: string | null;
  body_preview: string | null;
  read_time_min: number | null;
}

export function sourceRefreshPatch(row: RefreshableArticle, input: {
  tweetId: string; tweetUrl: string; authorId: string;
  article: { title: string; preview_text: string; contents: Array<{ text: string }> };
}) {
  if (row.source !== 'twitterapi' || row.status !== 'published' || row.featured !== false ||
      !row.indexed_at || !row.updated_at || row.indexed_at !== row.updated_at ||
      !Number.isFinite(Date.parse(row.indexed_at)) ||
      row.x_article_id !== input.tweetId || row.x_url !== input.tweetUrl ||
      extractTweetId(row.x_url) !== input.tweetId ||
      !input.authorId || row.author?.x_user_id !== input.authorId) return null;

  const article = input.article;
  if (typeof article?.title !== 'string' || !article.title.trim() || article.title.length > 1000 ||
      isBlockedTitle(article.title) || typeof article.preview_text !== 'string' ||
      !Array.isArray(article.contents) || article.contents.length === 0 || article.contents.length > 10000 ||
      article.contents.some(part => typeof part?.text !== 'string')) return null;
  const raw = article.contents.map(part => part.text).join('\n\n');
  if (raw.length > 1_000_000) return null;
  const text = stripHtml(raw).trim();
  // Do not replace a stored preview with an empty, obviously cut off, or shorter
  // response. Upstream payload completeness cannot be proven without a version API.
  if (text.length < 80 || text.length < (row.body_preview?.length ?? 0) ||
      /(?:\.\.\.|…)\s*$/.test(text) || /(?:\.\.\.|…)\s*$/.test(article.title) ||
      /^(?:error|unavailable|not found|access denied|deleted)\b/i.test(article.title.trim())) return null;
  const readTime = estimateReadTime(text);
  if (row.read_time_min != null && readTime < row.read_time_min) return null;
  const patch = {
    title: article.title,
    excerpt: article.preview_text.trim() || text.slice(0, 300),
    body_preview: text.slice(0, 500),
    read_time_min: readTime,
  };
  if (patch.excerpt.length > 10000 ||
      Object.entries(patch).every(([key, value]) => row[key as keyof RefreshableArticle] === value)) return null;
  return patch;
}
