'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthLayout, CheckIcon } from '@/components/auth/shared';

function ConfirmContent() {
  const params = useSearchParams();
  const email = params.get('email') || '';
  const type = params.get('type') || 'signup';

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
          : 'Click the link in the email to verify your account and start using Byline.'}
      </p>

      <Link href="/login" className="auth-submit" style={{ marginTop: 28, textDecoration: 'none', textAlign: 'center' }}>
        Back to login
      </Link>

      <div className="auth-footer" style={{ marginTop: 20 }}>
        Didn't receive it?{' '}
        <button className="auth-link accent">Resend email</button>
      </div>
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
