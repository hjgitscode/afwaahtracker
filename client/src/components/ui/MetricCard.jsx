export default function MetricCard({ label, value, hint, icon: Icon, accent = false, className = '' }) {
  return (
    <div className={`card card-hover p-5 md:p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="meta-label">{label}</div>
        {Icon && (
          <span className={`grid h-9 w-9 place-items-center rounded-lg ${accent ? 'bg-[#fdf3d6] text-warning' : 'bg-tint text-primary'}`}>
            <Icon size={18} strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="mt-3 text-[2rem] font-extrabold leading-none tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-2 text-[13.5px] text-ink-2">{hint}</div>}
    </div>
  );
}
