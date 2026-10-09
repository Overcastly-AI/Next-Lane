import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '@/api/auth';
import { ApiError } from '@/api/client';
import { AuthShell, AuthError, AUTH_BUTTON, AUTH_INPUT, AUTH_LINK } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="A reset link has been sent if that address is registered."
        footer={
          <p>
            <Link to="/login" className={AUTH_LINK}>
              Back to sign in
            </Link>
          </p>
        }
      >
        <p className="text-sm text-ink-600">
          If <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-800">{email}</code> is registered, you will receive
          a password reset link shortly. Check your spam folder if it does not arrive.
        </p>
        {/* Self-hosters without SMTP read the link from the API log; that
            hint is meaningless (and confusing) in a production build. */}
        {import.meta.env.DEV && (
          <p className="mt-3 text-sm text-ink-600">
            In development mode the link is printed to the API logs.
          </p>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we will send you a reset link."
      footer={
        <p>
          Remembered it?{' '}
          <Link to="/login" className={AUTH_LINK}>
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            className={AUTH_INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        {error && <AuthError>{error}</AuthError>}
        <Button type="submit" loading={submitting} className={AUTH_BUTTON}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
