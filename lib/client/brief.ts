/**
 * lib/client/brief.ts
 *
 * The Creative Brief assembler — the unifying "operating space" for a customer.
 *
 * It does NOT introduce a new store; it ASSEMBLES from what already exists:
 *   - the customer's active narrative line(s)  (lib/campaigns/store)
 *   - their next few scored leads              (lib/client/leads)
 *   - content awaiting their approval          (lib/client/campaign)
 *
 * One read model so the dashboard can show "here's the story we're telling,
 * here's who to talk to next, here's what's ready for you to approve."
 */
import { listActiveLines } from '@/lib/campaigns/store';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import { listClientCampaignContent, type CampaignContentItem } from '@/lib/client/campaign';

export interface BriefLine {
  id: number;
  name: string;
  thesis: string | null;
  emotionalDriver: string | null;
}

export interface CreativeBrief {
  activeLines: BriefLine[];
  nextLeads: ClientLead[];
  awaitingApproval: CampaignContentItem[];
  awaitingCount: number;
}

const EMPTY: CreativeBrief = { activeLines: [], nextLeads: [], awaitingApproval: [], awaitingCount: 0 };

/**
 * Assemble the brief for a logged-in client user. Each piece degrades on its
 * own — a failure in one source never blanks the whole brief.
 */
export async function getClientCreativeBrief(user: { client_id: number | null; email: string }): Promise<CreativeBrief> {
  if (!user.client_id) return EMPTY;

  const [linesRes, leadsRes, contentRes] = await Promise.allSettled([
    listActiveLines('av', user.client_id),
    listClientLeads(user),
    listClientCampaignContent({ client_id: user.client_id, email: user.email })
  ]);

  const activeLines: BriefLine[] = linesRes.status === 'fulfilled'
    ? linesRes.value.map((l) => ({ id: l.id, name: l.name, thesis: l.thesis, emotionalDriver: l.emotionalDriver }))
    : [];

  const nextLeads: ClientLead[] = leadsRes.status === 'fulfilled' ? leadsRes.value.slice(0, 5) : [];

  const awaitingApproval: CampaignContentItem[] = contentRes.status === 'fulfilled'
    ? contentRes.value.filter((c) => c.stage === 'ready')
    : [];

  return { activeLines, nextLeads, awaitingApproval, awaitingCount: awaitingApproval.length };
}
