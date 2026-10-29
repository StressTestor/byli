'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import { AuthLayout, CheckIcon, AuthMessage } from '@/components/auth/shared';

function ConfirmContent() {
  const params = useSearchParams();
  const email = params.get('email') || '';
  const type = params.get('type') || 'signup';
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const resendEmail = async () => {
    if (inFlight.current) return;
    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Return to login or signup and enter your email address first.' });
      return;
    }
    if (type !== 'signup' && type !== 'reset') {
      setMessage({ type: 'error', text: 'Unknown email request. Please return to login.' });
      return;
    }
    inFlight.current = true;
    setSending(true);
    setMessage(null);
    try {
      const supabase = createBrowserClient();
      const redirectTo = `${window.location.origin}/auth/confirm`;
      const { error } = type === 'reset'
        ? await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
        : await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo } });
      setMessage(error
        ? { type: 'error', text: error.message }
        : { type: 'success', text: 'Email requested. Check your inbox and spam folder.' });
    } catch {
      setMessage({ type: 'error', text: 'Could not resend the email. Please try again.' });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="check-icon">
        <CheckIcon />
      </div>

      <h1 className="auth-title">Check your email</h1>
      <p className="auth-subtitle">
        {type === 'reset'
          ? 'We sent a password reset link to:'
          : 'We sent a confirmation link to:'}
      </p>

      {email && <p className="check-email">{email}</p>}

      <p className="auth-subtitle" style={{ marginBottom: 0 }}>
        {type === 'reset'
          ? 'Click the link in the email to set a new password. It may take a minute to arrive.'
          : 'Click the link in the email to verify your account and start using Linkdrift.'}
      </p>

      <Link href="/login" className="auth-submit" style={{ marginTop: 28, textDecoration: 'none', textAlign: 'center' }}>
        Back to login
      </Link>

      <div className="auth-footer" style={{ marginTop: 20 }}>
        Didn't receive it?{' '}
        <button type="button" className="auth-link accent" onClick={resendEmail} disabled={sending}>
          {sending ? 'Sending…' : 'Resend email'}
        </button>
      </div>
      {message && <AuthMessage type={message.type}>{message.text}</AuthMessage>}
    </AuthLayout>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<AuthLayout><p style={{ textAlign: 'center', color: '#8B949E' }}>Loading...</p></AuthLayout>}>
      <ConfirmContent />
    </Suspense>
  );
}
