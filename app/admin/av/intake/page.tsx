import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { listCockpitCustomers, type CockpitCustomer } from '@/lib/campaigns/store';
import { IntakeEditor } from './IntakeEditor';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/intake -- the FULL client intake (operator side).
 *
 * Every intake question, grouped, for any client (or your own brands). val
 * prefills it here, then sends the magic link; whatever is entered is what
 * "Extract intelligence" turns into the spine. Shares the brief payload, so the
 * Creative Brief (the strategic subset) and this full intake stay one record.
 * Deep-link: /admin/av/intake?clientId=123. Owner + staff only.
 */
export default async function IntakePage({
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
    /* editor falls back to the AV brand */
  }

  const tenant = (searchParams?.tenant || 'av').toLowerCase();
  const cid = searchParams?.clientId && /^\d+$/.test(searchParams.clientId) ? searchParams.clientId : null;
  const initialKey = cid ? `${tenant}:${cid}` : undefined;

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        Client{' '}
        <span className="font-bold italic text-brand">
          Intake
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        The full intake — every question. Prefill what you know for a client, save, then send their
        magic link so they review and add the rest. Whatever lands here is what the hub turns into
        intelligence (run <em>Extract intelligence</em> on the client&apos;s page after saving).
      </p>
      <IntakeEditor customers={customers} initialKey={initialKey} />
    </div>
  );
}
