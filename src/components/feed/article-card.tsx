import Link from 'next/link';
import Image from 'next/image';
import type { FeedArticle } from '@/lib/home-feed';
import { timeAgo, formatCount } from '@/lib/format';

function VerifiedCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="text-sky-400/90 shrink-0" aria-label="verified">
      <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

/**
 * Refined article card. A real <a> (keyboard-accessible) to the internal
 * /article/[id] page — not an onClick that window.open()s to x.com. The
 * headline is the focal point (Geist display); the teaser is the post's own
 * short attributed snippet. Hover lifts a hair and warms the border to the
 * accent — flat, no glow.
 */
export function ArticleCard({ article }: { article: FeedArticle }) {
  const hasCover = !!article.coverImageUrl;
  return (
    <Link
      href={`/article/${article.id}`}
      className="group block rounded-xl border border-zinc-800/70 bg-zinc-900/20 p-5 transition-[border-color,transform,background-color] duration-200 hover:-translate-y-px hover:border-accent/40 hover:bg-zinc-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <article className="flex gap-4">
        <div className="min-w-0 flex-1">
          {article.featured && (
            <div className="mb-2 inline-flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-amber-400/80">
              <svg width="11" height="11" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Featured
            </div>
          )}

          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
            <span className="font-medium text-zinc-400 transition-colors group-hover:text-accent">
              @{article.authorHandle}
            </span>
            {article.authorVerified && <VerifiedCheck />}
            {article.readTimeMin ? (
              <>
                <span aria-hidden="true" className="text-zinc-700">·</span>
                <span>{article.readTimeMin} min</span>
              </>
            ) : null}
            {article.publishedAt && (
              <>
                <span aria-hidden="true" className="text-zinc-700">·</span>
                <time dateTime={article.publishedAt}>{timeAgo(article.publishedAt)}</time>
              </>
            )}
          </div>

          <h2 className="font-display text-[17px] font-semibold leading-snug text-zinc-100 transition-colors group-hover:text-white [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {article.title}
          </h2>

          {article.excerpt && (
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
              {article.excerpt}
            </p>
          )}

          <div className="mt-3 flex items-center gap-4 text-xs text-zinc-600">
            <span className="inline-flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              {formatCount(article.likeCount)}
            </span>
            <span className="inline-flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              {formatCount(article.bookmarkCount)}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-zinc-600 transition-colors group-hover:text-accent">
              Read
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </div>

        {hasCover && (
          <div className="relative hidden h-[88px] w-[120px] shrink-0 overflow-hidden rounded-lg border border-zinc-800/60 sm:block">
            <Image
              src={article.coverImageUrl as string}
              alt=""
              fill
              sizes="120px"
              className="object-cover"
            />
          </div>
        )}
      </article>
    </Link>
  );
}
