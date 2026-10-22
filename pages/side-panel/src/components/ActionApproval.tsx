import { FiShield, FiArrowUpRight } from 'react-icons/fi';
import { Button } from './ui/button';
import type { ActionApproval as Approval } from '@extension/shared';
import type { assistantCopy } from '../lib/assistant-copy';

export default function ActionApproval({
  request,
  onResolve,
  copy,
}: {
  request: Approval;
  onResolve: (approved: boolean) => void;
  copy: ReturnType<typeof assistantCopy>;
}) {
  return (
    <section className="assistant-approval" aria-label={copy.approval}>
      <div className="assistant-approval-title">
        <FiShield />
        <strong>{copy.approval}</strong>
      </div>
      <p>{request.description}</p>
      <details className="assistant-approval-details">
        <summary>{request.action}</summary>
        <pre>{request.parameters}</pre>
      </details>
      <div className="assistant-approval-origin">
        <FiArrowUpRight />
        <span>{request.url}</span>
      </div>
      <div className="assistant-approval-actions">
        <Button variant="outline" size="sm" onClick={() => onResolve(false)}>
          {copy.deny}
        </Button>
        <Button size="sm" onClick={() => onResolve(true)}>
          {copy.allow}
        </Button>
      </div>
    </section>
  );
}
