/** Conservative, explainable publication policy. Not a semantic spam detector.
 * The same patterns are embedded in the DB guard and parity-tested in PostgreSQL.
 * News, analysis and defensive headlines are not blanket-blocked for mentioning airdrops.
 */
export type AirdropContent = { title?: string | null; excerpt?: string | null; body_preview?: string | null };
export const AIRDROP_PATTERNS = {
  currentClaimAnnouncement: '^[ ]*(news[ ]*:[ ]*)?((crypto|\\$[a-z][a-z0-9]{1,}) )?air[ -]?drop (claims|claim portal) (is |are )?(now )?(open|live|available)( after (the )?token launch)?[.!]?[ ]*$',
  topic: '(^|[^a-z0-9])air[ -]?drops?([^a-z0-9]|$)',
  crypto: '(^|[^a-z0-9])(crypto|tokens?|wallets?|onchain|on-chain|blockchain|xrpl|xrp|ethereum|eth|bitcoin|btc|solana|defi)([^a-z0-9]|$)|\\$[a-z][a-z0-9]{1,}',
  farming: '(^|[^a-z0-9])(farm|farming|farmer|farmers)([^a-z0-9]|$)',
  promotion: '(^|[^a-z0-9])(claim|claiming|farm|farming|eligible|eligibility|secure (your )?position)([^a-z0-9]|$)|(^|[^a-z0-9])(is|are|now|goes?) (now )?(live|available|open)([^a-z0-9]|$)',
  direct: '(^|[^a-z0-9])(claim (your|now|today|the|free)|how to claim|connect your wallet|check your eligibility|start farming)([^a-z0-9]|$)',
  defensive: '^(warning|beware|scam alert|analysis|news|investigation|report|fake|avoid|do not|don.t|how to (avoid|spot|detect|report))([^a-z0-9]|$)|(^|[^a-z0-9])(air[ -]?drop (scams?|fraud|phishing)|risks of air[ -]?drops?)([^a-z0-9]|$)',
  apple: '(^|[^a-z0-9])(apple|iphone|ipad|macos|ios|bluetooth|file sharing)([^a-z0-9]|$)',
  holder: '(^|[^a-z0-9])(holders?|shareholders?)([^a-z0-9]|$)',
  distribution: '(^|[^a-z0-9])(crates?|allocations?|giveaways?|free tokens?|token distribution)([^a-z0-9]|$)',
  walletCta: '(^|[^a-z0-9])connect your wallet([^a-z0-9]|$)',
  personalClaim: '(^|[^a-z0-9])claim (your|now)([^a-z0-9]|$)',
  freeClaim: '(^|[^a-z0-9])(claim (your )?free tokens?|free token (claim|allocation|giveaway))([^a-z0-9]|$)',
} as const;
function normalize(value: string | null | undefined) { return (value ?? '').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, ''); }
export function isBlockedAirdropContent(content: AirdropContent): boolean {
  const title = normalize(content.title);
  const lead = normalize([content.excerpt, content.body_preview].filter(Boolean).join(' '));
  const all = title + ' ' + lead;
  const matches = (key: keyof typeof AIRDROP_PATTERNS, value: string) => new RegExp(AIRDROP_PATTERNS[key]).test(value);
  // A bare current-availability announcement is not neutral news. An
  // anchored predicate keeps questions, denials, warnings and timing qualifiers out.
  if (matches('currentClaimAnnouncement', title)) return true;
  if (matches('defensive', title)) return false;
  if (matches('apple', title) && !matches('crypto', title)) return false;
  const crypto = matches('crypto', all);
  // Headlines make the topic central; an incidental body mention alone is insufficient.
  if (matches('topic', title) && (crypto || matches('farming', title))) {
    return matches('promotion', title) || matches('direct', lead);
  }
  // Existing-holder token crates are free allocations, not ordinary earned rewards.
  if (crypto && matches('holder', title) && matches('distribution', title)) {
    return matches('promotion', title) || matches('direct', lead);
  }
  if (crypto && matches('topic', lead) && matches('walletCta', lead) && matches('personalClaim', lead)) return true;
  return crypto && matches('freeClaim', title);
}
