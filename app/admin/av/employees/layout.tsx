/**
 * /admin/av/employees layout  (#341, val 2026-06-02)
 *
 * Wraps every employee/rep page with `data-skin="royale"` so the Velvet
 * Royale palette (obsidian + Aurum gold + platinum + ice-cyan live, per
 * app/_styles/brand-tokens.css) applies automatically. Reverses the
 * earlier "Royale never on rep arena unless explicit" rule per val's
 * 2026-06-02 direction: ALL employee + client surfaces wear the Royale
 * register; operator hub keeps its existing amber + dark-navy.
 *
 * To swap palettes for the entire employee area: change this one
 * attribute, OR edit the [data-skin="royale"] block in brand-tokens.css.
 */
export default function EmployeesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="royale" className="min-h-screen">
      {children}
    </div>
  );
}
