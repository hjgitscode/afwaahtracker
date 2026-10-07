import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export default function PageHeader({ label, title, subtitle, crumbs, actions, children }) {
  return (
    <header className="mb-8 md:mb-10">
      {crumbs && (
        <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={c.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={14} />}
              {c.to ? (
                <Link to={c.to} className="transition-colors hover:text-primary">{c.label}</Link>
              ) : (
                <span className="text-ink-2">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {label && <div className="system-label mb-2">{label}</div>}
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="mt-3 max-w-2xl text-[17px] text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
