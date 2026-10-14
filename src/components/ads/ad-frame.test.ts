import { describe, expect, it } from 'vitest';
import { AD_FRAME_CSP, buildAdFrameDocument, isAdZone } from './ad-frame';

describe('ad frame document boundary', () => {
  it.each([undefined, null, 202, {}, [], true, '', '202\n', '2\u20283', '2\0', '1e3', '-1',
    'javascript:alert(1)', 'https://evil.test/zone', '//evil.test', '1/../../site/2',
    '1#fragment', '1?query', '1" onload="alert(1)', "1'", '1&amp;2', '２０２', '%32%30%32'])('rejects %j without coercion or HTML', (zone) => {
    expect(isAdZone(zone)).toBe(false);
    expect(buildAdFrameDocument(zone)).toBeNull();
  });

  it.each(['1', '202', '000202', '9007199254740993'])('preserves numeric-string zone %s without number coercion', (zone) => {
    const doc = buildAdFrameDocument(zone)!;
    expect(doc).toContain(`data-zone="${zone}"`);
    expect(doc).toContain(`src="https://alwingore.com/js/zone/${zone}.js"`);
    expect(doc.match(/<script\b/g)).toHaveLength(1);
    expect(doc).not.toContain('onload=');
    expect(doc).not.toContain('<base');
  });

  it('installs a restrictive policy before any vendor resource', () => {
    const doc = buildAdFrameDocument('202')!;
    expect(doc.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(doc.indexOf('<script'));
    expect(AD_FRAME_CSP.split('; ')).toEqual([
      "default-src 'none'", 'script-src https://alwingore.com', "style-src 'unsafe-inline'",
      'img-src https: data:', "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
    ]);
  });

  it('permits scrolling inside fixed-size frames for taller or wider creatives', () => {
    const doc = buildAdFrameDocument('202')!;
    expect(doc).toContain('html{overflow:auto}');
    expect(doc).not.toContain('overflow:hidden');
    expect(doc).not.toContain('overflow:clip');
  });
});
