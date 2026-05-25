import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PromptEditor } from './PromptEditor';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/prompts -- the one place to view + edit the platform's AI prompts.
 *
 * Each prompt has a built-in default (owned by code) and an optional operator
 * override stored in ai_prompt_overrides. Editing here changes what the live calls
 * send, with no deploy; Reset returns to the default. Owner + staff only.
 */
export default function PromptsPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        AI{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Prompts
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        The exact instructions the platform sends to the AI, in one place. Edit a prompt to make it
        sharper or more on-brand — it takes effect immediately, no deploy. Reset returns it to the
        built-in default. The per-item data (the specific lead, the brief) is added automatically at
        call time; here you tune the strategy and rules.
      </p>
      <PromptEditor />
    </div>
  );
}
