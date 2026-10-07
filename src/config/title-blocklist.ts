// Titles containing any of these terms are skipped at ingestion and hidden from
// the homepage feed, Load more, trending, and the RSS/Atom/JSON feeds.
//
// Matching is case-insensitive and whole-word: "retarded" matches
// "Retarded take", not "retardedness". Add one lowercase term per entry.
export const TITLE_BLOCKLIST: readonly string[] = [
  'retarded',
  // Profanity placeholder: add terms here, e.g. 'example-term',
];
