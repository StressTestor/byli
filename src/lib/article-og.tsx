import { ImageResponse } from 'next/og';
import { unstable_cache } from 'next/cache';

export type ArticleOgSource = { title: string; authorName: string; authorHandle: string; categoryLabel: string };
// Bump whenever layout, fonts, dimensions, or renderer/dependency versions change.
const RENDER_VERSION = 'article-og-node-next14.2.35-v1';
const MAX_CACHEABLE_PNG_BYTES = 1024 * 1024;
class UncacheableImage extends Error {
  constructor(public readonly bytes: Buffer) { super('Rendered image exceeds cache budget'); }
}
export async function renderArticleOg(source: ArticleOgSource): Promise<Buffer> {
  const response = createImage(source);
  return Buffer.from(await response.arrayBuffer());
}

// No publication/auth data is cached here. The caller must independently check
// current publication on every request before choosing these display fields.
export async function getArticleOgBytes(source: ArticleOgSource): Promise<Buffer> {
  let rendered: Buffer | undefined;
  let renderAttempted = false;
  const cached = unstable_cache(async (fields: ArticleOgSource) => {
    renderAttempted = true;
    rendered = await renderArticleOg(fields);
    // Base64 expands bytes by 4/3; 1MiB leaves room beneath Next's 2MiB
    // serialized-entry limit. Throwing prevents cache storage without rerendering.
    if (rendered.byteLength > MAX_CACHEABLE_PNG_BYTES) throw new UncacheableImage(rendered);
    return rendered.toString('base64');
  }, [RENDER_VERSION], { revalidate: false });
  try {
    const encoded = await cached(source);
    return Buffer.from(encoded, 'base64');
  } catch (error) {
    if (error instanceof UncacheableImage) return error.bytes;
    // Cache failure after rendering reuses the bytes. A read failure renders
    // directly once. Never recursively re-enter the failed cache backend.
    if (rendered) return rendered;
    if (renderAttempted) throw error;
    return renderArticleOg(source);
  }
}
function createImage(source: ArticleOgSource) {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#09090b',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Top: category badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {source.categoryLabel && (
            <div
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#a1a1aa',
                background: '#27272a',
                padding: '6px 16px',
                borderRadius: '9999px',
                letterSpacing: '0.5px',
              }}
            >
              {source.categoryLabel}
            </div>
          )}
        </div>

        {/* Middle: title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: source.title.length > 80 ? '36px' : source.title.length > 50 ? '42px' : '50px',
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.2,
              letterSpacing: '-0.5px',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {source.title}
          </div>

          {/* Author */}
          {source.authorName && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '20px',
              }}
            >
              <span style={{ color: '#d4d4d8', fontWeight: 500 }}>
                {source.authorName}
              </span>
              <span style={{ color: '#52525b' }}>@{source.authorHandle}</span>
            </div>
          )}
        </div>

        {/* Bottom: branding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: '#ffffff',
                color: '#09090b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                fontWeight: 700,
              }}
            >
              L
            </div>
            <span
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: '#a1a1aa',
                letterSpacing: '-0.5px',
              }}
            >
              linkdrift
            </span>
          </div>
          <span style={{ fontSize: '16px', color: '#52525b' }}>linkdrift.app</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
