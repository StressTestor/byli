import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Linkdrift - Where X Articles Surface';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#09090b',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '12px',
              background: '#ffffff',
              color: '#09090b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              fontWeight: 700,
            }}
          >
            L
          </div>
          <span
            style={{
              fontSize: '48px',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-1px',
            }}
          >
            linkdrift
          </span>
        </div>
        <div
          style={{
            fontSize: '22px',
            color: '#a1a1aa',
            maxWidth: '600px',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          where X Articles surface
        </div>
        <div
          style={{
            fontSize: '16px',
            color: '#52525b',
            marginTop: '16px',
          }}
        >
          linkdrift.app
        </div>
      </div>
    ),
    { ...size }
  );
}
