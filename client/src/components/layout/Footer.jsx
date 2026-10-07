import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="relative z-10 mt-20 border-t border-line/80 bg-page-2/70">
      <div className="mx-auto flex max-w-page flex-col gap-4 px-4 py-8 text-[14px] text-ink-2 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="font-extrabold text-ink">AfwaahTracker</span> · Trace the claim. Trace the source. See what changed.
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          <span>Oracle · Node.js · React</span>
          <span>Deterministic rule-based claim matching</span>
          <Link to="/lab" className="font-semibold text-primary hover:text-primary-hover">Database Lab</Link>
        </div>
      </div>
    </footer>
  );
}
