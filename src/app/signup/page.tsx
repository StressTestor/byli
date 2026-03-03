'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase';
import {
  AuthLayout, Field, XOAuthButton, OrDivider, SubmitButton, AuthMessage,
  PasswordStrength, MailIcon, LockIcon, UserIcon, ArrowIcon,
} from '@/components/auth/shared';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) { setError('All fields are required.'); return; }
    if (username.length < 3) { setError('Username must be at least 3 characters.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }

    setLoading(true);
    setError(null);

    // 1. Create auth user
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        data: { username }, // stored in auth.users.raw_user_meta_data
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // 2. Create profile row (service role handles this via trigger ideally,
    //    but we do it client-side as fallback)
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        username,
      });
    }

    setLoading(false);

    // Supabase sends confirmation email — show verify screen
    router.push(`/auth/confirm?email=${encodeURIComponent(email)}&type=signup`);
  };

  const handleXAuth = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'twitter',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  return (
    <AuthLayout>
      <div className="screen-nav">
        <Link href="/login" className="screen-tab">Log in</Link>
        <button className="screen-tab on">Sign up</button>
      </div>

      <h1 className="auth-title">Create your account</h1>
      <p className="auth-subtitle">Start discovering long-form articles on X</p>

      {error && <AuthMessage type="error">{error}</AuthMessage>}

      <XOAuthButton label="Sign up with X" onClick={handleXAuth} />
      <OrDivider />

      <form onSubmit={handleSubmit}>
        <Field
          label="Username"
          icon={<UserIcon />}
          placeholder="Choose a username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
        />
        <Field
          label="Email"
          icon={<MailIcon />}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
        />
        <Field
          label="Password"
          icon={<LockIcon />}
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <PasswordStrength password={password} />

        <SubmitButton loading={loading}>
          Create account <ArrowIcon />
        </SubmitButton>
      </form>

      <p className="auth-terms">
        By creating an account, you agree to the{' '}
        <a href="/terms">Terms of Service</a> and{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <div className="auth-footer">
        Already have an account?{' '}
        <Link href="/login" className="auth-link accent">Log in</Link>
      </div>
    </AuthLayout>
  );
}
