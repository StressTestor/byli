# Embedded ads: isolation and rollout

## Security boundary

`MoneytagProvider` is a configuration provider only. It never loads a site-wide
MultiTag SDK. Native and banner zone scripts are placed only in the `srcDoc` of
an iframe with exactly `sandbox="allow-scripts"`. The frame has an opaque origin:
there is no `allow-same-origin`, forms, popups, top navigation, downloads or
sandbox-escape permission. Do not add these tokens to recover ad functionality.

`ad-frame.ts` accepts only nonempty ASCII-digit zone strings. It does not trim,
decode or coerce invalid input. Only that validated identifier is inserted into
a fixed HTTPS script URL and a fixed quoted attribute. Empty/invalid zones
render no frame; invalid native zones also omit decorated Sponsored feed cards.
Disabling ads or removing a slot unmounts its frame. Changing a zone replaces
its frame. There is no parent script, vendor load callback or message bridge.

The iframe and initial script use `no-referrer`, with a matching document meta
policy. The iframe explicitly denies camera, microphone, geolocation,
fullscreen, payment, clipboard and sharing capabilities. Slot heights are
contained: native 100px, responsive/leaderboard banner 90px, rectangle 250px;
all widths are capped at the available width. The inner document can scroll
when a creative exceeds those dimensions. No vendor-controlled resize messages
are accepted.

A frame-local CSP is installed before its script. It allows scripts only from
`https://alwingore.com`, inline styles and HTTPS/data images. Other resources
are denied by default; connections, nested frames, form actions and base URLs
are explicitly denied. The existing application response CSP is unchanged and
also applies to `srcDoc`. A child policy cannot relax it. See the
[HTML iframe sandbox specification](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)
and [CSP inheritance rules](https://www.w3.org/TR/CSP/#security-inherit-csp).

This boundary prevents vendor code from directly reading or changing the
parent DOM or using its JavaScript-accessible session/storage. It is not a
complete network-egress boundary: HTTPS images and navigations within the
sandbox may still issue requests. Server-side authorization and CSRF defenses
remain necessary.

## Compatibility and configuration

- `NEXT_PUBLIC_MONETAG_ENABLED=true` enables configured embedded slots.
- `NEXT_PUBLIC_MONETAG_NATIVE_ZONE` and `NEXT_PUBLIC_MONETAG_BANNER_ZONE` must be
  numeric zone identifiers intended for embedded formats.
- `NEXT_PUBLIC_FEED_AD_INTERVAL` retains the existing feed placement behavior.
- `NEXT_PUBLIC_MONETAG_SITE_ID` and `NEXT_PUBLIC_MONETAG_INTERSTITIAL_ZONE` remain
  accepted for configuration compatibility but have no effect.
- `useAds().loaded` is always false because there is no parent SDK load signal.
  An iframe load event would not establish successful vendor ad fill.
- `showInterstitial()` remains an async no-op. `useArticleRedirect()` retains its
  async API and opens the supplied URL immediately with `noopener,noreferrer`.

Global interstitials, popunders and popups are disabled. Navigation to the top
page and opening another tab from an ad are blocked, including user-activated
ad links. Links may navigate only inside the sandbox, where restrictions
remain. Ads requiring top-page access, first-party storage, extra script hosts,
network connections or nested frames may be blank. Larger layouts require
scrolling within the fixed slot.
The current parent CSP can impose additional restrictions. No actual Monetag
creative compatibility or revenue result has been verified. Keep failures
contained; do not fall back to parent execution or relax isolation automatically.

`NEXT_PUBLIC_*` values are build-time configuration. Changing production values
requires the normal rebuild/deploy and a new document load. Client-side route
navigation alone cannot revoke an SDK already executed by a pre-fix deployment.
Previously open tabs must fully reload to adopt this boundary. Removing an old
script tag would not undo its listeners, globals or already executed code.

## Verification

Run with the existing pinned repository dependencies:

```sh
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/vitest run src/components/ads/ad-frame.test.ts src/components/ads/monetag.test.tsx src/components/feed/home-feed.test.tsx
./node_modules/.bin/vitest run
```

The tests render the real provider, native/banner components and redirect hook.
They inspect the exact sandbox, payload, CSP and dimensions; reject malformed
identifiers; exercise enable/disable, route child replacement, zone replacement
and unmount; spy on parent script insertion and interstitial globals; and
preserve normal feed placement and decorated-slot behavior. They do not fetch
or execute vendor code. React renderer assertions verify application output
and lifecycle, not browser enforcement or vendor fill. A browser check using
intercepted synthetic vendor scripts is still recommended in an environment
that supports Chromium; local browser execution was blocked by the available
execution environment during this change.
