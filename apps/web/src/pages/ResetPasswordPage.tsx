import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPassword } from '@/api/auth';
import { ApiError } from '@/api/client';
import { AuthShell, AuthError, AUTH_BUTTON, AUTH_INPUT, AUTH_LINK } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Missing token in URL — show a clear error immediately.
  if (!token) {
    return (
      <AuthShell
        title="Invalid reset link"
        footer={
          <p>
            <Link to="/forgot-password" className={AUTH_LINK}>
              Request a new link
            </Link>
          </p>
        }
      >
        <p className="text-sm text-ink-600">
          This reset link is missing its token. Please request a new one.
        </p>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell
        title="Password updated"
        subtitle="You can now sign in with your new password."
        footer={
          <p>
            <Link to="/login" className={AUTH_LINK}>
              Go to sign in
            </Link>
          </p>
        }
      >
        <p className="text-sm text-ink-600">
          Your password has been updated successfully.
        </p>
      </AuthShell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to reset password. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Enter and confirm your new password below."
      footer={
        <p>
          <Link to="/login" className={AUTH_LINK}>
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="New password" htmlFor="new-password" hint="At least 8 characters.">
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            minLength={8}
            maxLength={200}
            className={AUTH_INPUT}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={200}
            className={AUTH_INPUT}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        {error && <AuthError>{error}</AuthError>}
        <Button type="submit" loading={submitting} className={AUTH_BUTTON}>
          Set new password
        </Button>
      </form>
    </AuthShell>
  );
}
