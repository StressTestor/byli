// Pure article and ingest utility functions.
// Extracted so they can be tested without Supabase side effects.

// ─── Category Classifier (v1: keyword matching) ─────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  tech: ['ai', 'artificial intelligence', 'machine learning', 'software', 'programming', 'developer', 'code', 'startup', 'saas', 'cloud', 'cybersecurity', 'blockchain', 'crypto', 'gpu', 'data', 'algorithm', 'neural', 'api', 'open source', 'llm', 'model', 'compute'],
  politics: ['election', 'congress', 'senate', 'democracy', 'policy', 'government', 'regulation', 'legislation', 'political', 'vote', 'campaign', 'partisan', 'liberal', 'conservative', 'law', 'supreme court', 'president', 'governor'],
  science: ['research', 'study', 'scientist', 'biology', 'physics', 'chemistry', 'climate', 'space', 'nasa', 'genome', 'crispr', 'evolution', 'quantum', 'experiment', 'peer-reviewed', 'nature', 'mars', 'ocean'],
  business: ['market', 'startup', 'revenue', 'funding', 'investor', 'vc', 'venture', 'ipo', 'stock', 'economy', 'gdp', 'inflation', 'recession', 'profit', 'acquisition', 'merger', 'earnings', 'retail', 'finance'],
  culture: ['film', 'movie', 'music', 'art', 'book', 'entertainment', 'streaming', 'cultural', 'fashion', 'design', 'creative', 'media', 'pop', 'series', 'album', 'exhibition', 'literary', 'theater'],
  sports: ['game', 'player', 'team', 'championship', 'league', 'coach', 'nba', 'nfl', 'mlb', 'soccer', 'football', 'basketball', 'tennis', 'olympic', 'match', 'tournament', 'season', 'score'],
  opinion: ['opinion', 'editorial', 'commentary', 'perspective', 'take', 'argument', 'debate', 'disagree', 'believe', 'think', 'should', 'must', 'ought'],
};

export function classifyArticle(title: string, excerpt: string): string[] {
  const text = `${title} ${excerpt}`.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = keywords.reduce((score, kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      const matches = text.match(regex);
      return score + (matches?.length || 0);
    }, 0);
  }

  return Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([cat]) => cat);
}

// ─── Text Processing ─────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Timeline/search results can identify an Article while carrying only the
// sharing tweet's short link (or no body blocks at all). Keep the teaser, but
// never present that link as an article body or derive a reading time from it.
export function usableArticleBody(contents: unknown, previewText: unknown): string | null {
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > 10000 ||
      contents.some(part => !part || (part.text !== undefined && typeof part.text !== 'string'))) return null;

  const raw = contents.map(part => typeof part.text === 'string' ? part.text : '').join('\n\n');
  if (raw.length > 1_000_000) return null;
  const text = stripHtml(raw);
  const prose = text.replace(/https?:\/\/\S+/gi, ' ').trim();
  const previewLength = typeof previewText === 'string' ? stripHtml(previewText).length : 0;
  if (prose.length < 80 || prose.split(/\s+/).length < 12 ||
      text.length < previewLength || /(?:\.\.\.|…)\s*$/.test(text)) return null;
  return text;
}

// Read-time guard for older rows that were saved before body validation. Keep
// this narrow: short prose, including prose with a link, remains visible.
export function isLinkOnlyArticleText(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const words = stripHtml(value).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(word => {
    const unwrapped = word.replace(/^[([{"'“‘]+|[)\]}"'”’.,;:!?]+$/g, '');
    return /^(?:https?:\/\/|www\.|t\.co\/)\S+$/i.test(unwrapped);
  });
}

export function visibleArticleBodyPreview(body: string | null): string | null {
  return body && !isLinkOnlyArticleText(body) ? body : null;
}

export function articleTeaser(previewText: unknown, body: string | null): string | null {
  const preview = typeof previewText === 'string' ? stripHtml(previewText) : '';
  if (preview && !/^https?:\/\/\S+$/i.test(preview)) return preview;
  return body?.slice(0, 300) || null;
}

export function estimateReadTime(text: string): number {
  const wordCount = text.split(/\s+/).length;
  return Math.max(Math.ceil(wordCount / 250), 2);
}

// ─── Language Detection ─────────────────────────────────────────────

// Article tweets all have lang=zxx (just a URL), so we check the title.
// Require majority Latin characters (covers English + European languages).
export function isEnglishLike(text: string): boolean {
  const stripped = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (stripped.length === 0) return false;
  const latin = stripped.replace(/[^\p{Script=Latin}]/gu, '');
  return latin.length / stripped.length > 0.5;
}
