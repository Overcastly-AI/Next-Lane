import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '@/api/auth';
import { ApiError } from '@/api/client';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';

export function ResetPasswordPage() {
  const navigate = useNavigate();
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
          <p className="text-sm text-gray-500">
            <Link to="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
              Request a new link
            </Link>
          </p>
        }
      >
        <p className="text-sm text-gray-600 text-center">
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
          <p className="text-sm text-gray-500">
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
              Go to sign in
            </Link>
          </p>
        }
      >
        <p className="text-sm text-gray-600 text-center">
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
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      setSuccess(true);
      // Redirect to login after a brief pause so the success message renders.
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 2_000);
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
        <p className="text-sm text-gray-500">
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="New password" htmlFor="new-password" hint="At least 6 characters.">
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
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
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" loading={submitting} className="w-full">
          Set new password
        </Button>
      </form>
    </AuthShell>
  );
}
