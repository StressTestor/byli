import { safeSubmissionUrl } from '@/lib/submission-input';

export function SubmissionLink({ url, className }: { url: string; className?: string }) {
  const href = safeSubmissionUrl(url);
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{url}</a>
    : <span className={className}>{url}</span>;
}
