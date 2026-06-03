# refined dark — design spec

decided 2026-06-03. the visual + content direction for linkdrift, built to read as deliberately human-designed (not "AI generated a dark theme") ahead of a sale.

## direction

dark, premium-minimal, one accent. keep the existing zinc-950 base and the asymmetric feed+sidebar layout (it already dodges the centered-hero / 3-column AI-template look). elevate through type, spacing, and restraint — not decoration.

## the anti-slop rules (hard constraints)

researched from designer/dev commentary (r/web_design, r/webdev, etc.) on what instantly reads as AI-made. the root cause is convergence on training-data defaults — Tailwind's `bg-indigo-500` (its creator publicly apologized for it in Aug 2025) and Inter-by-default.

| rule | why |
|---|---|
| **no gradients.** flat color fills only. no gradient backgrounds, no gradient text, no gradient buttons. | violet/blue gradients are the #1 AI tell |
| **accent is flat + desaturated ~25%.** indigo used sparingly — wordmark mark, active state, links/hover, focus rings. never a fill-the-hero move. | saturated violet optically vibrates on dark + screams default |
| **glow is rationed.** at most one purposeful accent glow per viewport. emphasis comes from type/contrast/spacing, not box-shadow on everything. | undifferentiated glow-on-dark = default "cool" AI look |
| **real type pairing.** Geist (display) for wordmark + headlines, Inter for body/meta. not Inter-alone. | Inter-by-default with no pairing is a tell |
| **intentional radius + shadow.** don't default every element to the same rounded corner + 0.1-opacity shadow. | the literal AI-template checklist |
| **plain copy in joe's voice.** no "empower", "leverage", "seamless", "robust", "unlock", "not just X — it's Y". specific + concrete. | buzzword filler reads as machine-written |

## visual system

- **palette:** base `zinc-950`; surfaces `zinc-900/zinc-800`; hairline borders `zinc-800/60`. accent = indigo, **desaturated ~25%** (not raw `#6366f1` — a muted indigo, e.g. ~`#6b6bd6`/tuned), flat. semantic blue check stays (X semantics); amber stays only for Featured.
- **type:** Geist (self-hosted via `next/font`) for wordmark + headings; Inter for body + meta. real scale: headline `text-lg`+ semibold tight leading = focal point; meta small + muted.
- **wordmark:** "linkdrift" in Geist + a small flat geometric indigo mark (no glow).
- **cards:** muted author/meta row → big headline → one attributed teaser line → stats (accent on hover). optional cover thumbnail via `next/image`. generous padding; hover = subtle indigo border (no glow), tiny lift.
- **sidebar:** trending numbered, accent on rank/hover.

## structural rebuild (folded into the polish — same surface)

the homepage stops being a client-only shell:

- `src/app/page.tsx` → server component that renders the first ~20 articles in real HTML with internal `<Link href="/article/[id]">` (closes audit P1-1 SSR, P1-2 internal links, P1-12 keyboard a11y in one move).
- interactivity (Header/auth, category + sort tabs, Load-more, TrendingSidebar) → small `'use client'` island components hydrating over the server HTML.
- `export const revalidate = 900` (ISR), explicit self-canonical on `/`.
- shared `<Wordmark>` + `<ArticleCard>` components so article/author/category/search inherit the refreshed look.
- cards link to the internal `/article/[id]` page (better dwell + the ad interstitial), not straight out to x.com.

## IP-safe content model (decided: teaser-only)

content is scraped via twitterapi.io and not licensed, so:

- **ingest change:** `excerpt = article.preview_text` only (X's own intended teaser). **drop the `|| cleanText.slice(0,300)` body-slice fallback.** if `preview_text` is absent, no excerpt (or a future LinkDrift-authored blurb).
- **cap** displayed excerpt to ~140 chars, always with `@handle` attribution + outbound link to x.com.
- **re-derive existing rows:** existing excerpts may be body-derived; re-ingest / backfill so no stored excerpt is a body slice.
- **article pages:** with teaser-only, they're IP-safe even if indexed. noindex is now a *SEO* choice, not legal. default: keep `noindex,follow` (thin-content avoidance, concentrate ranking on curation pages) + drop article URLs from the sitemap for coherence. revisit if/when articles get original LinkDrift value-add.
- **rankable surface = curation pages** (home/category/author/topic), self-canonical, built on LinkDrift's own text (titles as teasers, category/author framing, ratings, future blurbs).

## explicitly OUT of scope here

programmatic hub build-out (topic/tag/archive pages), the full original-content layer (AI summaries / why-it-matters), and the type-the-Supabase-clients refactor — separate tracks on the roadmap.

---
*spec for the refined-dark polish + homepage SSR rebuild. decisions captured from the 2026-06-03 brainstorm.*
