import { useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, RefreshCw, X } from 'lucide-react';
import { useRefresh } from '../../hooks/useRefresh.jsx';

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/explore', label: 'Explore' },
  { to: '/sources', label: 'Sources' },
  { to: '/live', label: 'Live Feed' },
  { to: '/lab', label: 'Database Lab' },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 text-white" aria-label="AfwaahTracker home">
      <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="4" />
        <circle cx="32" cy="32" r="15" fill="none" stroke="#fff" strokeWidth="4" />
        <circle cx="32" cy="32" r="6" fill="#5EC7EA" />
        <circle cx="54" cy="16" r="5" fill="#fff" />
      </svg>
      <span className="text-[22px] font-extrabold leading-none tracking-[-0.01em]">
        AFWAAH<span className="font-semibold text-white/80">TRACKER</span>
      </span>
    </Link>
  );
}

function RefreshButton({ className = '' }) {
  const { refresh, refreshing } = useRefresh();
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={refreshing}
      className={`inline-flex items-center gap-2 rounded-full bg-white px-[18px] py-[9px] text-[12.5px] font-extrabold uppercase tracking-[0.05em] text-deep shadow-[0_4px_12px_rgba(20,38,52,.18)] transition-all duration-200 hover:-translate-y-px hover:bg-[#f2f7fd] hover:shadow-[0_8px_18px_rgba(20,38,52,.22)] disabled:cursor-wait disabled:opacity-90 ${className}`}
      aria-live="polite"
    >
      <RefreshCw size={15} strokeWidth={2.6} className={refreshing ? 'spin' : ''} />
      {refreshing ? 'Refreshing…' : 'Refresh Data'}
    </button>
  );
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="sticky top-0 z-50 bg-nav shadow-[0_2px_10px_rgba(36,55,70,.18)]">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <RefreshButton className="hidden sm:inline-flex" />
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-md text-white transition-colors hover:bg-white/10 lg:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="fade-up border-t border-white/15 bg-nav px-4 pb-4 pt-2 lg:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-item w-full ${isActive ? 'active' : ''}`}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <RefreshButton className="mt-3 w-full justify-center sm:hidden" />
        </div>
      )}
    </header>
  );
}
