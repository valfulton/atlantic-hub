/**
 * /client/set-password — server wrapper (#418).
 *
 * Fetches editable gate copy from site_copy (Copy Steering Board) and
 * passes it as a typed prop to the client SetPasswordForm. Defaults stream
 * in from lib/copy/store.ts DEFAULTS when no override is set.
 *
 * Editing surface: /admin/av/copy?key=gate.set_password.
 */
import SetPasswordForm, { type SetPasswordCopy } from './SetPasswordForm';
import { getCopyMap } from '@/lib/copy/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEYS = [
  'gate.set_password.eyebrow',
  'gate.set_password.h1_welcoming',
  'gate.set_password.h1_returning',
  'gate.set_password.lede_welcoming',
  'gate.set_password.lede_returning',
  'gate.set_password.label_new',
  'gate.set_password.label_confirm',
  'gate.set_password.cta',
  'gate.foot'
];

export default async function SetPasswordPage() {
  const c = await getCopyMap(KEYS, {});
  const copy: SetPasswordCopy = {
    eyebrow:       c['gate.set_password.eyebrow'],
    h1Welcoming:   c['gate.set_password.h1_welcoming'],
    h1Returning:   c['gate.set_password.h1_returning'],
    ledeWelcoming: c['gate.set_password.lede_welcoming'],
    ledeReturning: c['gate.set_password.lede_returning'],
    labelNew:      c['gate.set_password.label_new'],
    labelConfirm:  c['gate.set_password.label_confirm'],
    cta:           c['gate.set_password.cta'],
    foot:          c['gate.foot']
  };
  return <SetPasswordForm copy={copy} />;
}
