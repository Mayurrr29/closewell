import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 text-[17px] font-bold tracking-tight text-ink">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--brand)" />
        <path d="M9 17l5 5 9-12" stroke="var(--brand-ink)" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Closewell
    </Link>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('cw-theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable: theme lasts for this page */
    }
  };
  return (
    <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
