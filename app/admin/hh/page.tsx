import Link from 'next/link';

export default function HhOverviewPage() {
  const tiles = [
    { href: '/admin/hh/subscribers', title: 'Subscribers', desc: 'Free + paid Members + Cohort.' },
    { href: '/admin/hh/fap-applications', title: 'FAP Applications', desc: 'Founding Advisor Partner pipeline.' },
    { href: '/admin/hh/cohort-waitlist', title: 'Cohort Waitlist', desc: 'Waitlist signups by target cohort.' },
    { href: '/admin/hh/research-api', title: 'Research API', desc: 'B2B inquiries + active customers.' }
  ];
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">HunterHoney</h1>
      <p className="text-sm text-muted mb-6">Education today; advisor companion ahead.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="block bg-surface border border-border rounded-xl p-5 hover:border-ink"
          >
            <div className="text-lg font-semibold">{t.title}</div>
            <div className="text-sm text-muted mt-1">{t.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
