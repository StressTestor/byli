'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase-browser';
import {
  AuthLayout, Field, GitHubOAuthButton, OrDivider, SubmitButton, AuthMessage,
  MailIcon, LockIcon, ArrowIcon,
} from '@/components/auth/shared';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('All fields are required.'); return; }

    setLoading(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message === 'Invalid login credentials'
        ? 'Invalid email or password. Please try again.'
        : authError.message);
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  };

  const handleGitHubAuth = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  return (
    <AuthLayout>
      <div className="screen-nav">
        <button className="screen-tab on">Log in</button>
        <Link href="/signup" className="screen-tab">Sign up</Link>
      </div>

      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-subtitle">Sign in to your Linkdrift account</p>

      {error && <AuthMessage type="error">{error}</AuthMessage>}

      <GitHubOAuthButton onClick={handleGitHubAuth} />
      <OrDivider />

      <form onSubmit={handleSubmit}>
        <Field
          label="Email"
          icon={<MailIcon />}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
          name="email"
          required
        />
        <Field
          label="Password"
          icon={<LockIcon />}
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={setPassword}
          name="password"
          required
          minLength={8}
        />

        <div className="forgot-row">
          <Link href="/forgot" className="auth-link">Forgot password?</Link>
        </div>

        <SubmitButton loading={loading}>
          Log in <ArrowIcon />
        </SubmitButton>
      </form>

      <div className="auth-footer">
        New to Linkdrift?{' '}
        <Link href="/signup" className="auth-link accent">Create an account</Link>
      </div>
    </AuthLayout>
  );
}
