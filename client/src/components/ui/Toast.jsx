import { useEffect } from 'react';
import { CircleCheck, CircleAlert, X } from 'lucide-react';
import { useRefresh } from '../../hooks/useRefresh.jsx';

/** Bottom-right summary after a manual refresh. */
export default function RefreshToast() {
  const { lastResult, lastError, dismiss } = useRefresh();
  useEffect(() => {
    if (!lastResult && !lastError) return undefined;
    const t = setTimeout(dismiss, 9000);
    return () => clearTimeout(t);
  }, [lastResult, lastError, dismiss]);

  if (!lastResult && !lastError) return null;
  const t = lastResult?.totals;
  const failedAll = lastResult && lastResult.results.length > 0 && t.failed === lastResult.results.length;
  const ok = lastResult && !failedAll;

  return (
    <div className="fade-up fixed bottom-5 right-5 z-[60] w-[min(92vw,380px)]" role="status">
      <div className="card flex items-start gap-3 p-4">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ok ? 'bg-[#e4f2ec] text-success' : 'bg-[#f8e6e6] text-danger'}`}>
          {ok ? <CircleCheck size={19} /> : <CircleAlert size={19} />}
        </span>
        <div className="min-w-0 flex-1 text-[14px]">
          <div className="font-extrabold text-ink">{ok ? 'Data refreshed' : 'Refresh could not reach the sources'}</div>
          {lastResult && (
            <div className="mt-0.5 text-ink-2">
              {t.fetched} fetched · {t.inserted} new · {t.skipped} duplicates skipped
              {t.failed > 0 && ` · ${t.failed} feed${t.failed > 1 ? 's' : ''} unavailable`}
            </div>
          )}
          {lastError && <div className="mt-0.5 text-ink-2">{lastError.message}</div>}
          {!ok && lastResult && <div className="mt-1 text-[13px] text-muted">Stored Oracle data is still available.</div>}
        </div>
        <button type="button" onClick={dismiss} className="rounded-md p-1 text-muted transition-colors hover:bg-tint hover:text-ink" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
