'use client';

import { useState, ReactNode } from 'react';

// ─── Field ───────────────────────────────────────────────────

interface FieldProps {
  label?: string;
  icon: ReactNode;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  autoComplete?: string;
}

export function Field({ label, icon, type = 'text', placeholder, value, onChange, error, autoComplete }: FieldProps) {
  const [show, setShow] = useState(false);
  const isPw = type === 'password';

  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}
      <div className="field-wrap">
        <input
          className={`field-input ${error ? 'err' : ''}`}
          type={isPw && show ? 'text' : type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete || (isPw ? 'current-password' : type === 'email' ? 'email' : 'off')}
        />
        <span className="field-icon">{icon}</span>
        {isPw && value && (
          <button
            className="field-toggle"
            onClick={() => setShow(!show)}
            type="button"
            tabIndex={-1}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Password Strength ───────────────────────────────────────

export function getPasswordStrength(pw: string) {
  if (!pw) return { score: 0, label: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score: s, label: labels[s] };
}

export function PasswordStrength({ password }: { password: string }) {
  const { score, label } = getPasswordStrength(password);
  if (!password) return null;
  return (
    <>
      <div className="pw-strength">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={`pw-bar ${score >= i ? `s${score}` : ''}`} />
        ))}
      </div>
      <div className="pw-label">{label}</div>
    </>
  );
}

// ─── Message ─────────────────────────────────────────────────

export function AuthMessage({ type, children }: { type: 'error' | 'success'; children: ReactNode }) {
  return (
    <div className={`auth-msg ${type}`}>
      {type === 'error' ? <AlertIcon /> : <CheckIcon />}
      <span>{children}</span>
    </div>
  );
}

// ─── Auth Layout ─────────────────────────────────────────────

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-container">
        <div className="auth-logo">
          <div className="auth-logo-mark">B</div>
          <span className="auth-logo-text">Byline</span>
        </div>
        <div className="auth-card">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── X OAuth Button ──────────────────────────────────────────

export function XOAuthButton({ label = 'Continue with X', onClick }: { label?: string; onClick: () => void }) {
  return (
    <button className="oauth-btn" onClick={onClick} type="button">
      <XIcon /> {label}
    </button>
  );
}

// ─── Submit Button ───────────────────────────────────────────

export function SubmitButton({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <button className="auth-submit" type="submit" disabled={loading}>
      {loading ? <span className="spin"><SpinnerIcon /></span> : children}
    </button>
  );
}

// ─── Divider ─────────────────────────────────────────────────

export function OrDivider() {
  return (
    <div className="divider"><span className="divider-text">or</span></div>
  );
}

// ─── Icons ───────────────────────────────────────────────────

export function XIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
}
export function MailIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>;
}
export function LockIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
}
export function UserIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
export function ArrowIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
}
export function BackIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
}
export function EyeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
}
export function EyeOffIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
}
export function SpinnerIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>;
}
export function AlertIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
export function CheckIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
}
