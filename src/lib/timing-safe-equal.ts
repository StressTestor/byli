import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison.
 *
 * Used to compare the cron `Authorization` header against the expected
 * `Bearer ${CRON_SECRET}` value. A plain `!==` short-circuits on the first
 * differing byte, leaking the secret one character at a time via response
 * timing. `crypto.timingSafeEqual` compares the full buffers regardless of
 * where they diverge.
 *
 * Inputs are coerced from possibly-null values (header may be missing) before
 * buffering — `Buffer.from(null)` throws. The length guard is required because
 * `timingSafeEqual` throws on unequal-length buffers; comparing lengths first
 * leaks only the length, not the content.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const bufA = Buffer.from(a ?? '', 'utf8');
  const bufB = Buffer.from(b ?? '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
