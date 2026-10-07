import { ArrowUpRight } from 'lucide-react';

export default function ExternalLink({ href, children = 'View source', className = '' }) {
  if (!href) return <span className="text-muted">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`ext-link ${className}`}>
      {children}
      <ArrowUpRight size={14} strokeWidth={2.5} />
    </a>
  );
}
