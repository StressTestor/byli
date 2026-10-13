// Extract the numeric tweet id from an x.com / twitter.com status URL.
// Returns null for anything that is not a /status/<id> link on X.
export function extractTweetId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www\.|mobile\.)/, '');
  if (host !== 'x.com' && host !== 'twitter.com') return null;
  const m = parsed.pathname.match(/\/status(?:es)?\/(\d{5,25})(?:\/|$)/);
  return m ? m[1] : null;
}
