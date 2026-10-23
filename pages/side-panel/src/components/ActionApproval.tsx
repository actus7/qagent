import { FiShield, FiArrowUpRight, FiAlertTriangle } from 'react-icons/fi';
import { Button } from './ui/button';
import type { ActionApproval as Approval, ApprovalDecision } from '@extension/shared';
import type { assistantCopy } from '../lib/assistant-copy';

export default function ActionApproval({
  request,
  onResolve,
  copy,
}: {
  request: Approval;
  onResolve: (decision: ApprovalDecision) => void;
  copy: ReturnType<typeof assistantCopy>;
}) {
  if (request.kind === 'plan') {
    return (
      <section className="assistant-approval" aria-label={copy.planTitle}>
        <div className="assistant-approval-title">
          <FiShield />
          <strong>{copy.planTitle}</strong>
        </div>
        <p>{request.description}</p>
        <p className="assistant-approval-domains">
          {copy.planDomains}: {(request.domains ?? []).join(', ') || '-'}
        </p>
        {request.planSteps ? (
          <p className="assistant-approval-domains">
            {copy.planNextSteps}: {request.planSteps}
          </p>
        ) : null}
        <div className="assistant-approval-actions">
          <Button variant="outline" size="sm" onClick={() => onResolve('deny')}>
            {copy.planDeny}
          </Button>
          <Button size="sm" onClick={() => onResolve('once')}>
            {copy.planApprove}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="assistant-approval" aria-label={copy.approval}>
      <div className="assistant-approval-title">
        <FiShield />
        <strong>{copy.approval}</strong>
      </div>
      {request.sensitive ? (
        <div className="assistant-approval-sensitive" role="alert">
          <FiAlertTriangle />
          <span>{copy.sensitive}</span>
        </div>
      ) : null}
      {request.transition ? (
        <p className="assistant-approval-transition">
          {copy.transitionLabel}: {request.transition.from} → {request.transition.to}
        </p>
      ) : null}
      <p>{request.description}</p>
      <details className="assistant-approval-details">
        <summary>{request.action}</summary>
        <pre>{request.parameters}</pre>
      </details>
      <div className="assistant-approval-origin">
        <FiArrowUpRight />
        <span>{request.targetUrl ?? request.url}</span>
      </div>
      <div className="assistant-approval-actions">
        <Button variant="outline" size="sm" onClick={() => onResolve('deny')}>
          {copy.deny}
        </Button>
        {request.allowSiteOption ? (
          <Button variant="outline" size="sm" onClick={() => onResolve('always_site')}>
            {copy.alwaysSite}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => onResolve('once')}>
          {copy.allow}
        </Button>
      </div>
    </section>
  );
}
