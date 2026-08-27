import { useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { PageHeader } from './PageHeader';

/**
 * The controller shell: navigation, header, scrolling content, footer.
 *
 * Every controller page renders inside this, so the chrome is defined once and
 * a new page only has to supply its title and body.
 */
export function ControllerLayout({
  title,
  subtitle,
  actions,
  children,
  /** Dashboard and map pages manage their own scrolling and fill the viewport. */
  fill,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  fill?: boolean;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title={title} subtitle={subtitle} actions={actions} onOpenNav={() => setNavOpen(true)} />

        <main className={fill ? 'flex min-h-0 flex-1 flex-col overflow-hidden p-4' : 'flex-1 overflow-y-auto p-4'}>
          {children}
        </main>

        <footer className="flex shrink-0 items-center justify-between border-t border-line bg-surface px-4 py-2 text-[11.5px] text-ink-400">
          <span>SMART-ER — emergency traffic corridor management</span>
          <span className="tnum font-mono">Version 1.0.0</span>
        </footer>
      </div>
    </div>
  );
}
