import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '@/api/auth';
import { ApiError } from '@/api/client';
import { AuthShell } from './AuthShell';
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
          <p className="text-sm text-ink-500">
            <Link to="/login" className="font-medium text-signal-600 hover:text-signal-700 transition-colors duration-[120ms]">
              Back to sign in
            </Link>
          </p>
        }
      >
        <p className="text-sm text-ink-600 text-center">
          If <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-800">{email}</code> is registered, you will receive
          a password reset link shortly. Check your spam folder if it does not arrive.
        </p>
        <p className="mt-3 text-sm text-ink-400 text-center">
          In development mode the link is printed to the API logs.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we will send you a reset link."
      footer={
        <p className="text-sm text-ink-500">
          Remembered it?{' '}
          <Link to="/login" className="font-medium text-signal-600 hover:text-signal-700 transition-colors duration-[120ms]">
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" loading={submitting} className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
