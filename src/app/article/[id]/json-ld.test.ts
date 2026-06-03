import { describe, it, expect } from 'vitest';
import { serializeJsonLd } from './json-ld';

describe('serializeJsonLd', () => {
  it('does not emit a literal </script> for a malicious title', () => {
    const out = serializeJsonLd({
      headline: '</script><script>alert(1)</script>',
    });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c');
  });

  it('escapes <, >, and & as unicode escapes', () => {
    const out = serializeJsonLd({ v: '<a & b>' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
    expect(out).toContain('\\u0026');
  });

  it('round-trips back to the original object', () => {
    const obj = { headline: '</script>', nested: { a: 1, b: '<&>' } };
    expect(JSON.parse(serializeJsonLd(obj))).toEqual(obj);
  });
});
