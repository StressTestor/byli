-- Replace only the existing pure classifier; its ACL, trigger and all rows stay intact.
CREATE OR REPLACE FUNCTION public.is_blocked_airdrop_content(p_title text, p_excerpt text, p_body_preview text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $function$
DECLARE
  title_text text := regexp_replace(lower(normalize(coalesce(p_title, ''), NFKC)), U&'[\200B-\200D\FEFF]', '', 'g');
  lead_text text := regexp_replace(lower(normalize(coalesce(p_excerpt, '') || ' ' || coalesce(p_body_preview, ''), NFKC)), U&'[\200B-\200D\FEFF]', '', 'g');
  all_text text;
  crypto boolean;
BEGIN
  all_text := title_text || ' ' || lead_text;
  IF (title_text ~ $pattern$^[ ]*(news[ ]*:[ ]*)?((crypto|\$[a-z][a-z0-9]{1,}) )?air[ -]?drop (claims|claim portal) (is |are )?(now )?(open|live|available)( after (the )?token launch)?[.!]?[ ]*$$pattern$) THEN RETURN true; END IF;
  IF (title_text ~ $pattern$^(warning|beware|scam alert|analysis|news|investigation|report|fake|avoid|do not|don.t|how to (avoid|spot|detect|report))([^a-z0-9]|$)|(^|[^a-z0-9])(air[ -]?drop (scams?|fraud|phishing)|risks of air[ -]?drops?)([^a-z0-9]|$)$pattern$) THEN RETURN false; END IF;
  IF (title_text ~ $pattern$(^|[^a-z0-9])(apple|iphone|ipad|macos|ios|bluetooth|file sharing)([^a-z0-9]|$)$pattern$) AND NOT (title_text ~ $pattern$(^|[^a-z0-9])(crypto|tokens?|wallets?|onchain|on-chain|blockchain|xrpl|xrp|ethereum|eth|bitcoin|btc|solana|defi)([^a-z0-9]|$)|\$[a-z][a-z0-9]{1,}$pattern$) THEN RETURN false; END IF;
  crypto := (all_text ~ $pattern$(^|[^a-z0-9])(crypto|tokens?|wallets?|onchain|on-chain|blockchain|xrpl|xrp|ethereum|eth|bitcoin|btc|solana|defi)([^a-z0-9]|$)|\$[a-z][a-z0-9]{1,}$pattern$);
  IF (title_text ~ $pattern$(^|[^a-z0-9])air[ -]?drops?([^a-z0-9]|$)$pattern$) AND (crypto OR (title_text ~ $pattern$(^|[^a-z0-9])(farm|farming|farmer|farmers)([^a-z0-9]|$)$pattern$)) THEN
    RETURN (title_text ~ $pattern$(^|[^a-z0-9])(claim|claiming|farm|farming|eligible|eligibility|secure (your )?position)([^a-z0-9]|$)|(^|[^a-z0-9])(is|are|now|goes?) (now )?(live|available|open)([^a-z0-9]|$)$pattern$) OR (lead_text ~ $pattern$(^|[^a-z0-9])(claim (your|now|today|the|free)|how to claim|connect your wallet|check your eligibility|start farming)([^a-z0-9]|$)$pattern$);
  END IF;
  IF crypto AND (title_text ~ $pattern$(^|[^a-z0-9])(holders?|shareholders?)([^a-z0-9]|$)$pattern$) AND (title_text ~ $pattern$(^|[^a-z0-9])(crates?|allocations?|giveaways?|free tokens?|token distribution)([^a-z0-9]|$)$pattern$) THEN
    RETURN (title_text ~ $pattern$(^|[^a-z0-9])(claim|claiming|farm|farming|eligible|eligibility|secure (your )?position)([^a-z0-9]|$)|(^|[^a-z0-9])(is|are|now|goes?) (now )?(live|available|open)([^a-z0-9]|$)$pattern$) OR (lead_text ~ $pattern$(^|[^a-z0-9])(claim (your|now|today|the|free)|how to claim|connect your wallet|check your eligibility|start farming)([^a-z0-9]|$)$pattern$);
  END IF;
  IF crypto AND (lead_text ~ $pattern$(^|[^a-z0-9])air[ -]?drops?([^a-z0-9]|$)$pattern$)
    AND (lead_text ~ $pattern$(^|[^a-z0-9])connect your wallet([^a-z0-9]|$)$pattern$)
    AND (lead_text ~ $pattern$(^|[^a-z0-9])claim (your|now)([^a-z0-9]|$)$pattern$) THEN RETURN true; END IF;
  RETURN crypto AND (title_text ~ $pattern$(^|[^a-z0-9])(claim (your )?free tokens?|free token (claim|allocation|giveaway))([^a-z0-9]|$)$pattern$);
END;
$function$;
