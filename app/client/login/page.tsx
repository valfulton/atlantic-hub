'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid_or_expired:
    'That magic link is no longer valid. Submit the intake form again or use your password below.',
  invalid_link:
    'That magic link is no longer valid. Submit the intake form again or use your password below.',
  server_error: 'Something went wrong on our end. Please try again in a moment.',
  something_went_wrong: 'Something went wrong on our end. Please try again in a moment.'
};

function LoginForm() {
  const params = useSearchParams();
  const initialError = params.get('error');
  const next = params.get('next') || '/client/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    initialError ? ERROR_MESSAGES[initialError] ?? 'Could not sign in. Please try again.' : null
  );
  const [submitting, setSubmitting] = useState(false);

  // Clear the URL error param once we have it in state, so a refresh doesn't repeat it.
  useEffect(() => {
    if (initialError && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [initialError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/client/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Could not sign in. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = next;
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <>
      {/*
        (#337) Restyled to the obsidian-inquire register — Cormorant headline,
        editorial spacing, gold CTA (gold inherits from #336's --brand swap to
        champagne). Stays gated by the existing /api/client/login endpoint; no
        behavior change, just the polish val asked for.
      */}
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap"
        rel="stylesheet"
      />
      <div className="cl-page">
        <header className="cl-topbar">
          <span className="cl-wordmark">Atlantic &amp; Vine</span>
          <a
            href="https://atlanticandvine.netlify.app"
            target="_blank"
            rel="noopener"
            className="cl-link"
          >
            atlanticandvine.com
          </a>
        </header>

        <main className="cl-main">
          <form
            onSubmit={handleSubmit}
            className="cl-card"
            aria-labelledby="login-heading"
          >
            <p className="cl-eyebrow">By invitation</p>
            <h1 id="login-heading" className="cl-headline">
              Welcome <em>back</em>.
            </h1>
            <p className="cl-sub">Sign in to your client portal.</p>

            <label htmlFor="email" className="cl-label">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="cl-input"
            />

            <label htmlFor="password" className="cl-label">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="cl-input"
            />

            {error && (
              <div role="alert" className="cl-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="cl-cta"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="cl-footnote">
              First time here? Submit the intake form on{' '}
              <a
                href="https://atlanticandvine.netlify.app/#client-intake"
                className="cl-footnote-link"
              >
                atlanticandvine.com
              </a>{' '}
              and we&apos;ll send you a secure link.
            </p>
          </form>
        </main>

        <style jsx>{`
          .cl-page {
            min-height: 100vh;
            background:
              radial-gradient(ellipse at 50% -10%, rgba(201, 152, 88, 0.06), transparent 55%),
              #0A0E18;
            color: #D9DFEA;
            font-family: 'Inter', system-ui, sans-serif;
          }
          .cl-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 22px 32px;
            border-bottom: 1px solid rgba(201, 152, 88, 0.18);
          }
          .cl-wordmark {
            font-family: 'Cormorant Garamond', Georgia, serif;
            font-size: 18px;
            font-weight: 500;
            letter-spacing: 0.04em;
            color: #F5EFE3;
          }
          .cl-link {
            font-size: 11px;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            color: #C99858;
            text-decoration: none;
            border-bottom: 1px solid rgba(201, 152, 88, 0.4);
            padding-bottom: 2px;
          }
          .cl-link:hover { color: #E5B879; }

          .cl-main {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 64px 24px 96px;
          }
          .cl-card {
            width: 100%;
            max-width: 460px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(201, 152, 88, 0.22);
            border-radius: 6px;
            padding: 48px 44px 36px;
            box-shadow:
              0 30px 80px -30px rgba(0, 0, 0, 0.6),
              inset 0 1px 0 rgba(255, 255, 255, 0.03);
          }
          .cl-eyebrow {
            font-size: 10px;
            letter-spacing: 0.3em;
            text-transform: uppercase;
            color: #B89366;
            margin: 0 0 14px;
          }
          .cl-headline {
            font-family: 'Cormorant Garamond', Georgia, serif;
            font-weight: 400;
            font-size: 38px;
            line-height: 1.1;
            color: #F5EFE3;
            margin: 0 0 8px;
          }
          .cl-headline em {
            font-style: italic;
            color: #E5B879;
          }
          .cl-sub {
            font-size: 13px;
            color: #8B96A4;
            margin: 0 0 28px;
          }
          .cl-label {
            display: block;
            font-size: 11px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #B89366;
            margin: 0 0 6px;
          }
          .cl-input {
            width: 100%;
            padding: 11px 14px;
            margin-bottom: 18px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(201, 152, 88, 0.18);
            border-radius: 4px;
            color: #F5EFE3;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.18s ease;
          }
          .cl-input:focus {
            outline: none;
            border-color: #C99858;
          }
          .cl-error {
            margin: 6px 0 14px;
            padding: 10px 12px;
            border-radius: 4px;
            background: rgba(248, 113, 113, 0.08);
            border: 1px solid rgba(248, 113, 113, 0.35);
            color: #FCA5A5;
            font-size: 12.5px;
          }
          .cl-cta {
            width: 100%;
            padding: 13px 16px;
            margin-top: 6px;
            background: #C99858;
            color: #0A0E18;
            border: none;
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.06em;
            cursor: pointer;
            transition: background 0.18s ease, opacity 0.18s ease;
          }
          .cl-cta:hover { background: #E5B879; }
          .cl-cta:disabled {
            opacity: 0.6;
            cursor: wait;
          }
          .cl-footnote {
            margin: 26px 0 0;
            text-align: center;
            font-size: 11.5px;
            color: #8B96A4;
            line-height: 1.6;
          }
          .cl-footnote-link {
            color: #C99858;
            text-decoration: none;
            border-bottom: 1px dotted rgba(201, 152, 88, 0.4);
          }
          .cl-footnote-link:hover { color: #E5B879; }
        `}</style>
      </div>
    </>
  );
}

export default function ClientLoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex items-center justify-center" />}>
      <LoginForm />
    </Suspense>
  );
}
