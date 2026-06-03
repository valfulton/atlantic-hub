/**
 * AccessPaused — shown to a client whose trial has lapsed or whose access was
 * revoked. Calm and on-brand; never a hard error. The door is closed politely,
 * with a clear path to turn it back on (contact). Operator side is unaffected.
 */
export default function AccessPaused({ expired }: { expired: boolean }) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 sm:py-24">
      <section
        className="rounded-2xl border border-border overflow-hidden"
        style={{
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
        }}
      >
        <div className="px-6 sm:px-10 py-10">
          <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Atlantic &amp; Vine</div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
            {expired ? 'Your trial has wrapped up.' : 'Your access is paused.'}
          </h1>
          <p className="text-muted text-sm mt-5 leading-relaxed">
            {expired
              ? 'Your full-access window has ended — we hope you loved seeing your story come together. Everything we built for you is saved and waiting.'
              : 'Your account access is paused for now. Nothing is lost — your leads, content, and brief are all safe.'}
          </p>
          <p className="text-muted text-sm mt-3 leading-relaxed">
            To pick back up where you left off, reply to your welcome email or reach us at{' '}
            <a href="mailto:info@atlanticandvine.com" className="text-brand hover:underline">info@atlanticandvine.com</a> and we&apos;ll switch it right back on.
          </p>
        </div>
      </section>
    </main>
  );
}
