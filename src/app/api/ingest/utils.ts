// Pure utility functions for the ingest route.
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

export function estimateReadTime(text: string): number {
  const wordCount = text.split(/\s+/).length;
  return Math.max(Math.ceil(wordCount / 250), 2);
}
