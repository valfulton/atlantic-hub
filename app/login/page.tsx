/**
 * /login — server wrapper for operator sign-in (#418).
 *
 * Fetches gate copy via getCopyMap() and passes through to OperatorLoginForm.
 * Defaults stream from lib/copy/store.ts DEFAULTS.
 *
 * Editing surface: /admin/av/copy?key=gate.operator_login.
 */
import OperatorLoginForm, { type OperatorLoginCopy } from './OperatorLoginForm';
import { getCopyMap } from '@/lib/copy/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEYS = [
  'gate.operator_login.eyebrow',
  'gate.operator_login.h1',
  'gate.operator_login.lede',
  'gate.operator_login.label_email',
  'gate.operator_login.label_password',
  'gate.operator_login.cta',
  'gate.foot'
];

export default async function OperatorLoginPage() {
  const c = await getCopyMap(KEYS, {});
  const copy: OperatorLoginCopy = {
    eyebrow:       c['gate.operator_login.eyebrow'],
    h1:            c['gate.operator_login.h1'],
    lede:          c['gate.operator_login.lede'],
    labelEmail:    c['gate.operator_login.label_email'],
    labelPassword: c['gate.operator_login.label_password'],
    cta:           c['gate.operator_login.cta'],
    foot:          c['gate.foot']
  };
  return <OperatorLoginForm copy={copy} />;
}
