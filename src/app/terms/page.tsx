import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Linkdrift terms of service.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center">
          <Link href="/" className="text-xl font-bold tracking-tight text-white hover:text-zinc-300 transition-colors">
            linkdrift
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-white mb-2">terms of service</h1>
        <p className="text-xs text-zinc-600 mb-8">Last updated: March 2026</p>

        <div className="space-y-6 text-sm text-zinc-300 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-2">acceptance</h2>
            <p>
              By using Linkdrift, you agree to these terms. If you do not agree, do not use the
              service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">what linkdrift is</h2>
            <p>
              Linkdrift is a content aggregator that indexes and categorizes long-form articles
              published on X (Twitter). We link to content hosted on X. We do not host the articles
              themselves.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">accounts</h2>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>You must provide accurate information when creating an account</li>
              <li>You are responsible for maintaining the security of your account</li>
              <li>One account per person</li>
              <li>We may suspend or terminate accounts that violate these terms</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">user submissions</h2>
            <p>
              When you submit an article URL, you represent that the content is publicly available
              on X and appropriate for the platform. We review all submissions before publishing.
              We reserve the right to reject any submission.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">content</h2>
            <p>
              All articles displayed on Linkdrift are authored by their respective creators on X.
              Linkdrift does not claim ownership of any article content. We display metadata
              (titles, excerpts) and link to the original source on X.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">prohibited use</h2>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Automated scraping or bulk data collection</li>
              <li>Abusing the API beyond rate limits</li>
              <li>Submitting spam, malicious URLs, or misleading content</li>
              <li>Impersonating other users or authors</li>
              <li>Attempting to circumvent security measures</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">liability</h2>
            <p>
              Linkdrift is provided "as is" without warranty of any kind. We are not liable for the
              content of articles linked from the platform, as they are hosted and authored on X.
              We are not responsible for any damages arising from use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">changes</h2>
            <p>
              We may update these terms at any time. Continued use of Linkdrift after changes
              constitutes acceptance of the new terms.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-600 flex gap-4">
          <Link href="/about" className="hover:text-zinc-400">About</Link>
          <Link href="/privacy" className="hover:text-zinc-400">Privacy</Link>
          <Link href="/" className="hover:text-zinc-400">Home</Link>
        </div>
      </main>
    </div>
  );
}
