import { Fingerprint } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import Badge from '../ui/Badge.jsx';

function Row({ label, children, missing }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="meta-label pt-0.5">{label}</dt>
      <dd className="text-[15px] text-ink">
        {missing ? <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">Not determined</span> : children}
      </dd>
    </div>
  );
}

export default function FingerprintCard({ claim }) {
  const fp = claim.fingerprint || {};
  const curated = fp.is_curated === 'Y';
  return (
    <Card>
      <CardHeader
        label="Structured database signature"
        title="Claim fingerprint"
        icon={Fingerprint}
        action={curated ? <Badge tone="green">Curated</Badge> : <Badge tone="electric">Automated</Badge>}
      />
      <dl>
        <Row label="Core assertion" missing={!fp.core_assertion}>{fp.core_assertion}</Row>
        <Row label="Entities" missing={!claim.entities?.length}>
          <div className="flex flex-wrap gap-1.5">
            {claim.entities?.map((e) => <Badge key={e.entity_id} tone="blue">{e.entity_name}</Badge>)}
          </div>
        </Row>
        <Row label="Keywords" missing={!claim.keywords?.length}>
          <div className="flex flex-wrap gap-1.5">
            {claim.keywords?.map((k) => <Badge key={k.keyword_id} tone="muted">{k.keyword_text}</Badge>)}
          </div>
        </Row>
        <Row label="Category">{claim.category}</Row>
        <Row label="Sentiment" missing={!fp.sentiment}>{fp.sentiment && fp.sentiment.charAt(0) + fp.sentiment.slice(1).toLowerCase()}</Row>
        <Row label="Emotional hook" missing={!fp.emotional_hook}>{fp.emotional_hook}</Row>
        <Row label="Manipulation marker" missing={!fp.manipulation_marker}>{fp.manipulation_marker}</Row>
        <Row label="Source pattern" missing={!fp.source_pattern}>{fp.source_pattern}</Row>
        {fp.notes && <Row label="Notes"><span className="text-ink-2">{fp.notes}</span></Row>}
      </dl>
    </Card>
  );
}
