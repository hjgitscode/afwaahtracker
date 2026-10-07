import { CircleAlert, DatabaseZap, SearchX, ServerCrash, WifiOff } from 'lucide-react';

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />;
}

export function LoadingBlock({ rows = 3, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`h-5 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function LoadingCards({ count = 3, className = '' }) {
  return (
    <div className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card card-pad">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="mb-3 h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = SearchX, title, children, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'py-8' : 'py-14'}`}>
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-tint text-primary">
        <Icon size={26} strokeWidth={1.8} />
      </span>
      <h3 className="text-lg font-extrabold text-ink">{title}</h3>
      {children && <p className="mt-1.5 max-w-md text-[15px] text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Friendly error panel. Never shows stack traces. */
export function ErrorState({ error, onRetry, compact = false }) {
  const code = error?.code;
  let Icon = CircleAlert;
  let title = 'Something went wrong';
  let text = error?.message || 'The request could not be completed.';
  if (code === 'DB_UNAVAILABLE') {
    Icon = DatabaseZap;
    title = 'Oracle database disconnected';
    text = 'The API is running but cannot reach Oracle. Start the database (and check server/.env), then try again.';
  } else if (code === 'API_UNREACHABLE') {
    Icon = WifiOff;
    title = 'API not reachable';
    text = 'The AfwaahTracker backend is not responding on port 3000. Start it with "npm run dev".';
  } else if (code === 'NOT_FOUND') {
    Icon = SearchX;
    title = 'Not found';
  } else if (error?.status >= 500) {
    Icon = ServerCrash;
    title = 'Server error';
  }
  return (
    <div className={`card ${compact ? 'p-5' : 'card-pad'} border-[#ecd2d2]`} role="alert">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f8e6e6] text-danger">
          <Icon size={22} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-extrabold text-ink">{title}</h3>
          <p className="mt-1 text-[15px] text-ink-2">{text}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn btn-ghost btn-sm mt-4">
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
