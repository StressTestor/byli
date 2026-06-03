import Link from 'next/link';

// Flat "drift" mark — three staggered lines (articles surfacing), in the
// desaturated accent. No gradient, no glow.
function DriftMark({ className = '' }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M2.5 4h9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M2.5 8h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M2.5 12h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({
  href = '/',
  className = '',
}: {
  href?: string | null;
  className?: string;
}) {
  const inner = (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <DriftMark className="text-accent" />
      <span className="font-display text-[1.05rem] font-semibold tracking-tight text-white">
        linkdrift
      </span>
    </span>
  );
  if (href === null) return inner;
  return (
    <Link href={href} className="inline-flex items-center transition-opacity hover:opacity-80">
      {inner}
    </Link>
  );
}
