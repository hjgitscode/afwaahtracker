import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/States.jsx';
import { Watermark } from '../components/layout/BackgroundShapes.jsx';

export default function NotFoundPage() {
  return (
    <div className="relative py-10">
      <Watermark word="404" style={{ top: -20, left: '50%', transform: 'translateX(-50%)' }} />
      <div className="card relative z-10 mx-auto max-w-xl">
        <EmptyState
          icon={Compass}
          title="This page does not exist"
          action={(
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/" className="btn btn-primary">Go home</Link>
              <Link to="/explore" className="btn btn-ghost">Explore claims</Link>
            </div>
          )}
        >
          The link may be outdated, or the claim may have been removed.
        </EmptyState>
      </div>
    </div>
  );
}
