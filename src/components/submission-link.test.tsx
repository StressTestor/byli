import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { SubmissionLink } from './submission-link';

describe('moderation links', () => {
  it.each(['javascript:alert(1)//x.com', 'https://x.com.evil.test/', 'data:text/html,<script>alert(1)</script>'])('renders legacy unsafe URL only as escaped text: %s', url => {
    const html = renderToStaticMarkup(<SubmissionLink url={url} />);
    expect(html).toMatch(/^<span>/);
    expect(html).not.toContain('href=');
    expect(html).not.toContain('<script>');
  });
  it('keeps valid links opening safely in a new tab', () => {
    const html = renderToStaticMarkup(<SubmissionLink url="https://x.com/i/article/123" />);
    expect(html).toContain('href="https://x.com/i/article/123"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('uses the guarded component in both moderation surfaces', () => {
    for (const file of ['src/app/admin/page.tsx', 'src/components/admin-sidebar.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('<SubmissionLink url={sub.url}');
      expect(source).not.toContain('href={sub.url}');
    }
  });
});
