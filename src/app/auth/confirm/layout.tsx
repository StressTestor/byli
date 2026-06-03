import type { Metadata } from 'next';

// Thin utility page — keep it out of the index but let crawlers follow links.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function UtilityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
