export default function Card({ as: Tag = 'div', className = '', hover = false, pad = true, children, ...rest }) {
  return (
    <Tag className={`card ${hover ? 'card-hover' : ''} ${pad ? 'card-pad' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ label, title, subtitle, icon: Icon, action, className = '' }) {
  return (
    <div className={`mb-5 flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {label && <div className="system-label mb-1.5">{label}</div>}
        {title && <h2 className="card-title">{title}</h2>}
        {subtitle && <p className="mt-1 text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {Icon && (
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-tint text-primary">
            <Icon size={20} strokeWidth={2} />
          </span>
        )}
      </div>
    </div>
  );
}
