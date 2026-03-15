import { ImageResponse } from 'next/og';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'edge';
export const alt = 'Linkdrift Article';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: article } = await supabaseAdmin
    .from('articles')
    .select(`
      title, excerpt,
      author:authors(handle, display_name),
      categories:article_categories(category:categories(label))
    `)
    .eq('id', id)
    .eq('status', 'published')
    .single();

  // fallback if article not found
  const title = article?.title || 'Article Not Found';
  const author = (article?.author as any) || { display_name: '', handle: '' };
  const categories = ((article?.categories as any[]) || [])
    .map((ac: any) => ac.category?.label)
    .filter(Boolean);
  const categoryLabel = categories[0] || '';

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
          {categoryLabel && (
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
              {categoryLabel}
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
              fontSize: title.length > 80 ? '36px' : title.length > 50 ? '42px' : '50px',
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
            {title}
          </div>

          {/* Author */}
          {author.display_name && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '20px',
              }}
            >
              <span style={{ color: '#d4d4d8', fontWeight: 500 }}>
                {author.display_name}
              </span>
              <span style={{ color: '#52525b' }}>@{author.handle}</span>
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
    { ...size }
  );
}
