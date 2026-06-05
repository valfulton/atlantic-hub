'use client';

/**
 * WelcomePopover  (#189)
 *
 * Card-flip onboarding flow shown to a client the first time they log in.
 * Three slides walking them through the hub: pipeline, content & press,
 * digest rhythm. Skippable at any step. Persistence via localStorage keyed
 * to the client_user_id so it shows ONCE per identity and never again.
 *
 * Why client-side (not server-driven):
 *   - We don't need a DB column; first-visit is a per-device UX choice
 *   - localStorage survives across the magic-link → portal flow
 *   - Operator preview mode never sees it (the parent skips rendering when
 *     `previewMode` is true so val doesn't have to dismiss it on every mirror)
 *
 * Tone: warm, luxury-nautical accent (amber + ink), no "AI" jargon per house
 * rule. Maximally short copy — clients skip walls of text.
 */
import { useEffect, useState } from 'react';

interface Slide {
  eyebrow: string;
  title: string;
  body: string;
  hrefLabel?: string;
  href?: string;
  tiers?: Array<'audit_only' | 'sprint' | 'momentum' | 'scale'>;
}

export default function WelcomePopover({
  clientUserId,
  firstName,
  brandName,
  tier,
  previewMode = false,
  /** (#408) Operator-editable slide override. When provided, replaces the
   *  hardcoded defaults; tokens ({firstName}/{brandName}) substituted here. */
  slides: slidesOverride
}: {
  clientUserId: number | null;
  firstName: string;
  brandName: string;
  tier: 'audit_only' | 'sprint' | 'momentum' | 'scale';
  previewMode?: boolean;
  slides?: Slide[];
}) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  const storageKey = clientUserId ? `av_welcome_seen_${clientUserId}` : null;

  useEffect(() => {
    setMounted(true);
    if (previewMode || !storageKey) return;
    try {
      const seen = window.localStorage.getItem(storageKey);
      if (!seen) setOpen(true);
    } catch {
      // localStorage blocked (private mode, etc.) — skip the welcome rather
      // than show on every visit.
    }
  }, [previewMode, storageKey]);

  if (!mounted || previewMode || !open) return null;

  // (#408) Operator overrides win when present, else fall back to baked-in
  // defaults. Filter by tier: a slide with `tiers` set only renders for
  // those tiers; omitted = render for everyone.
  const safeFirst = firstName && firstName.trim() ? firstName.trim() : '';
  const sub = (s: string) => s.replace(/\{firstName\}/g, safeFirst).replace(/\{brandName\}/g, brandName);

  const baseSlides: Slide[] = slidesOverride && slidesOverride.length > 0 ? slidesOverride : [
    {
      eyebrow: 'Welcome',
      title: safeFirst ? `Hi ${safeFirst}.` : (brandName ? `Hello, ${brandName}.` : 'Welcome aboard.'),
      body: `This is ${brandName}'s home at Atlantic & Vine. Leads, audits, press, content — all in one place.`
    },
    {
      eyebrow: 'Your pipeline',
      title: 'Prospects, scored for fit.',
      body: 'Businesses that match your ideal customer profile, scored against your brief, ranked highest-fit first.',
      hrefLabel: 'See your leads →',
      href: '/client/leads'
    },
    {
      eyebrow: 'Your press queue',
      title: 'Press opportunities in your voice.',
      body: 'When a journalist asks for an expert on something you cover, a drafted pitch lands here. You approve before anything goes out.',
      hrefLabel: 'See your press queue →',
      href: '/client/pr',
      tiers: ['sprint', 'momentum', 'scale']
    },
    {
      eyebrow: 'Your rhythm',
      title: "You'll hear from us each Friday.",
      body: 'A short summary of what moved that week — new leads, hot fits, press matches. Open the hub any time between.'
    }
  ];

  const slides: Slide[] = baseSlides
    .filter((s) => !s.tiers || s.tiers.includes(tier))
    .map((s) => ({ ...s, eyebrow: sub(s.eyebrow), title: sub(s.title), body: sub(s.body) }));

  function dismiss() {
    if (storageKey) {
      try { window.localStorage.setItem(storageKey, new Date().toISOString()); } catch { /* non-fatal */ }
    }
    setOpen(false);
  }

  function next() {
    if (step >= slides.length - 1) {
      dismiss();
      return;
    }
    setStep(step + 1);
  }

  function prev() {
    if (step === 0) return;
    setStep(step - 1);
  }

  const slide = slides[step];
  const isLast = step === slides.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-popover-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 12, 24, 0.78)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
    >
      {/* Card */}
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          borderRadius: 24,
          border: '1px solid color-mix(in srgb, var(--gold-bright) 25%, transparent)',
          background:
            'radial-gradient(140% 160% at 0% 0%, color-mix(in srgb, var(--gold-bright) 12%, transparent), transparent 55%), linear-gradient(180deg, #0e1525 0%, #0a1120 100%)',
          padding: '28px 28px 22px',
          boxShadow: '0 30px 60px rgba(0, 0, 0, 0.45)',
          color: '#e2e8f0'
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--gold-bright)',
            marginBottom: 8
          }}
        >
          {slide.eyebrow}
        </div>
        <h2
          id="welcome-popover-title"
          style={{
            margin: '0 0 10px',
            fontSize: 22,
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            color: '#f8fafc',
            fontWeight: 600
          }}
        >
          {slide.title}
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#cbd5e1' }}>{slide.body}</p>

        {slide.href && slide.hrefLabel && (
          <a
            href={slide.href}
            onClick={dismiss}
            style={{
              display: 'inline-block',
              marginTop: 14,
              fontSize: 13,
              color: 'var(--gold-bright)',
              textDecoration: 'none',
              fontWeight: 500
            }}
          >
            {slide.hrefLabel}
          </a>
        )}

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 6, marginTop: 22 }}>
          {slides.map((_, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                width: i === step ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: i === step ? 'var(--gold-bright)' : 'rgba(255, 255, 255, 0.18)',
                transition: 'width 0.2s ease'
              }}
            />
          ))}
        </div>

        {/* Footer controls */}
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <button
            type="button"
            onClick={dismiss}
            style={{
              background: 'transparent',
              border: 0,
              color: '#94a3b8',
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer'
            }}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button
                type="button"
                onClick={prev}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#cbd5e1',
                  fontSize: 13,
                  padding: '8px 14px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              style={{
                background: 'var(--gold-bright)',
                border: 0,
                color: '#0a1120',
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 10,
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              {isLast ? "Let's go" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
