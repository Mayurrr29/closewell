import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router';
import { ApiError } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { Spinner, ToastProvider } from './components/ui';
import '@fontsource-variable/schibsted-grotesk/wght.css';
import '@fontsource-variable/schibsted-grotesk/wght-italic.css';
import './styles.css';

const Home = lazy(() => import('./pages/marketing/Home'));
const Auth = lazy(() => import('./pages/auth/AuthPages'));
const AppShell = lazy(() => import('./components/AppShell'));
const NewOrg = lazy(() => import('./pages/app/NewOrg'));
const Onboarding = lazy(() => import('./pages/app/Onboarding'));
const Dashboard = lazy(() => import('./pages/app/Dashboard'));
const Inbox = lazy(() => import('./pages/app/Inbox'));
const Leads = lazy(() => import('./pages/app/Leads'));
const LeadDetail = lazy(() => import('./pages/app/LeadDetail'));
const Products = lazy(() => import('./pages/app/Products'));
const Knowledge = lazy(() => import('./pages/app/Knowledge'));
const AgentPage = lazy(() => import('./pages/app/Agent'));
const Approvals = lazy(() => import('./pages/app/Approvals'));
const WidgetPage = lazy(() => import('./pages/app/Widget'));
const Team = lazy(() => import('./pages/app/Team'));
const Settings = lazy(() => import('./pages/app/Settings'));
const Billing = lazy(() => import('./pages/app/Billing'));
const Audit = lazy(() => import('./pages/app/Audit'));
const Integrations = lazy(() => import('./pages/app/Integrations'));
const DevMailbox = lazy(() => import('./pages/auth/DevMailbox'));

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false },
  },
});

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="px-6"><Spinner /></div>}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <div className="px-6"><Spinner label="Signing you in" /></div>;
  if (status === 'signed_out') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function AppIndex() {
  const { memberships } = useAuth();
  if (!memberships.length) return <Navigate to="/app/new" replace />;
  const m = memberships[0];
  return <Navigate to={m.onboardingComplete ? `/app/${m.orgId}` : `/app/${m.orgId}/onboarding`} replace />;
}

const router = createBrowserRouter([
  { path: '/', element: <S><Home /></S> },
  { path: '/login', element: <S><Auth page="login" /></S> },
  { path: '/register', element: <S><Auth page="register" /></S> },
  { path: '/forgot-password', element: <S><Auth page="forgot" /></S> },
  { path: '/reset-password', element: <S><Auth page="reset" /></S> },
  { path: '/verify-email', element: <S><Auth page="verify" /></S> },
  { path: '/invite', element: <S><Auth page="invite" /></S> },
  { path: '/dev/mailbox', element: <S><DevMailbox /></S> },
  { path: '/app', element: <RequireAuth><AppIndex /></RequireAuth> },
  { path: '/app/new', element: <RequireAuth><S><NewOrg /></S></RequireAuth> },
  {
    path: '/app/:orgId',
    element: (
      <RequireAuth>
        <S><AppShell /></S>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <S><Dashboard /></S> },
      { path: 'onboarding', element: <S><Onboarding /></S> },
      { path: 'inbox', element: <S><Inbox /></S> },
      { path: 'inbox/:conversationId', element: <S><Inbox /></S> },
      { path: 'leads', element: <S><Leads /></S> },
      { path: 'leads/:leadId', element: <S><LeadDetail /></S> },
      { path: 'products', element: <S><Products /></S> },
      { path: 'knowledge', element: <S><Knowledge /></S> },
      { path: 'agent', element: <S><AgentPage /></S> },
      { path: 'approvals', element: <S><Approvals /></S> },
      { path: 'widget', element: <S><WidgetPage /></S> },
      { path: 'team', element: <S><Team /></S> },
      { path: 'settings', element: <S><Settings /></S> },
      { path: 'billing', element: <S><Billing /></S> },
      { path: 'audit', element: <S><Audit /></S> },
      { path: 'integrations', element: <S><Integrations /></S> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
