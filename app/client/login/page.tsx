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

/**
 * /client/login  (#337 v2)
 *
 * Visually mirrors AV_livewebsite/inquire_obsidian.html — the gate val
 * approved. Cream + emerald + Fraunces serif + 4px emerald accent bar on a
 * white card. Same CSS variables as the marketing site so the two surfaces
 * read as one continuous brand.
 *
 * Anti-pattern that got fixed: previous version mistook "obsidian" for "dark
 * navy" and built a dark gold-on-black gate. The actual gate is bright cream
 * with emerald accents. Mirror-matching now.
 *
 * Self-contained styling (styled-jsx) so this page doesn't inherit the
 * operator-hub's dark surface + amber tokens. Don't add Tailwind utility
 * classes from the hub's global token set — they would re-introduce the
 * orange we just took out.
 */
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
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      <div className="ig-page">
        <nav className="ig-nav">
          <div className="ig-nav-inner">
            <a href="https://atlanticandvine.netlify.app" className="ig-brand">
              <img
                src="https://atlanticandvine.netlify.app/av-logo.png"
                alt="Atlantic & Vine"
                className="ig-logo"
              />
              <span className="ig-brand-text">Atlantic &amp; Vine</span>
            </a>
            <a href="https://atlanticandvine.netlify.app" className="ig-nav-back">
              ← Back to site
            </a>
          </div>
        </nav>

        <main className="ig-stage">
          <form
            onSubmit={handleSubmit}
            className="ig-card"
            aria-labelledby="login-heading"
          >
            <p className="ig-eyebrow">Client Portal</p>
            <h1 id="login-heading" className="ig-headline">
              Welcome back.
            </h1>
            <p className="ig-lede">
              Sign in with the email and password tied to your account.
            </p>

            <div className="ig-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="ig-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div role="alert" className="ig-error">
                {error}
              </div>
            )}

            <button className="ig-cta" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>

            <p className="ig-fallback">
              First time here? Submit the intake form at{' '}
              <a href="https://atlanticandvine.netlify.app/#client-intake">
                atlanticandvine.com
              </a>{' '}
              and we&apos;ll send you a secure link.
            </p>
          </form>
        </main>

        <footer className="ig-foot">© Atlantic &amp; Vine · By appointment</footer>

        <style jsx>{`
          /* (#341) Local var aliases map to BRAND_TOKENS so this page flips
             palette automatically when the parent /client/layout.tsx applies
             data-skin="royale". On Velvet Royale: cream→obsidian, charcoal→
             paper-text, emerald→Aurum gold. On a future cream variant:
             swap data-skin off, BRAND_TOKENS reverts, this file unchanged. */
          .ig-page {
            --emerald-deep: var(--brand);
            --emerald: var(--brand-hover);
            --black: var(--ink);
            --charcoal: var(--ink);
            --gray-warm: var(--muted);
            --gray-soft: var(--muted);
            --cream: var(--bg);
            --paper: var(--surface);
            --gold-accent: var(--brand);

            min-height: 100vh;
            display: grid;
            grid-template-rows: auto 1fr auto;
            background: var(--cream);
            color: var(--charcoal);
            font-family: 'Inter', system-ui, sans-serif;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
          }
          .ig-nav {
            padding: 1.5rem 3rem;
            background: rgba(250, 248, 244, 0.85);
            -webkit-backdrop-filter: blur(20px);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid rgba(10, 77, 60, 0.08);
          }
          .ig-nav-inner {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .ig-brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            text-decoration: none;
          }
          .ig-logo { height: 64px; width: auto; }
          .ig-brand-text {
            font-family: 'Fraunces', serif;
            font-weight: 600;
            font-size: 1.25rem;
            color: var(--black);
            letter-spacing: -0.02em;
          }
          .ig-nav-back {
            font-family: 'Inter', sans-serif;
            font-size: 0.9rem;
            font-weight: 500;
            color: var(--gray-warm);
            text-decoration: none;
            transition: color 0.2s ease;
          }
          .ig-nav-back:hover { color: var(--emerald-deep); }

          .ig-stage {
            display: grid;
            place-items: center;
            padding: 3rem 1.5rem;
          }
          .ig-card {
            background: var(--paper);
            width: 100%;
            max-width: 520px;
            border-radius: 6px;
            border: 1px solid rgba(10, 77, 60, 0.1);
            box-shadow: 0 18px 48px rgba(10, 77, 60, 0.10);
            position: relative;
            overflow: hidden;
            padding: 2.75rem 2.5rem 2.25rem;
          }
          .ig-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 4px;
            height: 100%;
            background: var(--emerald-deep);
          }

          .ig-eyebrow {
            font-family: 'Inter', sans-serif;
            font-size: 0.72rem;
            font-weight: 600;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: var(--gray-soft);
            margin: 0 0 0.85rem;
          }
          .ig-headline {
            font-family: 'Fraunces', serif;
            font-size: 1.9rem;
            font-weight: 500;
            line-height: 1.2;
            letter-spacing: -0.01em;
            color: var(--black);
            margin: 0 0 0.6rem;
          }
          .ig-lede {
            font-family: 'Inter', sans-serif;
            font-size: 0.98rem;
            color: var(--gray-warm);
            line-height: 1.6;
            margin: 0 0 1.8rem;
          }

          .ig-field { margin-bottom: 1.1rem; }
          .ig-field label {
            display: block;
            font-family: 'Inter', sans-serif;
            font-size: 0.72rem;
            font-weight: 600;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--emerald-deep);
            margin-bottom: 0.4rem;
          }
          .ig-field input {
            width: 100%;
            font-family: 'Inter', sans-serif;
            font-size: 1rem;
            padding: 0.85rem 1rem;
            background: var(--cream);
            border: 1px solid rgba(10, 77, 60, 0.15);
            border-radius: 4px;
            color: var(--charcoal);
            transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
            outline: none;
            box-sizing: border-box;
          }
          .ig-field input:focus {
            border-color: var(--emerald-deep);
            background: var(--paper);
            box-shadow: 0 0 0 3px rgba(10, 77, 60, 0.08);
          }

          .ig-error {
            margin: 0.2rem 0 1.1rem;
            padding: 0.7rem 0.85rem;
            border-radius: 4px;
            background: rgba(220, 53, 53, 0.06);
            border: 1px solid rgba(220, 53, 53, 0.25);
            color: #B43A3A;
            font-size: 0.85rem;
            line-height: 1.5;
          }

          .ig-cta {
            width: 100%;
            background: var(--emerald-deep);
            color: var(--cream);
            padding: 1rem 1.5rem;
            border: 1px solid var(--emerald-deep);
            border-radius: 4px;
            font-family: 'Inter', sans-serif;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.6rem;
            margin-top: 0.3rem;
          }
          .ig-cta:hover:not(:disabled) {
            background: var(--black);
            border-color: var(--black);
            transform: translateY(-2px);
            box-shadow: 0 12px 30px rgba(10, 77, 60, 0.3);
          }
          .ig-cta:hover svg { transform: translateX(4px); }
          .ig-cta svg { transition: transform 0.3s ease; }
          .ig-cta:disabled {
            opacity: 0.6;
            cursor: wait;
          }

          .ig-fallback {
            margin: 1.5rem 0 0;
            padding-top: 1.25rem;
            border-top: 1px solid rgba(10, 77, 60, 0.1);
            font-family: 'Inter', sans-serif;
            font-size: 0.85rem;
            color: var(--gray-warm);
            line-height: 1.55;
          }
          .ig-fallback a {
            color: var(--emerald-deep);
            text-decoration: none;
            font-weight: 600;
            border-bottom: 1px solid var(--emerald-deep);
            padding-bottom: 1px;
            transition: color 0.2s ease;
          }
          .ig-fallback a:hover { color: var(--black); }

          .ig-foot {
            padding: 1.5rem 3rem;
            text-align: center;
            font-family: 'Inter', sans-serif;
            font-size: 0.8rem;
            color: var(--gray-soft);
            border-top: 1px solid rgba(10, 77, 60, 0.06);
          }

          @media (max-width: 640px) {
            .ig-nav { padding: 1.1rem 1.25rem; }
            .ig-logo { height: 48px; }
            .ig-brand-text { font-size: 1.05rem; }
            .ig-stage { padding: 2rem 1rem; }
            .ig-card { padding: 2rem 1.75rem; }
            .ig-headline { font-size: 1.55rem; }
            .ig-foot { padding: 1.25rem; }
          }

          @media (prefers-reduced-motion: reduce) {
            .ig-page *, .ig-page *::before, .ig-page *::after {
              animation: none !important;
              transition: none !important;
            }
          }
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
