import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { listCockpitCustomers, type CockpitCustomer } from '@/lib/campaigns/store';
import { BriefEditor } from './BriefEditor';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/brief -- the Creative Brief surface.
 *
 * Fill the canonical creative brief for any customer — your own brands
 * (Atlantic & Vine, Events by Water, Hunter Honey) AND each client account — then
 * see exactly how it grounds the thesis + PR prompts. Until now the own-brand
 * brief was missing, so those prompts fell back to a hardcoded label. Owner + staff.
 */
export default async function BriefPage({
  searchParams
}: {
  searchParams?: { clientId?: string; tenant?: string };
}) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  let customers: CockpitCustomer[] = [];
  try {
    customers = await listCockpitCustomers();
  } catch {
    /* render with the 3 brands at minimum (editor falls back) */
  }

  // Deep-link: open straight to a client's (or brand's) brief. Scope key matches
  // lineOwnerKey(): `${tenant}:${clientId|'house'}`.
  const tenant = (searchParams?.tenant || 'av').toLowerCase();
  const cid = searchParams?.clientId && /^\d+$/.test(searchParams.clientId) ? searchParams.clientId : null;
  const initialKey = cid ? `${tenant}:${cid}` : undefined;

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        Creative{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Brief
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        The brief is the foundation every AI call grounds on. Fill it for a brand or client,
        and the thesis suggester and PR drafter speak <em>as that brand</em> instead of a generic voice.
        The grounding block at the bottom shows exactly what the prompts will see.
      </p>
      <BriefEditor customers={customers} initialKey={initialKey} />
    </div>
  );
}
