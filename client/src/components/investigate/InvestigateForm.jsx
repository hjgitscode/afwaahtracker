import { useEffect, useState } from 'react';
import { Search, Globe } from 'lucide-react';
import { useInvestigate } from '../../hooks/useInvestigate.js';

/** Search box + INVESTIGATE WEB, used by the Home hero and the Explore page. */
export default function InvestigateForm({ initial = '', dark = false }) {
  const [q, setQ] = useState(initial);
  const { investigate, starting, error } = useInvestigate();
  useEffect(() => setQ(initial), [initial]);

  const submit = (e) => {
    e.preventDefault();
    investigate(q);
  };

  return (
    <form onSubmit={submit} role="search" aria-label="Investigate a claim on the web">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search a claim, person, event or topic</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={300}
            placeholder="Search a claim, person, event or topic..."
            className={`h-14 w-full rounded-full border-2 bg-white pl-12 pr-5 text-[16px] text-ink outline-none transition-[border-color] duration-200 placeholder:text-muted focus:border-electric ${dark ? 'border-transparent shadow-[0_8px_20px_rgba(10,20,30,.22)]' : 'border-line'}`}
          />
        </label>
        <button type="submit" className="btn btn-primary h-14 px-8 text-[14px]" disabled={starting}>
          <Globe size={17} strokeWidth={2.4} className={starting ? 'spin' : ''} />
          {starting ? 'Starting…' : 'Investigate web'}
        </button>
      </div>
      {error && (
        <p role="alert" className={`mt-3 pl-2 text-[14px] font-semibold ${dark ? 'text-[#ffd6d6]' : 'text-danger'}`}>{error.message}</p>
      )}
    </form>
  );
}
