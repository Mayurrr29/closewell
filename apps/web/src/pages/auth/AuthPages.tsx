import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { forgotPasswordSchema, loginSchema, passwordSchema, registerSchema } from '@closewell/shared';
import { Logo } from '../../components/Brand';
import { Button, ErrorState, Field, Input, Notice, Spinner } from '../../components/ui';
import { ApiError, api, applyFieldErrors, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';

function Layout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-5 py-10">
      <Logo />
      <main className="mt-10 w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
      </main>
    </div>
  );
}

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/app');

function Login() {
  const { login, status } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const f = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  if (status === 'signed_in') return <Navigate to={safeNext(params.get('next'))} replace />;
  return (
    <Layout title="Sign in" footer={<>New here? <Link className="font-medium text-brand" to="/register">Create an account</Link></>}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={f.handleSubmit(async (v) => {
          setError('');
          try {
            await login(v.email, v.password);
            nav(safeNext(params.get('next')), { replace: true });
          } catch (e) {
            setError(errorMessage(e));
          }
        })}
      >
        {error && <ErrorState error={new Error(error)} />}
        <Field label="Email" error={f.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...f.register('email')} />
        </Field>
        <Field label="Password" error={f.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...f.register('password')} />
        </Field>
        <Button type="submit" loading={f.formState.isSubmitting}>Sign in</Button>
        <Link to="/forgot-password" className="text-sm text-muted underline underline-offset-2">Forgot your password?</Link>
      </form>
    </Layout>
  );
}

function Register() {
  const { register: signUp, status } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const f = useForm<z.input<typeof registerSchema>>({ resolver: zodResolver(registerSchema) });
  if (status === 'signed_in') return <Navigate to={safeNext(params.get('next'))} replace />;
  return (
    <Layout title="Create your account" subtitle="Start a 14-day trial. No card needed." footer={<>Already have an account? <Link className="font-medium text-brand" to="/login">Sign in</Link></>}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={f.handleSubmit(async (v) => {
          setError('');
          try {
            await signUp(v.name, v.email, v.password);
            nav(safeNext(params.get('next')), { replace: true });
          } catch (e) {
            applyFieldErrors(e, f.setError as never);
            setError(errorMessage(e));
          }
        })}
      >
        {error && <ErrorState error={new Error(error)} />}
        <Field label="Your name" error={f.formState.errors.name?.message}>
          <Input autoComplete="name" {...f.register('name')} />
        </Field>
        <Field label="Work email" error={f.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...f.register('email')} />
        </Field>
        <Field label="Password" hint="At least 10 characters, with a letter and a number." error={f.formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...f.register('password')} />
        </Field>
        <Button type="submit" loading={f.formState.isSubmitting}>Create account</Button>
      </form>
    </Layout>
  );
}

function Forgot() {
  const [sent, setSent] = useState('');
  const f = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema) });
  return (
    <Layout title="Reset your password" subtitle="We'll email you a link to choose a new one." footer={<Link className="font-medium text-brand" to="/login">Back to sign in</Link>}>
      {sent ? (
        <Notice tone="pine">{sent}</Notice>
      ) : (
        <form noValidate className="flex flex-col gap-4" onSubmit={f.handleSubmit(async (v) => setSent((await api.post<{ message: string }>('/auth/forgot-password', v)).message))}>
          <Field label="Email" error={f.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...f.register('email')} />
          </Field>
          <Button type="submit" loading={f.formState.isSubmitting}>Send reset link</Button>
        </form>
      )}
    </Layout>
  );
}

const resetForm = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const f = useForm<z.input<typeof resetForm>>({ resolver: zodResolver(resetForm) });
  return (
    <Layout title="Choose a new password" footer={<Link className="font-medium text-brand" to="/login">Back to sign in</Link>}>
      {done ? (
        <Notice tone="pine" title="Password changed">You've been signed out everywhere. <Link to="/login" className="underline">Sign in</Link> with your new password.</Notice>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={f.handleSubmit(async (v) => {
            try {
              await api.post('/auth/reset-password', { token, password: v.password });
              setDone(true);
            } catch (e) {
              setError(errorMessage(e));
            }
          })}
        >
          {!token && <ErrorState error={new Error('This link is missing its token. Open the link from the email again.')} />}
          {error && <ErrorState error={new Error(error)} />}
          <Field label="New password" hint="At least 10 characters, with a letter and a number." error={f.formState.errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...f.register('password')} />
          </Field>
          <Field label="Confirm password" error={f.formState.errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...f.register('confirm')} />
          </Field>
          <Button type="submit" disabled={!token} loading={f.formState.isSubmitting}>Change password</Button>
        </form>
      )}
    </Layout>
  );
}

function Verify() {
  const [params] = useSearchParams();
  const { reload, status } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .post('/auth/verify-email', { token: params.get('token') ?? '' })
      .then(async () => {
        setState('done');
        if (status === 'signed_in') await reload();
      })
      .catch((e) => (setState('error'), setError(errorMessage(e))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Layout title="Verify your email">
      {state === 'working' && <Spinner label="Verifying" />}
      {state === 'done' && <Notice tone="pine" title="Email verified">You can now invite teammates and publish your agent. <Link className="underline" to="/app">Continue to the app</Link></Notice>}
      {state === 'error' && <ErrorState error={new Error(error)} />}
    </Layout>
  );
}

function Invite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { status, user, reload } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState<{ organization: string; role: string; email: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<{ organization: string; role: string; email: string }>(`/invitations/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'This invitation is invalid, expired or already used. Ask for a new one.' : errorMessage(e)));
  }, [token]);
  const next = `/invite?token=${encodeURIComponent(token)}`;
  return (
    <Layout title="Join your team">
      {error && <ErrorState error={new Error(error)} />}
      {!error && !info && <Spinner />}
      {info && (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            You've been invited to <strong>{info.organization}</strong> as <strong>{info.role.replace('_', ' ')}</strong>. The invitation is for <strong>{info.email}</strong>.
          </p>
          {status !== 'signed_in' ? (
            <div className="flex gap-2">
              <Link to={`/register?next=${encodeURIComponent(next)}`} className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink">Create account</Link>
              <Link to={`/login?next=${encodeURIComponent(next)}`} className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium">Sign in</Link>
            </div>
          ) : user?.email !== info.email ? (
            <Notice tone="ochre">You're signed in as {user?.email}. Sign out and sign in as {info.email} to accept.</Notice>
          ) : (
            <Button
              onClick={async () => {
                try {
                  const r = await api.post<{ orgId: string }>('/invitations/accept', { token });
                  await reload();
                  nav(`/app/${r.orgId}`);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Accept invitation
            </Button>
          )}
        </div>
      )}
    </Layout>
  );
}

export default function AuthPages({ page }: { page: 'login' | 'register' | 'forgot' | 'reset' | 'verify' | 'invite' }) {
  return { login: <Login />, register: <Register />, forgot: <Forgot />, reset: <Reset />, verify: <Verify />, invite: <Invite /> }[page];
}
