import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Linkdrift privacy policy. How we handle your data.',
};

export default function PrivacyPage() {
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
        <h1 className="text-2xl font-bold text-white mb-2">privacy policy</h1>
        <p className="text-xs text-zinc-600 mb-8">Last updated: March 2026</p>

        <div className="space-y-6 text-sm text-zinc-300 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-2">what we collect</h2>
            <p>
              When you create an account, we collect your email address and username. If you sign in
              with X (Twitter), we also receive your public profile information (handle, display name,
              avatar) from X's OAuth flow.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">how we use it</h2>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Account authentication and session management</li>
              <li>Displaying your profile information within the app</li>
              <li>Sending transactional emails (password resets, confirmations)</li>
              <li>Linking your X identity to claimed author profiles</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">cookies</h2>
            <p>
              We use essential cookies to maintain your login session. We do not use tracking cookies
              or share cookie data with third parties. Our ad provider (Monetag) may use cookies for
              ad delivery and measurement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">data storage</h2>
            <p>
              Your data is stored securely on Supabase (hosted on AWS). We do not sell, rent, or
              share your personal data with third parties, except as required by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">third-party services</h2>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Supabase (database and authentication)</li>
              <li>Vercel (hosting and analytics)</li>
              <li>Monetag (advertising)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">your rights</h2>
            <p>
              You can delete your account at any time, which removes your profile and associated
              data. For data export or deletion requests, contact us through X.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">changes</h2>
            <p>
              We may update this policy from time to time. Changes will be reflected on this page
              with an updated date.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-600 flex gap-4">
          <Link href="/about" className="hover:text-zinc-400">About</Link>
          <Link href="/terms" className="hover:text-zinc-400">Terms</Link>
          <Link href="/" className="hover:text-zinc-400">Home</Link>
        </div>
      </main>
    </div>
  );
}
