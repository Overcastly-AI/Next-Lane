import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { register } from '@/api/auth';
import { ApiError } from '@/api/client';
import { qk } from '@/api/keys';
import { AuthShell, AuthError, AUTH_BUTTON, AUTH_INPUT, AUTH_LINK } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';

// Mirrors the API's RegisterDto (apps/api/src/auth/dto/auth.dto.ts) so the
// user gets a human message before a round trip, not class-validator text.
const NAME_MIN = 2;
const NAME_MAX = 80;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;

interface FieldErrors {
  name?: string;
  password?: string;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const errors: FieldErrors = {};
    if (name.trim().length < NAME_MIN) {
      errors.name = `Enter your name (at least ${NAME_MIN} characters).`;
    }
    if (password.length < PASSWORD_MIN) {
      errors.password = `Use at least ${PASSWORD_MIN} characters for your password.`;
    }
    setFieldErrors(errors);
    if (errors.name || errors.password) return;

    setSubmitting(true);
    try {
      const res = await register({ name: name.trim(), email, password });
      qc.setQueryData(qk.me, res.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to create your account. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Get started with Next Lane"
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/login" className={AUTH_LINK}>
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name" htmlFor="name" error={fieldErrors.name}>
          <Input
            id="name"
            required
            autoFocus
            autoComplete="name"
            maxLength={NAME_MAX}
            aria-invalid={fieldErrors.name ? true : undefined}
            className={AUTH_INPUT}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
          />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            maxLength={EMAIL_MAX}
            className={AUTH_INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          error={fieldErrors.password}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={PASSWORD_MAX}
            aria-invalid={fieldErrors.password ? true : undefined}
            className={AUTH_INPUT}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        {error && <AuthError>{error}</AuthError>}
        <Button type="submit" loading={submitting} className={AUTH_BUTTON}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
