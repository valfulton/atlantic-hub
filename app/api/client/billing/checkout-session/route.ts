/**
 * GET /api/client/billing/checkout-session  (val 2026-06-07)
 *
 * The client-side endpoint a paywall modal hits to begin a Stripe checkout
 * session. Today (stub mode): redirects to /client/pricing with the desired
 * plan + return-intent preserved in the URL. Tomorrow (Stripe wired):
 * creates a real Stripe Checkout Session and 302s to session.url.
 *
 * Why this stub exists ahead of Stripe wiring: it lets us ship the paywall
 * UX end-to-end TODAY. The /client/discover route returns 402 with this URL;
 * the modal redirects the client here; this endpoint sends them to the
 * pricing page with their plan pre-selected. When Stripe keys land in env
 * the stub gets replaced with the real call — no UI changes needed.
 *
 * Query params:
 *   plan   — 'sprint' | 'momentum' | 'scale'  (the target ClientUserTier)
 *   reason — free-text reason code so we can analytics-log what triggered
 *            the upgrade ('discover_more_leads', 'monthly_cap_reached',
 *            'distress_promote_locked', etc.)
 *
 * Auth: client_user only. Operator/admin accounts shouldn't be hitting
 * a client billing endpoint; middleware also already gates /api/client/*.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PLANS = new Set(['sprint', 'momentum', 'scale']);

export async function GET(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const user = await findClientUserById(actor.clientUserId);
  if (!user) {
    return NextResponse.json({ error: 'no user' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const plan = (searchParams.get('plan') || 'sprint').toLowerCase();
  const reason = (searchParams.get('reason') || 'unspecified').slice(0, 64);

  if (!VALID_PLANS.has(plan)) {
    return NextResponse.json({ error: 'invalid plan' }, { status: 400 });
  }

  // Log the upgrade intent so the operator dashboard can show "X clients
  // started a checkout this week" without depending on Stripe webhooks.
  try {
    await logEvent({
      eventType: 'client.billing.checkout_started',
      source: 'stripe',
      payload: {
        client_user_id: actor.clientUserId,
        plan,
        reason,
        current_tier: user.tier,
        mode: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'stub'
      }
    });
  } catch { /* logging never blocks billing */ }

  // ─── Stripe path (active when STRIPE_SECRET_KEY is set) ────────────────
  // Stripe Checkout Session creation goes here. Pseudocode:
  //
  //   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  //   const session = await stripe.checkout.sessions.create({
  //     mode: 'subscription',
  //     customer_email: user.email,
  //     client_reference_id: String(user.client_user_id),
  //     line_items: [{ price: process.env[`STRIPE_PRICE_${plan.toUpperCase()}`]!, quantity: 1 }],
  //     success_url: `${origin}/client/dashboard?upgraded=${plan}`,
  //     cancel_url:  `${origin}/client/pricing?cancelled=1`,
  //     subscription_data: { metadata: { client_user_id: String(user.client_user_id), reason } }
  //   });
  //   return NextResponse.redirect(session.url!, { status: 303 });
  //
  // The Stripe webhook (separate route) then promotes user.tier on
  // checkout.session.completed.

  // ─── Stub path (today) ────────────────────────────────────────────────
  // No STRIPE_SECRET_KEY yet — send to /client/pricing with plan + reason
  // preselected. The pricing page can highlight the right tier and queue
  // a "we got your interest" event for val to call back manually.
  const url = new URL('/client/pricing', req.url);
  url.searchParams.set('plan', plan);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url.toString(), { status: 303 });
}
