// Shared by browser submission, the API, and moderation link rendering.
export const MAX_SUBMISSION_URL_LENGTH = 2048;
export const MAX_SUBMISSION_NOTES_LENGTH = 2000;

export function safeSubmissionUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_SUBMISSION_URL_LENGTH ||
      /[\s\u0000-\u001f\u007f\\]/.test(value) ||
      !/^https:\/\/(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.href.length > MAX_SUBMISSION_URL_LENGTH) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function validSubmissionNotes(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.length <= MAX_SUBMISSION_NOTES_LENGTH);
}
