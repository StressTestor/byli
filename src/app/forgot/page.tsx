'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase-browser';
import {
  AuthLayout, Field, SubmitButton, AuthMessage,
  MailIcon, ArrowIcon, BackIcon,
} from '@/components/auth/shared';

export default function ForgotPage() {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) { setError('Please enter your email address.'); return; }

    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    router.push(`/auth/confirm?email=${encodeURIComponent(email)}&type=reset`);
  };

  return (
    <AuthLayout>
      <Link
        href="/login"
        className="auth-link"
        style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 24 }}
      >
        <BackIcon /> Back to login
      </Link>

      <h1 className="auth-title">Reset password</h1>
      <p className="auth-subtitle">
        Enter the email associated with your account and
        we'll send a link to reset your password.
      </p>

      {error && <AuthMessage type="error">{error}</AuthMessage>}

      <form onSubmit={handleSubmit}>
        <Field
          label="Email"
          icon={<MailIcon />}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
        />

        <SubmitButton loading={loading}>
          Send reset link <ArrowIcon />
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
