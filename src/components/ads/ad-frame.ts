/** Fixed frame-local policy; the parent response CSP still applies as well. */
export const AD_FRAME_CSP = [
  "default-src 'none'",
  'script-src https://alwingore.com',
  "style-src 'unsafe-inline'",
  'img-src https: data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export const AD_FRAME_PERMISSIONS = [
  "camera 'none'", "microphone 'none'", "geolocation 'none'", "fullscreen 'none'",
  "payment 'none'", "clipboard-read 'none'", "clipboard-write 'none'", "web-share 'none'",
].join('; ');

export function isAdZone(zone: unknown): zone is string {
  // Do not trim, decode or coerce configuration into a different identifier.
  // Checking every character also rejects trailing newlines (unlike a $ anchor).
  return typeof zone === 'string' && zone.length > 0 && !/[^0-9]/.test(zone);
}

export function buildAdFrameDocument(zone: unknown): string | null {
  if (!isAdZone(zone)) return null;

  // The only variable HTML is an ASCII-digits-only identifier. Never interpolate
  // arbitrary attributes, URLs, site IDs or vendor markup into this document.
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${AD_FRAME_CSP}">
<meta name="referrer" content="no-referrer">
<style>html,body{margin:0;padding:0;width:100%;min-height:100%}html{overflow:auto}</style>
</head><body>
<div data-zone="${zone}"><script async data-cfasync="false" referrerpolicy="no-referrer" src="https://alwingore.com/js/zone/${zone}.js"></script></div>
</body></html>`;
}
